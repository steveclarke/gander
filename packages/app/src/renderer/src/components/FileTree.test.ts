// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrFile, PrView } from "@gander/shared";
import type { Store } from "../store.js";
import FileTree from "./FileTree.vue";
import { collapsedDirs } from "../tree-nav.js";
import { jumpTargets } from "../tree-jump.js";

const file = (path: string, checked = false): PrFile =>
  ({ path, status: "M", baseContent: "", headContent: "", baseHash: "b", headHash: "h", checked, changedSince: false });

function prView(prNumber: number, files: PrFile[], notes: PrView["notes"] = []): PrView {
  return {
    pr: { number: prNumber, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
    files,
    notes,
  };
}

interface Calls {
  setChecked: [string, boolean][];
  setCheckedMany: [string[], boolean][];
}

function fakeStore(view: PrView): { store: Store; calls: Calls } {
  const calls: Calls = { setChecked: [], setCheckedMany: [] };
  const store: Store = reactive({
    repos: [],
    prs: [],
    worktrees: [],
    currentRepoId: "acme/atlas",
    targetRepoId: "acme/atlas",
    targetWorktreePath: null,
    selectedPrNumber: 1,
    view,
    localView: null,
    selectedPath: view.files[0]!.path,
    localFiles: [],
    loadedLocalDirectories: [],
    localFile: null,
    localSurface: "explorer",
    error: null,
    serviceStatus: { state: "connected", serviceVersion: "0.1.0", supportedVersion: "0.1.0" },
    lastFetchAt: null,
    busy: false,
    async loadRepos() {},
    async restoreLastReview() {},
    async checkService() {},
    dismissError() {},
    async chooseLocalRepo() { return false; },
    async removeRepo() {},
    async openTarget() {},
    async selectRepo() {},
    async openPr() {},
    async openLocal() {},
    async loadLocalDirectory() {},
    showLocalSurface() {},
    async refresh() {},
    async fetchNow() {},
    async reviewedSnapshot() { return null; },
    async imagePreview() { return null; },
    async addNote() {},
    async deleteNote() {},
    async setChecked(path: string, checked: boolean) {
      calls.setChecked.push([path, checked]);
    },
    async setCheckedMany(paths: string[], checked: boolean) {
      calls.setCheckedMany.push([paths, checked]);
    },
    select(path: string) {
      store.selectedPath = path;
    },
    files() { return store.localView?.files ?? store.view?.files ?? []; },
    isLocal() { return store.localView !== null; },
    progress() {
      return { done: 0, total: 0 };
    },
  });
  return { store, calls };
}

function dirRow(wrapper: VueWrapper, name: string) {
  const row = wrapper.findAll(".tnode.isdir").find((n) => n.find(".fname").text() === name);
  if (!row) throw new Error(`no dir row named ${name}`);
  return row;
}

function fileRow(wrapper: VueWrapper, path: string) {
  const rows = wrapper.findAll(".tnode:not(.isdir)");
  const row = rows.find((n) => n.find(".fname").text() === path.split("/").pop());
  if (!row) throw new Error(`no file row for ${path}`);
  return row;
}

describe("FileTree", () => {
  // Collapse state is shared across the tree's recursive levels, so it outlives a mount.
  beforeEach(() => collapsedDirs.clear());

  const treeFiles = [
    file("app/models/member.rb", false),
    file("app/services/dues/late_fee_calculator.rb", true),
    file("app/other.rb", false),
    file("config/routes.rb", true),
  ];

  it("checking a directory issues exactly one batched setCheckedMany call covering every descendant, and never calls setChecked", async () => {
    const { store, calls } = fakeStore(prView(1, treeFiles));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    await dirRow(wrapper, "app").find(".cb").trigger("click");

    expect(calls.setChecked).toEqual([]);
    expect(calls.setCheckedMany).toHaveLength(1);
    const [paths, checked] = calls.setCheckedMany[0]!;
    expect(paths.sort()).toEqual(["app/models/member.rb", "app/other.rb", "app/services/dues/late_fee_calculator.rb"].sort());
    expect(checked).toBe(true); // some descendants were unchecked, so the batch checks all
  });

  it("clicking a file's checkbox toggles it without changing selectedPath", async () => {
    const { store, calls } = fakeStore(prView(1, treeFiles));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });
    const before = store.selectedPath;

    await fileRow(wrapper, "config/routes.rb").find(".cb").trigger("click");

    expect(store.selectedPath).toBe(before);
    expect(calls.setChecked).toEqual([["config/routes.rb", false]]);
  });

  it("clicking a directory row toggles collapse without touching checked state", async () => {
    const { store, calls } = fakeStore(prView(1, treeFiles));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    await dirRow(wrapper, "app").trigger("click");

    expect(calls.setChecked).toEqual([]);
    expect(calls.setCheckedMany).toEqual([]);
  });

  it("resets collapse state when the reviewed PR changes, even though view is reassigned without an intermediate null", async () => {
    const { store } = fakeStore(prView(1, treeFiles));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    // collapse "app"
    await dirRow(wrapper, "app").trigger("click");
    expect(dirRow(wrapper, "app").find(".chev").classes()).toContain("lucide-chevron-right");
    expect(wrapper.text()).not.toContain("member.rb"); // collapsed: app's children are hidden

    // switch PR within the same repo the way store.openPr does: reassign `view` directly, no null in between
    store.view = prView(2, [
      file("app/other.rb", false),
      file("app/models/member.rb", false),
      file("config/routes.rb", false),
    ]);
    await nextTick();

    expect(dirRow(wrapper, "app").find(".chev").classes()).toContain("lucide-chevron-down");
    expect(wrapper.text()).toContain("member.rb");
  });

  it("keeps every row drawn while marking name matches and showing one-key hints", () => {
    const { store } = fakeStore(prView(1, treeFiles));
    const targets = jumpTargets(treeFiles, "r");
    const wrapper = mount(FileTree, {
      props: {
        store,
        iconTheme: "catppuccin-mocha",
        jumpTargets: new Map(targets.map((target) => [target.path, target])),
      },
    });

    expect(wrapper.findAll(".tnode")).toHaveLength(8);
    expect(dirRow(wrapper, "app").find("mark").exists()).toBe(false);
    expect(dirRow(wrapper, "services/dues").find("mark").text()).toBe("r");

    const member = fileRow(wrapper, "app/models/member.rb");
    expect(member.find(".fname").text()).toBe("member.rb");
    expect(member.find("mark").text()).toBe("r");
    expect(member.find(".jump-label").text()).toMatch(/^[A-Z]$/);
    expect(member.find(".jump-label").attributes("aria-hidden")).toBe("true");
    expect(member.attributes("aria-keyshortcuts")).toBe(`Shift+${member.find(".jump-label").text()}`);
  });

  it("keeps file and directory hierarchy columns aligned at every depth", () => {
    const leaf = file("src/nested/deeper/leaf.rb");
    leaf.status = "A";
    leaf.changedSince = true;
    const { store } = fakeStore(prView(1, [
      file("root.rb"),
      file("src/top.rb"),
      file("src/nested/middle.rb"),
      leaf,
    ], [{
      id: 1,
      path: leaf.path,
      line: 1,
      text: "Check this line",
      state: "open",
      headSha: "b",
      commitRef: null,
      summary: null,
      createdAt: "2026-08-18T00:00:00.000Z",
    }]));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    const rows = [
      { row: dirRow(wrapper, "src"), paddingLeft: "10px" },
      { row: fileRow(wrapper, "root.rb"), paddingLeft: "10px" },
      { row: dirRow(wrapper, "nested"), paddingLeft: "26px" },
      { row: fileRow(wrapper, "src/top.rb"), paddingLeft: "26px" },
      { row: dirRow(wrapper, "deeper"), paddingLeft: "42px" },
      { row: fileRow(wrapper, "src/nested/middle.rb"), paddingLeft: "42px" },
      { row: fileRow(wrapper, "src/nested/deeper/leaf.rb"), paddingLeft: "58px" },
    ];

    for (const { row, paddingLeft } of rows) {
      expect((row.element as HTMLElement).style.paddingLeft).toBe(paddingLeft);
      expect(row.element.children[0]?.classList).toContain("hierarchy-slot");
      expect(row.element.children[1]?.classList).toContain("cb");
      expect(row.element.children[2]?.classList).toContain("file-icon");
    }

    const leafRow = fileRow(wrapper, leaf.path);
    expect(leafRow.find(".note-mark").exists()).toBe(true);
    expect(leafRow.find(".delta-mark").exists()).toBe(true);
    expect(leafRow.find(".st").text()).toBe("A");
    expect(wrapper.findAll(".tnode.isdir .chev")).toHaveLength(3);
  });

  it("counts unresolved notes on a file and leaves resolved ones out", () => {
    const target = file("app/models/member.rb");
    const other = file("app/models/local.rb");
    const note = (id: number, path: string, state: "open" | "addressed" | "resolved") => ({
      id,
      path,
      line: id,
      text: `Note ${id}`,
      state,
      headSha: "b",
      commitRef: null,
      summary: null,
      createdAt: "2026-08-18T00:00:00.000Z",
    });
    const { store } = fakeStore(prView(1, [target, other], [
      note(1, target.path, "open"),
      note(2, target.path, "addressed"),
      note(3, target.path, "resolved"),
      note(4, other.path, "resolved"),
    ]));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    const marker = fileRow(wrapper, target.path).find(".note-mark");
    expect(marker.find(".note-count").text()).toBe("2");
    expect(marker.attributes("title")).toBe("2 unresolved notes on this file");
    // Its only note is resolved, so the file carries no marker at all.
    expect(fileRow(wrapper, other.path).find(".note-mark").exists()).toBe(false);
  });

  it("shows the marker without a number when a file has a single note", () => {
    const target = file("app/models/member.rb");
    const { store } = fakeStore(prView(1, [target], [{
      id: 1,
      path: target.path,
      line: 1,
      text: "Check this line",
      state: "open" as const,
      headSha: "b",
      commitRef: null,
      summary: null,
      createdAt: "2026-08-18T00:00:00.000Z",
    }]));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    const marker = fileRow(wrapper, target.path).find(".note-mark");
    expect(marker.exists()).toBe(true);
    expect(marker.find(".note-count").exists()).toBe(false);
    expect(marker.attributes("title")).toBe("1 unresolved note on this file");
  });

  it("applies effective typography once at the root so every nested row inherits it", () => {
    const { store } = fakeStore(prView(1, treeFiles));
    const wrapper = mount(FileTree, {
      props: {
        store,
        iconTheme: "catppuccin-mocha",
        typography: { fontFamily: "Inter, system-ui", fontSize: 14.5 },
      },
    });

    const trees = wrapper.findAll(".tree");
    expect(trees[0]!.attributes("style")).toContain("font-family: Inter, system-ui");
    expect(trees[0]!.attributes("style")).toContain("font-size: 14.5px");
    for (const nestedTree of trees.slice(1)) {
      expect(nestedTree.attributes("style")).toBeUndefined();
    }
    expect(wrapper.findAll(".tnode .fname")).toHaveLength(wrapper.findAll(".tnode").length);
  });

  it("renders representative Catppuccin file and folder icons with expanded state", async () => {
    const { store } = fakeStore(prView(1, [
      file("Gemfile"),
      file("README.md"),
      file("app/models/member.rb"),
      file("config/settings.json"),
      file("src/App.vue"),
      file("src/main.ts"),
      file("types/index.d.ts"),
      file("unknown/file.mystery"),
    ]));
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    expect(fileRow(wrapper, "Gemfile").find(".file-icon").attributes("data-icon-id")).toBe("ruby-gem");
    expect(fileRow(wrapper, "README.md").find(".file-icon").attributes("data-icon-id")).toBe("readme");
    expect(fileRow(wrapper, "app/models/member.rb").find(".file-icon").attributes("data-icon-id")).toBe("ruby");
    expect(fileRow(wrapper, "config/settings.json").find(".file-icon").attributes("data-icon-id")).toBe("json");
    expect(fileRow(wrapper, "src/App.vue").find(".file-icon").attributes("data-icon-id")).toBe("vue");
    expect(fileRow(wrapper, "src/main.ts").find(".file-icon").attributes("data-icon-id")).toBe("typescript");
    expect(fileRow(wrapper, "types/index.d.ts").find(".file-icon").attributes("data-icon-id")).toBe("typescript-def");
    expect(fileRow(wrapper, "unknown/file.mystery").find(".file-icon").attributes("data-icon-id")).toBe("_file");

    const src = dirRow(wrapper, "src");
    expect(src.find(".file-icon").attributes("data-icon-id")).toBe("folder_src_open");
    expect(src.find(".chev").exists()).toBe(true);
    await src.trigger("click");
    expect(dirRow(wrapper, "src").find(".file-icon").attributes("data-icon-id")).toBe("folder_src");
    expect(store.selectedPath).toBe("Gemfile");
  });

  it("renders local changes without checkoffs, snapshots, changed-since markers, or notes", () => {
    const { store } = fakeStore(prView(1, [file("src/local.ts")]));
    store.localView = {
      worktree: { path: "/tmp/local", branch: "feature", headSha: "head", locked: false },
      defaultBranch: "main",
      mergeBaseSha: "base",
      files: [{ path: "src/local.ts", status: "M", baseContent: "old", headContent: "new", baseHash: "b", headHash: "h" }],
    };
    store.view = null;
    store.selectedPath = "src/local.ts";
    const wrapper = mount(FileTree, { props: { store, iconTheme: "catppuccin-mocha" } });

    expect(wrapper.get(".fname").text()).toBe("src");
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(0);
    expect(wrapper.find(".note-mark").exists()).toBe(false);
    expect(wrapper.find(".delta-mark").exists()).toBe(false);
    expect(fileRow(wrapper, "src/local.ts").get(".st").text()).toBe("M");
  });
});
