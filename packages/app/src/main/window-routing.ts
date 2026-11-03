import type { OpenTarget } from "@gander/shared";
import type { ReviewRef } from "./config.js";

/**
 * Where an open request from outside the window lands: `bin/gander`, an agent that just
 * pushed, or a window restored at launch. One review per window, routed the way VS Code
 * routes `code <path>`: the window already showing it, then a window with nothing open,
 * then a new one. An outside open never replaces a review the reviewer has started.
 */

export type WindowReview = ReviewRef;

export function sameReview(review: WindowReview | null, repoId: string, prNumber: number | null): boolean {
  return review !== null && review.repoId === repoId && review.prNumber === prNumber;
}

/** The pull request a target names, or null when it names only a repository. */
export function reviewOf(target: OpenTarget | null): WindowReview | null {
  return target?.prNumber ? { repoId: target.repoId, prNumber: target.prNumber } : null;
}

export interface RoutableWindow {
  id: number;
  /** The pull request this window shows, or null. */
  review: WindowReview | null;
  /** Something is open that is not a pull request: a local worktree. */
  local: boolean;
}

export type Route =
  | { kind: "focus"; id: number }
  | { kind: "reuse"; id: number }
  | { kind: "new" };

export function routeOpen(windows: RoutableWindow[], target: OpenTarget, focusedId: number | null): Route {
  if (target.prNumber !== null) {
    const showing = windows.find((w) => sameReview(w.review, target.repoId, target.prNumber));
    if (showing) return { kind: "focus", id: showing.id };
  }
  const idle = windows.filter((w) => w.review === null && !w.local);
  // The focused window first, so a reviewer looking at an empty window sees it fill.
  const chosen = idle.find((w) => w.id === focusedId) ?? idle[0];
  if (chosen) return { kind: "reuse", id: chosen.id };
  // Naming only a repository switches nothing anyone is reading; it selects the repository
  // in the window in front, as it always has.
  if (target.prNumber === null && windows.length > 0) {
    return { kind: "reuse", id: windows.find((w) => w.id === focusedId)?.id ?? windows[0]!.id };
  }
  return { kind: "new" };
}

/** The windows to bring back at launch, in tab order; duplicates collapse to the first. */
export function windowsToRestore(saved: WindowReview[] | undefined, lastReview: WindowReview | undefined): WindowReview[] {
  const list = saved && saved.length > 0 ? saved : lastReview ? [lastReview] : [];
  const seen = new Set<string>();
  return list.filter((review) => {
    const key = `${review.repoId}#${review.prNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
