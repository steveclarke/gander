import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { RepoEntry } from "@gander/shared";

const ConfigSchema = z.object({
  serviceUrl: z.string().url(),
  serviceToken: z.string().min(1),
  githubToken: z.string().min(1).optional(),
  repos: z.array(z.object({ repoId: z.string(), url: z.string() })).default([]),
});
export interface GanderConfig { serviceUrl: string; serviceToken: string; githubToken?: string; repos: RepoEntry[]; }

const defaultPath = (): string => process.env.GANDER_CONFIG ?? join(homedir(), ".config", "gander", "config.json");

export function loadConfig(path = defaultPath()): GanderConfig {
  if (!existsSync(path)) throw new Error(`Gander config file not found at ${path} — create it with serviceUrl and serviceToken`);
  const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid config at ${path}: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return parsed.data;
}

export function saveConfig(cfg: GanderConfig, path = defaultPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}
