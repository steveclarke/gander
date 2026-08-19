import { describe, expect, it } from "vitest";
import type { LocalView, PrView } from "@gander/shared";
import type { GanderApi } from "./api.js";
import { createStore } from "./store.js";
import { DEFAULT_APP_SETTINGS } from "../../settings.js";

const prView = (checkedPaths: string[] = []): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
  files: [
    { path: "a.rb", status: "M", baseContent: "o", headContent: "n", baseHash: "b1", headHash: "h1", checked: checkedPaths.includes("a.rb"), changedSince: false },
    { path: "b.rb", status: "A", baseContent: null, headContent: "x", baseHash: null, headHash: "h2", checked: checkedPaths.includes("b.rb"), changedSince: false },
  ],
  questions: [],
});

const localView = (files: LocalView["files"] = [{
  path: "working.ts", status: "M", baseContent: "old\n", headContent: "new\n", baseHash: "base", headHash: "head",
}]): LocalView => ({
  worktree: { path: "/tmp/local-worktree", branch: "feature", headSha: "abc123", locked: false },
  defaultBranch: "main",
  mergeBaseSha: "base-sha",
  files,
});

function fakeApi(overrides: Partial<GanderApi> = {}): GanderApi {
  return {
    initialWindowState: {
      windowStyle: "native-titlebar",
      colorTheme: "Catppuccin Mocha",
      isDevelopment: false,
      worktreeLabel: null,
    },
    listRepos: async () => [{ repoId: "acme/atlas", url: "u" }],
    listGithubRepos: async () => [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas", private: true }],
    addRepo: async (url) => ({ repoId: "acme/new", url }),
    chooseLocalRepo: async () => null,
    listWorktrees: async () => [],
    listPrs: async () => [{ number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" }],
    openPr: async () => prView(),
    setChecked: async (_r, _n, path) => prView([path]),
    setCheckedMany: async (_r, _n, paths) => prView(paths),
    refreshPr: async () => prView(),
    lastReview: async () => null,
    initialTarget: async () => null,
    getConnection: async () => ({ url: "http://service", token: "t", githubToken: "", fromEnvironment: false }),
    setGithubToken: async () => ({ ok: true as const, login: "octocat" }),
    testConnection: async () => ({ ok: true, version: "test" }),
    setConnection: async () => ({ ok: true, version: "test" }),
    onOpenTarget: () => () => {},
    serviceHealthy: async () => true,
    reviewedSnapshot: async () => null,
    imagePreview: async () => ({ base: { kind: "absent" }, head: { kind: "absent" } }),
    openLocal: async () => { throw new Error("no local fixture"); },
    listLocalFiles: async () => [{ path: "working.ts" }],
    localFile: async (_path, filePath) => ({ path: filePath, content: "new\n", hash: "hash", binary: false }),
    refreshLocal: async () => { throw new Error("no local fixture"); },
    localImagePreview: async () => ({ base: { kind: "absent" }, head: { kind: "absent" } }),
    closeLocal: async () => {},
    onLocalViewChanged: () => () => {},
    addQuestion: async () => prView(),
    addReviewerReply: async () => prView(),
    deleteQuestion: async () => prView(),
    getSettings: async () => ({
      editor: { fontFamily: "monospace", fontSize: 16 },
      window: DEFAULT_APP_SETTINGS.window,
      workbench: DEFAULT_APP_SETTINGS.workbench,
    }),
    updateSettings: async (settings) => settings,
    onOpenSettings: () => () => {},
    getZoomLevel: async () => 0,
    setZoomLevel: async (level) => level,
    onZoomChanged: () => () => {},
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
    expect(store.navigatorRepoId).toBe("acme/atlas");
    expect(store.currentRepoId).toBeNull();
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
    expect(store.navigatorRepoId).toBe("acme/new");
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

  it("loads GitHub repositories separately from registered repositories", async () => {
    const store = createStore(fakeApi());
    await store.loadGithubRepos();
    expect(store.githubRepos).toEqual([{ repoId: "acme/atlas", url: "https://github.com/acme/atlas", private: true }]);
    expect(store.githubReposError).toBeNull();
  });

  it("registers and selects a repository in one action", async () => {
    const store = createStore(fakeApi({
      addRepo: async (url) => ({ repoId: "acme/new", url }),
      listRepos: async () => [{ repoId: "acme/new", url: "https://github.com/acme/new" }],
    }));
    await store.addRepo("https://github.com/acme/new");
    expect(store.navigatorRepoId).toBe("acme/new");
    expect(store.currentRepoId).toBeNull();
    expect(store.prs).toHaveLength(1);
  });

  it("opens a stateless local worktree without creating pull request review state", async () => {
    const opened = localView();
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
    }));
    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);

    expect(store.view).toBeNull();
    expect(store.localView).toEqual(opened);
    expect(store.files()).toEqual(opened.files);
    expect(store.selectedPath).toBe("working.ts");
    expect(store.progress()).toEqual({ done: 0, total: 0 });
    expect(store.tabs).toEqual([expect.objectContaining({ type: "local", label: "feature", surface: "explorer" })]);
    expect(store.localFile?.content).toBe("new\n");
  });

  it("keeps worktrees and pull requests open as switchable context tabs", async () => {
    const opened = localView();
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
    }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);
    const localKey = store.activeTabKey!;
    store.showLocalSurface("changes");
    await store.openPr(1);
    const prKey = store.activeTabKey!;

    expect(store.tabs).toHaveLength(2);
    expect(prKey).not.toBe(localKey);
    await store.activateTab(localKey);
    expect(store.localView?.worktree.path).toBe(opened.worktree.path);
    expect(store.localSurface).toBe("changes");
  });

  it("browses another repository without disturbing the active tab or local watcher", async () => {
    const opened = localView();
    let closeCalls = 0;
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
      closeLocal: async () => { closeCalls++; },
    }));
    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);
    const activeKey = store.activeTabKey;

    await store.selectRepo("acme/other");

    expect(store.navigatorRepoId).toBe("acme/other");
    expect(store.currentRepoId).toBe("acme/atlas");
    expect(store.localView).toEqual(opened);
    expect(store.activeTabKey).toBe(activeKey);
    expect(closeCalls).toBe(0);
  });

  it("does not let a slow repository load replace the newer navigator selection", async () => {
    let resolveFirst!: (prs: PrView["pr"][]) => void;
    const first = new Promise<PrView["pr"][]>((resolve) => { resolveFirst = resolve; });
    const store = createStore(fakeApi({
      listPrs: async (repoId) => repoId === "acme/first" ? first : [{ ...prView().pr, number: 2, title: "Second" }],
    }));

    const slow = store.selectRepo("acme/first");
    await store.selectRepo("acme/second");
    resolveFirst([{ ...prView().pr, title: "First" }]);
    await slow;

    expect(store.navigatorRepoId).toBe("acme/second");
    expect(store.prs.map((pr) => pr.title)).toEqual(["Second"]);
  });

  it("applies watched local changes and surfaces watcher failures", async () => {
    let notify: Parameters<GanderApi["onLocalViewChanged"]>[0] | undefined;
    const initial = localView();
    const store = createStore(fakeApi({
      openLocal: async () => initial,
      onLocalViewChanged: (listener) => { notify = listener; return () => {}; },
    }));
    await store.selectRepo("acme/atlas");
    await store.openLocal(initial.worktree.path);
    store.showLocalSurface("changes");

    const next = localView([{ path: "new-file.ts", status: "A", baseContent: null, headContent: "new\n", baseHash: null, headHash: "next" }]);
    notify?.({ path: initial.worktree.path, view: next, error: null });
    expect(store.localView).toEqual(next);
    expect(store.selectedPath).toBe("new-file.ts");

    notify?.({ path: initial.worktree.path, view: null, error: "git diff failed: permission denied" });
    expect(store.error).toContain("permission denied");
  });

  it("discards an Explorer refresh that finishes after switching worktrees", async () => {
    const first = localView();
    const second = { ...localView(), worktree: { ...localView().worktree, path: "/tmp/second", branch: "second" } };
    let notify: Parameters<GanderApi["onLocalViewChanged"]>[0] | undefined;
    let deferFirst = false;
    let resolveOld!: (files: Array<{ path: string }>) => void;
    const store = createStore(fakeApi({
      openLocal: async (_repo, path) => path === first.worktree.path ? first : second,
      listLocalFiles: async (path) => {
        if (path === first.worktree.path && deferFirst) return new Promise((resolve) => { resolveOld = resolve; });
        return [{ path: path === first.worktree.path ? "first.ts" : "second.ts" }];
      },
      localFile: async (_path, filePath) => ({ path: filePath, content: filePath, hash: filePath, binary: false }),
      onLocalViewChanged: (listener) => { notify = listener; return () => {}; },
    }));
    await store.selectRepo("acme/atlas");
    await store.openLocal(first.worktree.path);
    deferFirst = true;
    notify?.({ path: first.worktree.path, view: first, error: null });
    await Promise.resolve();
    await store.openLocal(second.worktree.path);
    resolveOld([{ path: "stale.ts" }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.localView?.worktree.path).toBe(second.worktree.path);
    expect(store.localFiles).toEqual([{ path: "second.ts" }]);
    expect(store.localFile?.path).toBe("second.ts");
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
