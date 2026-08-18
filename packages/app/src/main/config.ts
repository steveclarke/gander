import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { RepoEntry } from "@gander/shared";
import { AppSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from "../settings.js";

// owner/repo, matching repoIdFromUrl's output — a hand-edited config must not be able to flow
// an arbitrary string into both a filesystem path (clone directory name) and a GitHub API URL.
const RepoIdSchema = z.string().regex(/^[^/]+\/[^/]+$/, "must look like owner/repo");

const ConfigSchema = z
  .object({
    // Empty until the reviewer enters a connection. An installed app has no dev stack to
    // generate one, so it has to start unconfigured, show its settings, and be told —
    // and a config saved in that state must load again rather than being rejected.
    serviceUrl: z.string().url().or(z.literal("")),
    serviceToken: z.string(),
    githubToken: z.string().min(1).optional(),
    // Electron zoom level: 0 is 100%, each step is a 20% change. Persisted so the
    // window reopens at the size the reader last chose.
    zoomLevel: z.number().optional(),
    // The pull request open when the app last closed, reopened on launch.
    lastReview: z.object({ repoId: RepoIdSchema, prNumber: z.number().int().positive() }).strict().optional(),
    settings: AppSettingsSchema,
    repos: z.array(z.object({ repoId: RepoIdSchema, url: z.string() }).strict()),
  })
  .strict();
export interface LastReview { repoId: string; prNumber: number; }
export interface GanderConfig {
  serviceUrl: string;
  serviceToken: string;
  githubToken?: string;
  zoomLevel?: number;
  lastReview?: LastReview;
  settings: AppSettings;
  repos: RepoEntry[];
}

const defaultPath = (): string => process.env.GANDER_CONFIG ?? join(homedir(), ".config", "gander", "config.json");

/** The shape a first run starts from: no connection, no repositories, stock settings. */
export function unconfigured(): GanderConfig {
  return { serviceUrl: "", serviceToken: "", settings: DEFAULT_APP_SETTINGS, repos: [] };
}

export function loadConfig(path = defaultPath()): GanderConfig {
  // A missing file is a first run, not a failure. Anything present but malformed still
  // throws: that is a file someone edited, and silently replacing it would lose their work.
  if (!existsSync(path)) return unconfigured();
  const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join(", ");
    throw new Error(`Invalid config at ${path}: ${details}`);
  }
  return parsed.data as GanderConfig;
}

export function saveConfig(cfg: GanderConfig, path = defaultPath()): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // The config holds the service token and optionally a GitHub token — mode must be applied
  // explicitly, not just passed to mkdir/writeFile, since neither call changes the mode of a
  // directory/file that already existed with looser permissions from before this fix.
  chmodSync(dir, 0o700);
  writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Where the app should actually reach the service. The dev stack allocates the port
 * per worktree and generates the token, writing both into .env, so env wins over the
 * file. Deliberately not folded into loadConfig: saveConfig round-trips whatever
 * loadConfig returned, and persisting a machine-specific port and token into the
 * config file is exactly what this avoids.
 */
export function resolveServiceConnection(
  cfg: Pick<GanderConfig, "serviceUrl" | "serviceToken">,
): { url: string; token: string } {
  return {
    url: process.env.GANDER_SERVICE_URL ?? cfg.serviceUrl,
    token: process.env.GANDER_TOKEN ?? cfg.serviceToken,
  };
}

/** True when the environment is deciding the connection, and the settings pane cannot. */
export function connectionIsFromEnvironment(): boolean {
  return process.env.GANDER_SERVICE_URL !== undefined || process.env.GANDER_TOKEN !== undefined;
}
