import { randomUUID } from "node:crypto";
import type { IpcMain } from "electron";
import { ConfigSchema, ServerSchema, connectionIsFromEnvironment, saveConfig, type GanderConfig } from "./config.js";
import { checkConnection } from "./connection.js";
import type { RepositoryServers } from "./repository-servers.js";

export function registerServersIpc(
  ipc: Pick<IpcMain, "handle">, cfg: GanderConfig, persist = saveConfig, onChanged: () => void = () => {},
  repositoryServers?: Pick<RepositoryServers, "rechoose" | "forget">,
): void {
  const commit = (next: GanderConfig): void => {
    const parsed = ConfigSchema.safeParse(next);
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join(". "));
    const validated = parsed.data;
    persist(validated);
    Object.assign(cfg, validated);
    repositoryServers?.forget();
    onChanged();
  };
  const setRepoServer = (repoId: string, serverId: string): void => {
    if (!cfg.repos.some((repo) => repo.repoId === repoId)) throw new Error(`${repoId} is not registered`);
    commit({ ...cfg, repos: cfg.repos.map((repo) => repo.repoId === repoId ? { ...repo, serverId, serverSource: "choice" as const } : repo) });
  };
  ipc.handle("gander:getServers", async () => ({
    servers: cfg.servers, repos: cfg.repos,
    githubToken: cfg.githubToken ?? "", fromEnvironment: connectionIsFromEnvironment(),
  }));
  ipc.handle("gander:testConnection", async (_e, url: string, token: string) => checkConnection(url, token));
  ipc.handle("gander:saveServer", async (_e, value: unknown) => {
    const server = ServerSchema.parse(value);
    const result = await checkConnection(server.url, server.token);
    if (!result.ok) return result;
    const existing = cfg.servers.find((entry) => entry.id === server.id);
    const saved = { ...server, id: existing?.id ?? randomUUID(), url: server.url.trim().replace(/\/+$/, "") };
    const servers = existing ? cfg.servers.map((entry) => entry.id === saved.id ? saved : entry) : [...cfg.servers, saved];
    // The first connection completes repositories added while the local viewer was unconfigured.
    const repos = cfg.servers.length === 0 ? cfg.repos.map((repo) => ({ ...repo, serverId: saved.id })) : cfg.repos;
    commit({ ...cfg, servers, repos });
    return result;
  });
  ipc.handle("gander:removeServer", async (_e, id: string) => {
    if (cfg.repos.some((repo) => repo.serverId === id)) {
      throw new Error("Repositories still save notes to this server. Change them to another server first.");
    }
    commit({ ...cfg, servers: cfg.servers.filter((server) => server.id !== id) });
  });
  ipc.handle("gander:setRepoServer", async (_e, repoId: string, serverId: string) => setRepoServer(repoId, serverId));
  // Asks in the window, with every server's current answer, and saves what the reviewer
  // picks. Existing reviews stay on the server they were written to.
  ipc.handle("gander:changeRepoServer", async (_e, repoId: string): Promise<boolean> => {
    const repo = cfg.repos.find((entry) => entry.repoId === repoId);
    if (!repo) throw new Error(`${repoId} is not registered`);
    if (!repositoryServers) throw new Error("Choosing a server is not available here.");
    const chosen = await repositoryServers.rechoose(repo);
    if (chosen === null || chosen === repo.serverId) return false;
    setRepoServer(repoId, chosen);
    return true;
  });
}
