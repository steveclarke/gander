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
    // Electron zoom level: 0 is 100%, each step is a 20% change. Persisted so the
    // window reopens at the size the reader last chose.
    zoomLevel: z.number().optional(),
    // The pull request open when the app last closed, reopened on launch.
    lastReview: z.object({ repoId: RepoIdSchema, prNumber: z.number().int().positive() }).optional(),
    repos: z.array(z.object({ repoId: RepoIdSchema, url: z.string() }).passthrough()).default([]),
  })
  .passthrough();
export interface LastReview { repoId: string; prNumber: number; }
export interface GanderConfig {
  serviceUrl: string;
  serviceToken: string;
  githubToken?: string;
  zoomLevel?: number;
  lastReview?: LastReview;
  repos: RepoEntry[];
}

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

/**
 * Where the app should actually reach the service. The dev stack allocates the port
 * per worktree and generates the token, writing both into .env, so env wins over the
 * file. Deliberately not folded into loadConfig: saveConfig round-trips whatever
 * loadConfig returned, and persisting a machine-specific port and token into the
 * config file is exactly what this avoids.
 */
export function resolveServiceConnection(cfg: GanderConfig): { url: string; token: string } {
  return {
    url: process.env.GANDER_SERVICE_URL ?? cfg.serviceUrl,
    token: process.env.GANDER_TOKEN ?? cfg.serviceToken,
  };
}
