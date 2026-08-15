import { describe, expect, it } from "vitest";
import type { PrView } from "@gander/shared";
import type { GanderApi } from "./api.js";
import { createStore } from "./store.js";

const prView = (checkedPaths: string[] = []): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headSha: "b" },
  files: [
    { path: "a.rb", status: "M", baseContent: "o", headContent: "n", baseHash: "b1", headHash: "h1", checked: checkedPaths.includes("a.rb"), changedSince: false },
    { path: "b.rb", status: "A", baseContent: null, headContent: "x", baseHash: null, headHash: "h2", checked: checkedPaths.includes("b.rb"), changedSince: false },
  ],
});

function fakeApi(overrides: Partial<GanderApi> = {}): GanderApi {
  return {
    listRepos: async () => [{ repoId: "acme/atlas", url: "u" }],
    addRepo: async (url) => ({ repoId: "acme/new", url }),
    listPrs: async () => [{ number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headSha: "b" }],
    openPr: async () => prView(),
    setChecked: async (_r, _n, path) => prView([path]),
    setCheckedMany: async (_r, _n, paths) => prView(paths),
    refreshPr: async () => prView(),
    ...overrides,
  };
}

describe("store", () => {
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
});
