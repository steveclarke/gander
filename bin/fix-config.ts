import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppSettingsSchema, DEFAULT_APP_SETTINGS } from "../packages/app/src/settings.js";
import { ConfigSchema } from "../packages/app/src/main/config.js";

const path = process.argv[2] ?? join(homedir(), ".config", "gander", "config.json");
if (!existsSync(path)) {
  console.error(`No config at ${path} — nothing to fix. Gander writes one once it has a connection.`);
  process.exit(1);
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Defaults, overlaid with whatever the file already says.
 *
 * Driven by the defaults rather than by the file: a key the schema dropped is not in the
 * defaults, so it does not survive, and a key the schema added is present even though the
 * file has never heard of it.
 */
function reconcile(defaults: unknown, current: unknown): unknown {
  if (!isObject(defaults)) return current === undefined ? defaults : current;
  if (!isObject(current)) return defaults;
  const out: Json = {};
  for (const [key, value] of Object.entries(defaults)) out[key] = reconcile(value, current[key]);
  return out;
}

const before = JSON.parse(readFileSync(path, "utf8")) as Json;
const settings = reconcile(DEFAULT_APP_SETTINGS, before.settings);

const parsed = AppSettingsSchema.safeParse(settings);
if (!parsed.success) {
  // A value of the right shape but the wrong content — a theme that no longer exists, a
  // font size out of range. Reporting beats silently replacing a deliberate choice.
  console.error(`Could not repair ${path}:`);
  for (const issue of parsed.error.issues) console.error(`  settings.${issue.path.join(".")}: ${issue.message}`);
  console.error("Fix those values by hand, or delete the settings key to take the defaults.");
  process.exit(1);
}

// Only the keys the app itself writes. A stale top-level key (zoomLevel lived here once)
// fails a strict parse just as an unknown settings key does.
const after: Json = {
  serviceUrl: typeof before.serviceUrl === "string" ? before.serviceUrl : "",
  serviceToken: typeof before.serviceToken === "string" ? before.serviceToken : "",
  ...(typeof before.githubToken === "string" && before.githubToken !== "" ? { githubToken: before.githubToken } : {}),
  ...(isObject(before.lastReview) ? { lastReview: before.lastReview } : {}),
  settings: parsed.data,
  repos: Array.isArray(before.repos) ? before.repos : [],
};

const repaired = ConfigSchema.safeParse(after);
if (!repaired.success) {
  console.error(`Could not repair ${path}:`);
  for (const issue of repaired.error.issues) {
    console.error(`  ${issue.path.join(".") || "config"}: ${issue.message}`);
  }
  console.error("Fix those values by hand. The original file has not been changed.");
  process.exit(1);
}

const changed = JSON.stringify(before) !== JSON.stringify(repaired.data);
if (!changed) {
  console.log(`${path} already matches the current schema.`);
  process.exit(0);
}

copyFileSync(path, `${path}.bak`);
chmodSync(`${path}.bak`, 0o600);
writeFileSync(path, `${JSON.stringify(repaired.data, null, 2)}\n`, { mode: 0o600 });
chmodSync(path, 0o600);

const dropped = Object.keys(before).filter((k) => !(k in repaired.data));
console.log(`Repaired ${path} (previous kept as ${path}.bak)`);
if (dropped.length > 0) console.log(`  dropped: ${dropped.join(", ")}`);
