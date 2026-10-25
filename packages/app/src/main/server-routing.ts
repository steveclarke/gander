import { randomUUID } from "node:crypto";
import type { GanderConfig } from "./config.js";
import { resolveServiceConnection } from "./config.js";
import { createServiceClient } from "./service-client.js";
import { createReviewer, type Reviewer, type ReviewerDeps } from "./review.js";

/** A connection change gets a fresh client AND review cache, including token-only edits. */
export function createServerRouting(cfg: GanderConfig, deps: Omit<ReviewerDeps, "service">) {
  const sessions = new Map<string, { sessionId: string; identity: string; reviewer: Reviewer; service: ReturnType<typeof createServiceClient> }>();
  return (repoId?: string) => {
    const repo = cfg.repos.find((entry) => entry.repoId === repoId);
    if (repoId !== undefined && !repo) throw new Error(`${repoId} is not registered`);
    const connection = resolveServiceConnection(cfg, repoId);
    const server = cfg.servers.find((entry) => entry.id === repo?.serverId) ?? (repoId === undefined ? cfg.servers[0] : undefined);
    const id = repoId ?? "unconfigured";
    const identity = JSON.stringify({ serverId: server?.id, ...connection });
    let session = sessions.get(id);
    if (!session || session.identity !== identity) {
      const service = createServiceClient(() => connection);
      session = { sessionId: randomUUID(), identity, service, reviewer: createReviewer({ ...deps, service }) };
      sessions.set(id, session);
    }
    return { ...session, name: server?.name ?? "Review server" };
  };
}

/** Replies and mutations are bound to the exact connection the displayed view came from. */
export async function withReviewSession<T>(
  routing: ReturnType<typeof createServerRouting>, repoId: string,
  action: (reviewer: Reviewer) => Promise<T>, expectedSessionId?: string,
): Promise<{ result: T; sessionId: string }> {
  const session = routing(repoId);
  if (expectedSessionId !== undefined && expectedSessionId !== session.sessionId) {
    throw new Error("This repository's review server changed. Reopen the review before making changes.");
  }
  const result = await action(session.reviewer);
  if (routing(repoId).sessionId !== session.sessionId) {
    throw new Error("This repository's review server changed while the request was running. Reopen the review.");
  }
  return { result, sessionId: session.sessionId };
}
