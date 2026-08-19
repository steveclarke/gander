import { SERVICE_VERSION } from "@gander/shared";
import { describeNetworkError } from "./network-error.js";

/**
 * Checking a connection the reviewer has just typed.
 *
 * `/healthz` is unauthenticated, so it answers "is anything there" and nothing about the
 * token. The token is checked against a review that does not exist: the service answers an
 * empty review for any repository and pull request it has never seen, which makes it a
 * read with no side effects and a 401 when the token is wrong.
 */

export type ConnectionCheck =
  | { ok: true; version: string; compatibility: "compatible" | "newer" }
  | { ok: false; reason: string };

export type ServiceStatus =
  | { state: "connected"; serviceVersion: string; supportedVersion: string }
  | { state: "newer"; serviceVersion: string; supportedVersion: string }
  | { state: "incompatible"; serviceVersion: string; supportedVersion: string; reason: string }
  | { state: "unreachable"; reason: string };

const PROBE = "/api/reviews/gander%2Fconnection-check/1";

function semverParts(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareServiceVersion(version: string): ServiceStatus {
  const actual = semverParts(version);
  const supported = semverParts(SERVICE_VERSION)!;
  if (actual === null) {
    return {
      state: "incompatible",
      serviceVersion: version,
      supportedVersion: SERVICE_VERSION,
      reason: `Gander service version ${version} is not a supported version. Update the service to ${SERVICE_VERSION}.`,
    };
  }
  const comparison = actual.findIndex((part, index) => part !== supported[index]);
  if (comparison === -1) {
    return { state: "connected", serviceVersion: version, supportedVersion: SERVICE_VERSION };
  }
  if (actual[comparison]! < supported[comparison]!) {
    return {
      state: "incompatible",
      serviceVersion: version,
      supportedVersion: SERVICE_VERSION,
      reason: `Gander service ${version} is too old for this app. Update the service to ${SERVICE_VERSION}.`,
    };
  }
  // A newer service is only safe when the difference is a patch. Once the major or minor
  // moves, the contract has changed, and a *removal* — a field this app's schemas still
  // require — passes the version check and then fails validation mid-review with a raw zod
  // error. Blocking here gets the reviewer the "update the app" message instead.
  if (comparison === 2) {
    return { state: "newer", serviceVersion: version, supportedVersion: SERVICE_VERSION };
  }
  return {
    state: "incompatible",
    serviceVersion: version,
    supportedVersion: SERVICE_VERSION,
    reason: `Gander service ${version} is newer than this app understands. Update the app to a build that supports ${version}.`,
  };
}

export async function checkServiceStatus(url: string): Promise<ServiceStatus> {
  const base = url.trim().replace(/\/+$/, "");
  if (base === "") return { state: "unreachable", reason: "No Gander service configured." };

  let health: Response;
  try {
    health = await fetch(`${base}/healthz`);
  } catch (err) {
    return { state: "unreachable", reason: `Could not reach ${base}: ${describeNetworkError(err)}` };
  }
  if (!health.ok) return { state: "unreachable", reason: `${base} answered ${health.status} on /healthz` };

  try {
    const body = (await health.json()) as { version?: unknown };
    if (typeof body.version !== "string" || body.version.trim() === "") {
      return { state: "unreachable", reason: `${base} is not a Gander service` };
    }
    return compareServiceVersion(body.version);
  } catch {
    return { state: "unreachable", reason: `${base} is not a Gander service` };
  }
}

export async function checkConnection(url: string, token: string): Promise<ConnectionCheck> {
  const base = url.trim().replace(/\/+$/, "");
  if (base === "") return { ok: false, reason: "Enter the service URL." };
  if (token.trim() === "") return { ok: false, reason: "Enter the service token." };

  const status = await checkServiceStatus(base);
  if (status.state === "unreachable" || status.state === "incompatible") {
    return { ok: false, reason: status.reason };
  }

  let probe: Response;
  try {
    probe = await fetch(`${base}${PROBE}`, { headers: { Authorization: `Bearer ${token.trim()}` } });
  } catch (err) {
    return { ok: false, reason: `Could not reach ${base}: ${describeNetworkError(err)}` };
  }
  if (probe.status === 401) return { ok: false, reason: "The service rejected that token." };
  if (!probe.ok) return { ok: false, reason: `${base} answered ${probe.status}` };

  return { ok: true, version: status.serviceVersion, compatibility: status.state === "newer" ? "newer" : "compatible" };
}
