import type { ServerChoiceRequest } from "../../api.js";
import type { ServerClaim } from "../../main/repository-claims.js";

/** The words the server chooser shows, kept out of the component so each case is tested. */

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function choiceTitle(request: ServerChoiceRequest): string {
  return request.reason === "change"
    ? `Change where ${request.repoId} saves notes`
    : `Where should ${request.repoId} save notes?`;
}

export function choiceDetail(request: ServerChoiceRequest): string {
  const claimed = request.claims.filter((claim) => claim.answer === "claimed").map((claim) => claim.name);
  const unreachable = request.claims.filter((claim) => claim.answer === "unavailable").map((claim) => claim.name);
  if (request.reason === "change") return "Reviews already saved stay on the server they were saved to.";
  if (request.reason === "several") {
    return `${list(claimed)} ${claimed.length === 2 ? "both" : "all"} cover this repository. Gander remembers your choice.`;
  }
  if (request.reason === "unavailable") {
    return `Gander could not check with ${list(unreachable)}, so it is asking rather than guessing. It remembers your choice.`;
  }
  return "None of your servers says it covers this repository. Gander remembers your choice.";
}

export function claimLabel(claim: ServerClaim): string {
  if (claim.answer === "claimed") return "Covers this repository";
  if (claim.answer === "declined") return "Does not cover this repository";
  if (claim.answer === "unsupported") return "Older server; does not say";
  return claim.detail ?? "Could not be checked";
}

/** The current server when changing, else the one claimant, else the first server. */
export function initialChoice(request: ServerChoiceRequest): string | null {
  if (request.currentServerId && request.claims.some((claim) => claim.serverId === request.currentServerId)) return request.currentServerId;
  const claimed = request.claims.filter((claim) => claim.answer === "claimed");
  if (claimed.length === 1) return claimed[0]!.serverId;
  return request.claims[0]?.serverId ?? null;
}
