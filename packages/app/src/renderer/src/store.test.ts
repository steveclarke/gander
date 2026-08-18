import { describe, expect, it } from "vitest";
import type { PrView } from "@gander/shared";
import type { GanderApi } from "./api.js";
import { createStore } from "./store.js";

const prView = (checkedPaths: string[] = []): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
  files: [
    { path: "a.rb", status: "M", baseContent: "o", headContent: "n", baseHash: "b1", headHash: "h1", checked: checkedPaths.includes("a.rb"), changedSince: false },
    { path: "b.rb", status: "A", baseContent: null, headContent: "x", baseHash: null, headHash: "h2", checked: checkedPaths.includes("b.rb"), changedSince: false },
  ],
  questions: [],
});

function fakeApi(overrides: Partial<GanderApi> = {}): GanderApi {
  return {
    initialWindowState: {
      windowStyle: "native-titlebar",
      colorTheme: "Catppuccin Mocha",
    },
    listRepos: async () => [{ repoId: "acme/atlas", url: "u" }],
    addRepo: async (url) => ({ repoId: "acme/new", url }),
    listPrs: async () => [{ number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" }],
    openPr: async () => prView(),
    setChecked: async (_r, _n, path) => prView([path]),
    setCheckedMany: async (_r, _n, paths) => prView(paths),
    refreshPr: async () => prView(),
    lastReview: async () => null,
    initialTarget: async () => null,
    onOpenTarget: () => () => {},
    serviceHealthy: async () => true,
    reviewedSnapshot: async () => null,
    addQuestion: async () => prView(),
    addReviewerReply: async () => prView(),
    deleteQuestion: async () => prView(),
    getSettings: async () => ({
      editor: { fontFamily: "monospace", fontSize: 16 },
      workbench: { colorTheme: "Catppuccin Mocha", iconTheme: "catppuccin-mocha" },
    }),
    updateSettings: async (settings) => settings,
    onOpenSettings: () => () => {},
    ...overrides,
  };
}

describe("store", () => {
  it("opens a target naming a repository and pull request", async () => {
    const store = createStore(fakeApi());
    await store.loadRepos();
    await store.openTarget({ repoId: "acme/atlas", prNumber: 1 });
    expect(store.currentRepoId).toBe("acme/atlas");
    expect(store.view?.files).toHaveLength(2);
    expect(store.selectedPath).toBe("a.rb");
  });

  it("opens a target naming only a repository", async () => {
    const store = createStore(fakeApi());
    await store.loadRepos();
    await store.openTarget({ repoId: "acme/atlas", prNumber: null });
    expect(store.currentRepoId).toBe("acme/atlas");
    expect(store.prs).toHaveLength(1);
    expect(store.view).toBeNull();
  });

  it("registers a repository the target names but the app has never seen", async () => {
    const added: string[] = [];
    const store = createStore(fakeApi({
      addRepo: async (url) => { added.push(url); return { repoId: "acme/new", url }; },
      listRepos: async () => (added.length === 0 ? [] : [{ repoId: "acme/new", url: added[0] as string }]),
    }));
    await store.loadRepos();
    await store.openTarget({ repoId: "acme/new", prNumber: null });
    expect(added).toEqual(["https://github.com/acme/new"]);
    expect(store.currentRepoId).toBe("acme/new");
    expect(store.error).toBeNull();
  });

  it("loads repos, selects one, opens a PR, tracks progress", async () => {
    const store = createStore(fakeApi());
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    expect(store.prs).toHaveLength(1);
    await store.openPr(1);
    expect(store.view?.files).toHaveLength(2);
    expect(store.progress()).toEqual({ done: 0, total: 2 });
    await store.setChecked("a.rb", true);
    expect(store.progress()).toEqual({ done: 1, total: 2 });
  });

  it("captures errors into store.error instead of throwing", async () => {
    const store = createStore(fakeApi({ listPrs: async () => { throw new Error("GitHub API 403: rate limited"); } }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    expect(store.error).toMatch(/403/);
  });

  it("clears error on the next successful action", async () => {
    let fail = true;
    const store = createStore(fakeApi({ listPrs: async () => { if (fail) throw new Error("boom"); return []; } }));
    await store.selectRepo("acme/atlas");
    expect(store.error).toMatch(/boom/);
    fail = false;
    await store.selectRepo("acme/atlas");
    expect(store.error).toBeNull();
  });

  it("refresh replaces the view but keeps the selected path", async () => {
    const store = createStore(fakeApi());
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    await store.openPr(1);
    store.select("b.rb");
    await store.refresh();
    expect(store.selectedPath).toBe("b.rb");
    expect(store.view).not.toBeNull();
  });

  it("sends a reviewer reply for the open review", async () => {
    let call: [string, number, number, string] | null = null;
    const store = createStore(fakeApi({
      addReviewerReply: async (repo, pr, id, text) => {
        call = [repo, pr, id, text];
        return prView();
      },
    }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    await store.openPr(1);
    await store.addReviewerReply(12, "A reviewer reply");
    expect(call).toEqual(["acme/atlas", 1, 12, "A reviewer reply"]);
  });

  it("busy is true only while a long-running action is in flight, and clears even on failure", async () => {
    let resolveOpen!: () => void;
    const store = createStore(fakeApi({
      openPr: () => new Promise((resolve) => { resolveOpen = () => resolve(prView()); }),
    }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    expect(store.busy).toBe(false);

    const opening = store.openPr(1);
    expect(store.busy).toBe(true);
    resolveOpen();
    await opening;
    expect(store.busy).toBe(false);

    const failing = createStore(fakeApi({ listPrs: async () => { throw new Error("boom"); } }));
    await failing.selectRepo("acme/atlas");
    expect(failing.busy).toBe(false); // guard() swallows the error, withBusy's finally still clears it
  });

  describe("restoreLastReview", () => {
    it("reopens the last reviewed pull request", async () => {
      const store = createStore(fakeApi({ lastReview: async () => ({ repoId: "acme/atlas", prNumber: 1 }) }));
      await store.loadRepos();
      await store.restoreLastReview();
      expect(store.currentRepoId).toBe("acme/atlas");
      expect(store.view?.pr.number).toBe(1);
    });

    it("does nothing when there is no last review", async () => {
      const store = createStore(fakeApi());
      await store.loadRepos();
      await store.restoreLastReview();
      expect(store.currentRepoId).toBeNull();
      expect(store.view).toBeNull();
    });

    it("skips a repository that is no longer registered", async () => {
      const store = createStore(fakeApi({ lastReview: async () => ({ repoId: "acme/removed", prNumber: 1 }) }));
      await store.loadRepos();
      await store.restoreLastReview();
      expect(store.currentRepoId).toBeNull();
      expect(store.error).toBeNull();
    });

    it("opens on the empty state, not an error banner, when the pull request is gone", async () => {
      // A merged pull request's refs disappear between launches. That is ordinary, and
      // greeting the reader with a red banner about it would be noise.
      const store = createStore(fakeApi({
        lastReview: async () => ({ repoId: "acme/atlas", prNumber: 1 }),
        openPr: async () => { throw new Error("git rev-parse refs/gander/pr/1 failed"); },
      }));
      await store.loadRepos();
      await store.restoreLastReview();
      expect(store.view).toBeNull();
      expect(store.error).toBeNull();
    });
  });

  describe("errors", () => {
    it("keeps an error on screen until the reviewer acts, not until the next poll", async () => {
      let fail = true;
      const store = createStore(fakeApi({
        refreshPr: async () => { if (fail) throw new Error("Gander service unreachable"); return prView(); },
      }));
      await store.loadRepos();
      await store.selectRepo("acme/atlas");
      await store.openPr(1);

      await store.refresh();
      expect(store.error).toContain("unreachable");

      // The background poll succeeding must not wipe a failure the reviewer has not seen.
      fail = false;
      await store.refresh();
      expect(store.error).toContain("unreachable");

      store.dismissError();
      expect(store.error).toBeNull();
    });

    it("clears a stale error when the reviewer presses Fetch origin", async () => {
      let fail = true;
      const store = createStore(fakeApi({
        refreshPr: async () => { if (fail) throw new Error("Gander service unreachable"); return prView(); },
      }));
      await store.loadRepos();
      await store.selectRepo("acme/atlas");
      await store.openPr(1);
      await store.refresh();
      expect(store.error).toContain("unreachable");

      // Pressing the button is the reviewer saying "try again" — the poll is not.
      fail = false;
      await store.fetchNow();
      expect(store.error).toBeNull();
    });

    it("clears the error when the reviewer starts something new", async () => {
      let fail = true;
      const store = createStore(fakeApi({
        listPrs: async () => { if (fail) throw new Error("GitHub API 403"); return []; },
      }));
      await store.loadRepos();
      await store.selectRepo("acme/atlas");
      expect(store.error).toContain("403");

      fail = false;
      await store.selectRepo("acme/atlas");
      expect(store.error).toBeNull();
    });

    it("records when the pull request was last fetched", async () => {
      const store = createStore(fakeApi());
      await store.loadRepos();
      await store.selectRepo("acme/atlas");
      expect(store.lastFetchAt).toBeNull();
      await store.openPr(1);
      expect(store.lastFetchAt).not.toBeNull();
    });

    it("reports the service as unreachable when the health check fails", async () => {
      const store = createStore(fakeApi({ serviceHealthy: async () => false }));
      await store.checkService();
      expect(store.serviceReachable).toBe(false);
    });
  });
});
