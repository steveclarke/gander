import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { AppSettingsSchema, DEFAULT_APP_SETTINGS } from "../settings.js";

// owner/repo, matching repoIdFromUrl's output — a hand-edited config must not be able to flow
// an arbitrary string into both a filesystem path (clone directory name) and a GitHub API URL.
const RepoIdSchema = z.string().regex(/^[^/]+\/[^/]+$/, "must look like owner/repo");

const RepoSchema = z.object({
  repoId: RepoIdSchema, url: z.string(),
  localPath: z.string().min(1).refine(isAbsolute, "must be an absolute path"),
  serverId: z.string().min(1).optional(),
}).strict();
export const ServerSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1),
  url: z.string().url().refine((url) => /^https?:\/\//.test(url), "must be an HTTP or HTTPS URL"),
  token: z.string(),
}).strict();
export type ReviewServer = z.infer<typeof ServerSchema>;
const common = {
  githubToken: z.string().min(1).optional(),
  lastReview: z.object({ repoId: RepoIdSchema, prNumber: z.number().int().positive() }).strict().optional(),
  settings: AppSettingsSchema,
};
export const ConfigSchema = z.object({
  ...common,
  servers: z.array(ServerSchema),
  ownerServers: z.array(z.object({ owner: z.string().trim().regex(/^[^\s/]+$/), serverId: z.string().min(1) }).strict()),
  repos: z.array(RepoSchema),
}).strict().superRefine((cfg, ctx) => {
  const ids = new Set(cfg.servers.map((server) => server.id));
  if (ids.size !== cfg.servers.length) ctx.addIssue({ code: "custom", path: ["servers"], message: "server ids must be unique" });
  const names = cfg.servers.map((server) => server.name.toLowerCase());
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["servers"], message: "server names must be unique" });
  const owners = cfg.ownerServers.map((rule) => rule.owner.toLowerCase());
  if (new Set(owners).size !== owners.length) ctx.addIssue({ code: "custom", path: ["ownerServers"], message: "owners must be unique" });
  for (const [index, repo] of cfg.repos.entries()) {
    if (repo.serverId && !ids.has(repo.serverId)) ctx.addIssue({ code: "custom", path: ["repos", index, "serverId"], message: "unknown server" });
  }
  for (const [index, rule] of cfg.ownerServers.entries()) {
    if (!ids.has(rule.serverId)) ctx.addIssue({ code: "custom", path: ["ownerServers", index, "serverId"], message: "unknown server" });
  }
});
// This is the one supported upgrade: the approved multi-server change preserves every
// existing assignment. Malformed or mixed configurations still fail strict validation.
const SingleServerSchema = z.object({
  ...common,
  serviceUrl: z.string().url().or(z.literal("")), serviceToken: z.string(),
  repos: z.array(RepoSchema.omit({ serverId: true })),
}).strict();
export type GanderConfig = z.infer<typeof ConfigSchema>;
export interface LastReview { repoId: string; prNumber: number; }

const defaultPath = (): string => process.env.GANDER_CONFIG ?? join(homedir(), ".config", "gander", "config.json");

/** The shape a first run starts from: no connection, no repositories, stock settings. */
export function unconfigured(): GanderConfig {
  return { servers: [], ownerServers: [], settings: DEFAULT_APP_SETTINGS, repos: [] };
}

export function loadConfig(path = defaultPath()): GanderConfig {
  // A missing file is a first run, not a failure. Anything present but malformed still
  // throws: that is a file someone edited, and silently replacing it would lose their work.
  if (!existsSync(path)) return unconfigured();
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw === "object" && raw !== null && "serviceUrl" in raw) {
    const old = SingleServerSchema.safeParse(raw);
    if (!old.success) throw new Error(`Invalid config at ${path}: ${old.error.message}`);
    const { serviceUrl, serviceToken, ...rest } = old.data;
    const servers = serviceUrl === "" ? [] : [{ id: "default", name: "Review server", url: serviceUrl, token: serviceToken }];
    const migrated = ConfigSchema.parse({ ...rest, servers, ownerServers: [], repos: rest.repos.map((repo) => ({ ...repo, ...(servers.length ? { serverId: "default" } : {}) })) });
    saveConfig(migrated, path);
    return migrated;
  }
  const parsed = ConfigSchema.safeParse(raw);
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
  cfg: Pick<GanderConfig, "servers" | "repos">,
  repoId?: string,
): { url: string; token: string } {
  const repo = cfg.repos.find((entry) => entry.repoId === repoId);
  const server = repoId === undefined ? cfg.servers[0] : cfg.servers.find((entry) => entry.id === repo?.serverId);
  return {
    url: process.env.GANDER_SERVICE_URL ?? server?.url ?? "",
    token: process.env.GANDER_TOKEN ?? server?.token ?? "",
  };
}

/** Only registration consults owner defaults; changing a rule never moves existing data. */
export function defaultServerForRepo(cfg: Pick<GanderConfig, "servers" | "ownerServers">, repoId: string): string | undefined {
  const owner = repoId.split("/")[0]!.toLowerCase();
  return cfg.ownerServers.find((rule) => rule.owner.toLowerCase() === owner)?.serverId
    ?? (cfg.servers.length === 1 ? cfg.servers[0]!.id : undefined);
}

/** True when the environment is deciding the connection, and the settings pane cannot. */
export function connectionIsFromEnvironment(): boolean {
  return process.env.GANDER_SERVICE_URL !== undefined || process.env.GANDER_TOKEN !== undefined;
}
