import type { OpenTarget } from "@gander/shared";
import type { ReviewRef, SavedWindow, WindowBounds } from "./config.js";

/**
 * Where an open request from outside the window lands: `bin/gander`, an agent that just
 * pushed, or a window restored at launch. One review per window, routed the way VS Code
 * routes `code <path>` (windowsMainService.ts, findWindowOnWorkspaceOrFolder): the window
 * already showing it, then a window with nothing open, then a new one. An outside open
 * never replaces a review the reviewer has started.
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
  return { kind: "new" };
}

/**
 * The windows to bring back at launch, in saved order; duplicates collapse to the first.
 * A saved list is the session, even when empty; lastReview stands in only for a config
 * written before windows were saved.
 */
export function windowsToRestore(saved: SavedWindow[] | undefined, lastReview: WindowReview | undefined): SavedWindow[] {
  const list: SavedWindow[] = saved ?? (lastReview ? [lastReview] : []);
  const seen = new Set<string>();
  return list.filter((window) => {
    const key = `${window.repoId}#${window.prNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** VS Code's cascade step (windowsStateHandler.ts, ensureNoOverlap). */
export const CASCADE_STEP = 30;

/**
 * Steps a new window down and right while an open window already sits at its x or y, so
 * it never lands exactly on top of another and looks like nothing happened.
 */
export function ensureNoOverlap(position: { x: number; y: number }, open: WindowBounds[]): { x: number; y: number } {
  let { x, y } = position;
  while (open.some((bounds) => bounds.x === x || bounds.y === y)) {
    x += CASCADE_STEP;
    y += CASCADE_STEP;
  }
  return { x, y };
}

/**
 * Saved bounds come back only when enough of the window lands on a display that is still
 * attached; a window saved on an unplugged monitor opens at the default position instead.
 */
export function boundsOnScreen(bounds: WindowBounds | undefined, workAreas: WindowBounds[]): WindowBounds | undefined {
  if (!bounds) return undefined;
  const visible = workAreas.some((area) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return width >= 100 && height >= 100;
  });
  return visible ? bounds : undefined;
}
