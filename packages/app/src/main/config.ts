import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { RepoEntry } from "@gander/shared";

// owner/repo, matching repoIdFromUrl's output — a hand-edited config must not be able to flow
// an arbitrary string into both a filesystem path (clone directory name) and a GitHub API URL.
const RepoIdSchema = z.string().regex(/^[^/]+\/[^/]+$/, "must look like owner/repo");

// .passthrough() so a config field added by a future version (or hand-edited by a user) round
// trips through load -> mutate -> save instead of being silently dropped on the next write.
const ConfigSchema = z
  .object({
    serviceUrl: z.string().url(),
    serviceToken: z.string().min(1),
    githubToken: z.string().min(1).optional(),
    repos: z.array(z.object({ repoId: RepoIdSchema, url: z.string() }).passthrough()).default([]),
  })
  .passthrough();
export interface GanderConfig { serviceUrl: string; serviceToken: string; githubToken?: string; repos: RepoEntry[]; }

const defaultPath = (): string => process.env.GANDER_CONFIG ?? join(homedir(), ".config", "gander", "config.json");

export function loadConfig(path = defaultPath()): GanderConfig {
  if (!existsSync(path)) throw new Error(`Gander config file not found at ${path} — create it with serviceUrl and serviceToken`);
  const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid config at ${path}: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
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
