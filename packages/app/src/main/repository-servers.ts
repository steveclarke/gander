import type { RepoEntry } from "@gander/shared";
import type { GanderConfig } from "./config.js";
import { askClaim, askEveryServer, decideServer } from "./repository-claims.js";
import type { ServerChooser } from "./server-choice.js";

/** How long a server's "still covers it" answer is trusted before it is asked again. */
const CLAIM_RECHECK_MS = 5 * 60_000;

type ServerAssignment = Pick<RepoEntry, "serverId" | "serverSource">;

/**
 * Where a repository's notes go. A repository is routed once, when it is first opened;
 * after that its remembered server is used as is. A server that goes offline keeps the
 * repository, and a claim that disappears only tells the reviewer: notes are never moved
 * to another server behind their back.
 */
export function createRepositoryServers(cfg: GanderConfig, choose: ServerChooser) {
  const lostClaims = new Map<string, { at: number; lost: boolean }>();

  async function assign(repoId: string, remote: string): Promise<ServerAssignment> {
    if (cfg.servers.length === 0) return {};
    const claims = await askEveryServer(cfg.servers, remote);
    const decision = decideServer(claims);
    if (decision.kind === "use") {
      const claimed = claims.find((claim) => claim.serverId === decision.serverId)?.answer === "claimed";
      return { serverId: decision.serverId, ...(claimed ? { serverSource: "claim" as const } : {}) };
    }
    const chosen = await choose({ repoId, reason: decision.reason, claims });
    if (chosen === null) throw new Error("Repository registration cancelled.");
    if (!cfg.servers.some((server) => server.id === chosen)) throw new Error("That server was removed. Open the repository again to choose another.");
    return { serverId: chosen, serverSource: "choice" };
  }

  /** Asks the reviewer again, showing each server's current answer. Null when they cancel. */
  async function rechoose(repo: RepoEntry): Promise<string | null> {
    const claims = await askEveryServer(cfg.servers, repo.url);
    return choose({ repoId: repo.repoId, reason: "change", claims, ...(repo.serverId ? { currentServerId: repo.serverId } : {}) });
  }

  /**
   * True when the server this repository was routed to by its claim now says it does not
   * cover it. Only an explicit "no" counts: an offline or older server proves nothing.
   */
  async function claimLost(repoId: string): Promise<boolean> {
    const repo = cfg.repos.find((entry) => entry.repoId === repoId);
    const server = cfg.servers.find((entry) => entry.id === repo?.serverId);
    if (!repo || !server || repo.serverSource !== "claim") return false;
    const key = JSON.stringify([repo.repoId, repo.url, server.id, server.url, server.token]);
    const cached = lostClaims.get(key);
    if (cached && Date.now() - cached.at < CLAIM_RECHECK_MS) return cached.lost;
    const lost = (await askClaim(server, repo.url)).answer === "declined";
    lostClaims.set(key, { at: Date.now(), lost });
    return lost;
  }

  return { assign, rechoose, claimLost, forget: () => lostClaims.clear() };
}

export type RepositoryServers = ReturnType<typeof createRepositoryServers>;
