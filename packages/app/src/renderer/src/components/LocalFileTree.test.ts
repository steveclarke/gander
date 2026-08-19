// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { LocalFileEntry } from "@gander/shared";
import type { Store } from "../store.js";
import LocalFileTree from "./LocalFileTree.vue";

describe("LocalFileTree", () => {
  it("requests directory contents on expansion and selects only files", async () => {
    const entries = reactive<LocalFileEntry[]>([
      { path: "src", kind: "directory" },
      { path: "README.md", kind: "file" },
    ]);
    const loadLocalDirectory = vi.fn(async (directory: string) => {
      entries.push({ path: `${directory}/main.ts`, kind: "file" });
      store.loadedLocalDirectories.push(directory);
    });
    const select = vi.fn();
    const store = reactive({
      localView: {
        worktree: { path: "/tmp/atlas", branch: "feature", headSha: "head", locked: false },
        defaultBranch: "main",
        mergeBaseSha: "base",
        files: [],
      },
      selectedPath: null,
      loadedLocalDirectories: [],
      loadLocalDirectory,
      select,
    }) as unknown as Store;
    const wrapper = mount(LocalFileTree, {
      props: { store, entries, iconTheme: "catppuccin-mocha" },
    });

    expect(wrapper.text()).toContain("src");
    expect(wrapper.text()).toContain("README.md");
    expect(wrapper.text()).not.toContain("main.ts");

    const directory = wrapper.get("button[aria-expanded='false']");
    await directory.trigger("click");
    await flushPromises();

    expect(loadLocalDirectory).toHaveBeenCalledWith("src");
    expect(wrapper.get("button[aria-expanded='true']").text()).toContain("src");
    expect(wrapper.text()).toContain("main.ts");

    const main = wrapper.findAll("button.tnode:not(.isdir)").find((row) => row.text().includes("main.ts"));
    if (!main) throw new Error("main.ts row was not rendered");
    await main.trigger("click");
    expect(select).toHaveBeenCalledWith("src/main.ts");
  });
});
