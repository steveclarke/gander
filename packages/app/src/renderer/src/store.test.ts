import { describe, expect, it } from "vitest";
import type { LocalFileEntry, LocalView, PrListItem, PrView } from "@gander/shared";
import type { GanderApi } from "./api.js";
import { createStore, readable } from "./store.js";
import { DEFAULT_APP_SETTINGS } from "../../settings.js";

const prView = (checkedPaths: string[] = []): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
  files: [
    { path: "a.rb", status: "M", baseContent: "o", headContent: "n", baseHash: "b1", headHash: "h1", checked: checkedPaths.includes("a.rb"), changedSince: false },
    { path: "b.rb", status: "A", baseContent: null, headContent: "x", baseHash: null, headHash: "h2", checked: checkedPaths.includes("b.rb"), changedSince: false },
  ],
  notes: [],
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
    listRepos: async () => [{ repoId: "acme/atlas", url: "u", localPath: "/tmp/atlas" }],
    chooseLocalRepo: async () => null,
    removeRepo: async () => {},
    listWorktrees: async () => [],
    listPrs: async () => [{ number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b", reviewProgress: null }],
    openPr: async () => prView(),
    setChecked: async (_r, _n, path, checked) => prView(checked ? [path] : []),
    setCheckedMany: async (_r, _n, paths) => prView(paths),
    refreshPr: async () => prView(),
    lastReview: async () => null,
    initialTarget: async () => null,
    getConnection: async () => ({ url: "http://service", token: "t", githubToken: "", fromEnvironment: false }),
    setGithubToken: async () => ({ ok: true as const, login: "octocat" }),
    testConnection: async () => ({ ok: true, version: "0.1.0", compatibility: "compatible" }),
    setConnection: async () => ({ ok: true, version: "0.1.0", compatibility: "compatible" }),
    onOpenTarget: () => () => {},
    serviceStatus: async () => ({ state: "connected", serviceVersion: "0.1.0", supportedVersion: "0.1.0" }),
    reviewedSnapshot: async () => null,
    imagePreview: async () => ({ base: { kind: "absent" }, head: { kind: "absent" } }),
    openLocal: async () => { throw new Error("no local fixture"); },
    listLocalFiles: async () => [{ path: "working.ts", kind: "file" }],
    localFile: async (_path, filePath) => ({ path: filePath, content: "new\n", hash: "hash", binary: false }),
    refreshLocal: async () => { throw new Error("no local fixture"); },
    localImagePreview: async () => ({ base: { kind: "absent" }, head: { kind: "absent" } }),
    closeLocal: async () => {},
    onLocalViewChanged: () => () => {},
    addNote: async () => prView(),
    addReviewerReply: async () => prView(),
    deleteNote: async () => prView(),
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
    expect(store.targetRepoId).toBe("acme/atlas");
    expect(store.currentRepoId).toBeNull();
    expect(store.prs).toHaveLength(1);
    expect(store.view).toBeNull();
  });

  it("refuses a command-line target that has not been opened from disk", async () => {
    const store = createStore(fakeApi({ listRepos: async () => [] }));
    await store.loadRepos();
    await store.openTarget({ repoId: "acme/new", prNumber: null });
    expect(store.targetRepoId).toBeNull();
    expect(store.error).toBe("acme/new is not registered. Open one of its checkout folders first.");
  });

  // bin/gander registers a repository in the main process as it opens one, which happens
  // after the renderer last read the list. Without the re-read, the first open of a
  // checkout the app has not seen always failed.
  it("re-reads the repository list before refusing a target", async () => {
    let registered = false;
    const store = createStore(fakeApi({
      listRepos: async () => (registered ? [{ repoId: "acme/atlas", url: "u", localPath: "/p" }] : []),
    }));
    await store.loadRepos();
    registered = true;

    await store.openTarget({ repoId: "acme/atlas", prNumber: null });

    expect(store.error).toBeNull();
    expect(store.targetRepoId).toBe("acme/atlas");
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
    expect(store.prs[0]?.reviewProgress).toEqual({ done: 1, total: 2 });
    await store.setChecked("a.rb", false);
    expect(store.prs[0]?.reviewProgress).toEqual({ done: 0, total: 2 });
  });

  it("registers and selects a repository from a chosen checkout", async () => {
    const store = createStore(fakeApi({
      chooseLocalRepo: async () => ({ repoId: "acme/new", url: "https://github.com/acme/new", localPath: "/tmp/new" }),
      listRepos: async () => [{ repoId: "acme/new", url: "https://github.com/acme/new", localPath: "/tmp/new" }],
    }));
    await store.chooseLocalRepo();
    expect(store.targetRepoId).toBe("acme/new");
    expect(store.currentRepoId).toBeNull();
    expect(store.prs).toHaveLength(1);
  });

  it("removes a repository without leaving its local view active", async () => {
    const opened = localView();
    let removed: string | null = null;
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
      removeRepo: async (repoId) => { removed = repoId; },
      listRepos: async () => removed === null
        ? [{ repoId: "acme/atlas", url: "u", localPath: "/tmp/atlas" }]
        : [],
    }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);

    await store.removeRepo("acme/atlas");

    expect(removed).toBe("acme/atlas");
    expect(store.repos).toEqual([]);
    expect(store.targetRepoId).toBeNull();
    expect(store.localView).toBeNull();
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
    expect(store.targetWorktreePath).toBe(opened.worktree.path);
    expect(store.localFile?.content).toBe("new\n");
  });

  it("loads Explorer directories only when the reviewer expands them", async () => {
    const opened = localView();
    const requested: string[] = [];
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
      listLocalFiles: async (_path, directory = "") => {
        requested.push(directory);
        return directory === ""
          ? [{ path: "src", kind: "directory" }, { path: "README.md", kind: "file" }]
          : [{ path: "src/main.ts", kind: "file" }];
      },
    }));

    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);

    expect(requested).toEqual([""]);
    expect(store.localFiles).toEqual([
      { path: "src", kind: "directory" },
      { path: "README.md", kind: "file" },
    ]);
    expect(store.selectedPath).toBe("README.md");

    await store.loadLocalDirectory("src");
    expect(requested).toEqual(["", "src"]);
    expect(store.localFiles).toContainEqual({ path: "src/main.ts", kind: "file" });
    expect(store.loadedLocalDirectories).toEqual(["src"]);
  });

  it("keeps the worktree and pull request targets while moving between their views", async () => {
    const opened = localView();
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
    }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);
    store.showLocalSurface("changes");
    await store.openPr(1);

    expect(store.targetRepoId).toBe("acme/atlas");
    expect(store.targetWorktreePath).toBe(opened.worktree.path);
    expect(store.selectedPrNumber).toBe(1);
    expect(store.view?.pr.number).toBe(1);

    await store.openLocal(opened.worktree.path);
    expect(store.localView?.worktree.path).toBe(opened.worktree.path);
    expect(store.selectedPrNumber).toBe(1);
  });

  it("retains the chosen worktree when the current repository is targeted again", async () => {
    const main = localView().worktree;
    const feature = { ...main, path: "/tmp/feature-worktree", branch: "feature/filters" };
    const store = createStore(fakeApi({
      listWorktrees: async () => [main, feature],
      openLocal: async (_repoId, path) => localView().worktree.path === path
        ? localView()
        : { ...localView(), worktree: feature },
    }));

    await store.selectRepo("acme/atlas");
    await store.openLocal(feature.path);
    await store.selectRepo("acme/atlas");

    expect(store.targetWorktreePath).toBe(feature.path);
  });

  it("changes the global target and closes the previous repository view", async () => {
    const opened = localView();
    let closeCalls = 0;
    const store = createStore(fakeApi({
      listWorktrees: async () => [opened.worktree],
      openLocal: async () => opened,
      closeLocal: async () => { closeCalls++; },
    }));
    await store.selectRepo("acme/atlas");
    await store.openLocal(opened.worktree.path);

    await store.selectRepo("acme/other");

    expect(store.targetRepoId).toBe("acme/other");
    expect(store.currentRepoId).toBeNull();
    expect(store.localView).toBeNull();
    expect(store.selectedPrNumber).toBeNull();
    expect(closeCalls).toBe(1);
  });

  it("does not let a slow repository load replace the newer target", async () => {
    let resolveFirst!: (prs: PrListItem[]) => void;
    const first = new Promise<PrListItem[]>((resolve) => { resolveFirst = resolve; });
    const store = createStore(fakeApi({
      listPrs: async (repoId) => repoId === "acme/first" ? first : [{ ...prView().pr, number: 2, title: "Second", reviewProgress: null }],
    }));

    const slow = store.selectRepo("acme/first");
    await store.selectRepo("acme/second");
    resolveFirst([{ ...prView().pr, title: "First", reviewProgress: null }]);
    await slow;

    expect(store.targetRepoId).toBe("acme/second");
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
    let resolveOld!: (files: LocalFileEntry[]) => void;
    const store = createStore(fakeApi({
      openLocal: async (_repo, path) => path === first.worktree.path ? first : second,
      listLocalFiles: async (path) => {
        if (path === first.worktree.path && deferFirst) return new Promise((resolve) => { resolveOld = resolve; });
        return [{ path: path === first.worktree.path ? "first.ts" : "second.ts", kind: "file" }];
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
    resolveOld([{ path: "stale.ts", kind: "file" }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.localView?.worktree.path).toBe(second.worktree.path);
    expect(store.localFiles).toEqual([{ path: "second.ts", kind: "file" }]);
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

    it("records the service handshake state", async () => {
      const store = createStore(fakeApi({ serviceStatus: async () => ({ state: "unreachable", reason: "network down" }) }));
      await store.checkService();
      expect(store.serviceStatus).toEqual({ state: "unreachable", reason: "network down" });
    });

    it("clears a recovered read-only connection error without hiding a failed change", async () => {
      const unreachable = { state: "unreachable" as const, reason: "Could not reach http://service: fetch failed" };
      let connected = false;
      const store = createStore(fakeApi({
        serviceStatus: async () => connected
          ? { state: "connected", serviceVersion: "0.1.0", supportedVersion: "0.1.0" }
          : unreachable,
      }));

      await store.checkService();
      store.error = unreachable.reason;
      connected = true;
      await store.checkService();
      expect(store.error).toBeNull();

      store.error = `${unreachable.reason} This change was not saved and will not be retried.`;
      await store.checkService();
      expect(store.error).toContain("not saved");
    });

    it("clears a stale connection error restored after the health check already recovered", async () => {
      const store = createStore(fakeApi());

      await store.checkService();
      store.error = "Could not reach https://gander.example.test: fetch failed";
      await store.checkService();

      expect(store.error).toBeNull();
    });

    it("shows cached mode immediately when refresh falls back while the service is down", async () => {
      let status: "connected" | "unreachable" = "connected";
      const store = createStore(fakeApi({
        refreshPr: async () => prView(),
        serviceStatus: async () => status === "connected"
          ? { state: "connected", serviceVersion: "0.1.0", supportedVersion: "0.1.0" }
          : { state: "unreachable", reason: "network down" },
      }));
      await store.loadRepos();
      await store.selectRepo("acme/atlas");
      await store.openPr(1);

      status = "unreachable";
      await store.refresh();
      expect(store.view?.files).toHaveLength(2);
      expect(store.serviceStatus).toEqual({ state: "unreachable", reason: "network down" });
    });
  });

  it("shows the message without Electron's IPC wrapper", () => {
    expect(readable("Error invoking remote method 'gander:listPrs': Error: The review service at http://x does not have GET /api/reviews/a%2Fb."))
      .toBe("The review service at http://x does not have GET /api/reviews/a%2Fb.");
    expect(readable("plain trouble")).toBe("plain trouble");
  });
});
