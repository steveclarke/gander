import { describe, expect, it } from "vitest";
import { boundsOnScreen, ensureNoOverlap, routeOpen, windowsToRestore, type RoutableWindow } from "./window-routing.js";

const pr = (id: number, prNumber: number, repoId = "acme/atlas"): RoutableWindow => ({ id, review: { repoId, prNumber }, local: false });
const empty = (id: number): RoutableWindow => ({ id, review: null, local: false });

describe("routeOpen", () => {
  it("focuses the window already showing the pull request", () => {
    expect(routeOpen([pr(1, 10), pr(2, 11)], { repoId: "acme/atlas", prNumber: 11 }, 1)).toEqual({ kind: "focus", id: 2 });
  });

  it("never replaces a review in progress: a second pull request gets a new window", () => {
    expect(routeOpen([pr(1, 10)], { repoId: "acme/atlas", prNumber: 11 }, 1)).toEqual({ kind: "new" });
  });

  it("matches the repository as well as the number", () => {
    expect(routeOpen([pr(1, 10, "acme/other")], { repoId: "acme/atlas", prNumber: 10 }, 1)).toEqual({ kind: "new" });
  });

  it("fills an empty window, the focused one first", () => {
    expect(routeOpen([pr(1, 10), empty(2), empty(3)], { repoId: "acme/atlas", prNumber: 11 }, 3)).toEqual({ kind: "reuse", id: 3 });
    expect(routeOpen([pr(1, 10), empty(2), empty(3)], { repoId: "acme/atlas", prNumber: 11 }, 1)).toEqual({ kind: "reuse", id: 2 });
  });

  it("does not count a window with a local worktree open as empty", () => {
    expect(routeOpen([{ id: 1, review: null, local: true }], { repoId: "acme/atlas", prNumber: 11 }, 1)).toEqual({ kind: "new" });
  });

  it("a repository alone never replaces a review: it opens a window when every window holds one", () => {
    expect(routeOpen([pr(1, 10), pr(2, 11)], { repoId: "acme/atlas", prNumber: null }, 2)).toEqual({ kind: "new" });
  });

  it("a repository alone still fills an empty window", () => {
    expect(routeOpen([pr(1, 10), empty(2)], { repoId: "acme/atlas", prNumber: null }, 1)).toEqual({ kind: "reuse", id: 2 });
  });

  it("opens a window when there is none", () => {
    expect(routeOpen([], { repoId: "acme/atlas", prNumber: 1 }, null)).toEqual({ kind: "new" });
  });
});

describe("windowsToRestore", () => {
  it("restores every saved window, without duplicates", () => {
    const a = { repoId: "acme/atlas", prNumber: 1 };
    const b = { repoId: "acme/atlas", prNumber: 2 };
    expect(windowsToRestore([a, b, a], undefined)).toEqual([a, b]);
  });

  it("falls back to the last review from before windows were saved", () => {
    const a = { repoId: "acme/atlas", prNumber: 1 };
    expect(windowsToRestore(undefined, a)).toEqual([a]);
    expect(windowsToRestore([], undefined)).toEqual([]);
  });

  it("an empty saved list is the session: the review the reviewer left does not come back", () => {
    expect(windowsToRestore([], { repoId: "acme/atlas", prNumber: 1 })).toEqual([]);
  });
});

describe("ensureNoOverlap", () => {
  it("steps 30px down and right while a window shares the x or y", () => {
    const open = [{ x: 100, y: 100, width: 800, height: 600 }, { x: 130, y: 500, width: 800, height: 600 }];
    expect(ensureNoOverlap({ x: 100, y: 100 }, open)).toEqual({ x: 160, y: 160 });
    expect(ensureNoOverlap({ x: 40, y: 40 }, open)).toEqual({ x: 40, y: 40 });
  });
});

describe("boundsOnScreen", () => {
  const display = { x: 0, y: 0, width: 1440, height: 900 };
  it("keeps saved bounds on an attached display", () => {
    const bounds = { x: 200, y: 100, width: 1000, height: 700 };
    expect(boundsOnScreen(bounds, [display])).toEqual(bounds);
  });
  it("drops bounds left on a display that is gone", () => {
    expect(boundsOnScreen({ x: 3000, y: 100, width: 1000, height: 700 }, [display])).toBeUndefined();
    expect(boundsOnScreen(undefined, [display])).toBeUndefined();
  });
});
