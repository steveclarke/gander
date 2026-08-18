/**
 * Checking a connection the reviewer has just typed.
 *
 * `/healthz` is unauthenticated, so it answers "is anything there" and nothing about the
 * token. The token is checked against a review that does not exist: the service answers an
 * empty review for any repository and pull request it has never seen, which makes it a
 * read with no side effects and a 401 when the token is wrong.
 */

export type ConnectionCheck =
  | { ok: true; version: string }
  | { ok: false; reason: string };

const PROBE = "/api/reviews/gander%2Fconnection-check/1";

export async function checkConnection(url: string, token: string): Promise<ConnectionCheck> {
  const base = url.trim().replace(/\/+$/, "");
  if (base === "") return { ok: false, reason: "Enter the service URL." };
  if (token.trim() === "") return { ok: false, reason: "Enter the service token." };

  let health: Response;
  try {
    health = await fetch(`${base}/healthz`);
  } catch (err) {
    return { ok: false, reason: `Could not reach ${base}: ${(err as Error).message}` };
  }
  if (!health.ok) return { ok: false, reason: `${base} answered ${health.status} on /healthz` };

  let version = "unknown";
  try {
    const body = (await health.json()) as { version?: unknown };
    if (typeof body.version === "string") version = body.version;
  } catch {
    return { ok: false, reason: `${base} is not a Gander service` };
  }

  let probe: Response;
  try {
    probe = await fetch(`${base}${PROBE}`, { headers: { Authorization: `Bearer ${token.trim()}` } });
  } catch (err) {
    return { ok: false, reason: `Could not reach ${base}: ${(err as Error).message}` };
  }
  if (probe.status === 401) return { ok: false, reason: "The service rejected that token." };
  if (!probe.ok) return { ok: false, reason: `${base} answered ${probe.status}` };

  return { ok: true, version };
}
