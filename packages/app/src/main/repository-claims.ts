import { RepositoryClaimSchema } from "@gander/shared";
import { serverConnection, type ReviewServer } from "./config.js";
import { describeNetworkError } from "./network-error.js";

/**
 * Asking each review server whether it covers a repository, and deciding from the answers.
 *
 * The rule is the one mail clients use for account discovery: when exactly one server
 * speaks for a repository, use it without a question; otherwise ask once and remember.
 * A server that cannot be asked is never assumed to have said no — it might be the second
 * claimant — so its silence turns an obvious answer back into a question.
 */

export type ClaimAnswer =
  /** The server said it covers this repository. */
  | "claimed"
  /** The server answered, and does not cover it. */
  | "declined"
  /** A service from before claims existed; counts as no claim. */
  | "unsupported"
  /** Offline, token rejected, or an unexpected answer: nothing is known. */
  | "unavailable";

export interface ServerClaim { serverId: string; name: string; answer: ClaimAnswer; detail?: string }

export type ClaimDecision =
  | { kind: "use"; serverId: string }
  | { kind: "ask"; reason: "several" | "none" | "unavailable" };

export async function askClaim(server: ReviewServer, remote: string): Promise<ServerClaim> {
  const { url, token } = serverConnection(server);
  const base = url.trim().replace(/\/+$/, "");
  const result = (answer: ClaimAnswer, detail?: string): ServerClaim =>
    ({ serverId: server.id, name: server.name, answer, ...(detail ? { detail } : {}) });
  let response: Response;
  try {
    response = await fetch(`${base}/api/repositories/claim?remote=${encodeURIComponent(remote)}`, {
      headers: { Authorization: `Bearer ${token.trim()}` }, signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    return result("unavailable", `Could not be reached: ${describeNetworkError(err)}`);
  }
  if (response.status === 404) return result("unsupported");
  if (response.status === 401) return result("unavailable", "Rejected the saved token");
  if (!response.ok) return result("unavailable", `Answered ${response.status}`);
  const parsed = RepositoryClaimSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return result("unavailable", "Gave an answer Gander does not understand");
  return result(parsed.data.claimed ? "claimed" : "declined");
}

export async function askEveryServer(servers: ReviewServer[], remote: string): Promise<ServerClaim[]> {
  return Promise.all(servers.map((server) => askClaim(server, remote)));
}

export function decideServer(claims: ServerClaim[]): ClaimDecision {
  const claimed = claims.filter((claim) => claim.answer === "claimed");
  const unknown = claims.some((claim) => claim.answer === "unavailable");
  if (claimed.length === 1 && !unknown) return { kind: "use", serverId: claimed[0]!.serverId };
  // With a single server there is nothing to choose between, so a server that has not
  // explicitly turned the repository down keeps the behaviour it had before claims.
  if (claims.length === 1 && claims[0]!.answer !== "declined") return { kind: "use", serverId: claims[0]!.serverId };
  if (claimed.length > 1) return { kind: "ask", reason: "several" };
  return { kind: "ask", reason: unknown ? "unavailable" : "none" };
}
