// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Store } from "../store.js";
import TargetBar from "./TargetBar.vue";

const pr = (number: number, headRef: string, title: string) => ({
  number, title, body: "", draft: false, baseRef: "main", baseSha: "a", headRef, headSha: "b",
  stack: null, reviewProgress: null,
});

const store = {
  repos: [
    { repoId: "acme/atlas", url: "https://github.com/acme/atlas", localPath: "/tmp/atlas" },
    { repoId: "acme/beacon", url: "https://github.com/acme/beacon", localPath: "/tmp/beacon" },
  ],
  worktrees: [
    { path: "/tmp/atlas", branch: "main", headSha: "a".repeat(40), locked: false },
    { path: "/tmp/atlas-feature", branch: "feature/search", headSha: "b".repeat(40), locked: false },
  ],
  prs: [pr(7, "feature/search", "Search across notes")],
  targetRepoId: "acme/atlas",
  targetWorktreePath: "/tmp/atlas-feature",
  currentRepoId: null,
  view: null,
  busy: false,
} as unknown as Store;

describe("TargetBar", () => {
  it("keeps repository and worktree selection above the workspace modes", async () => {
    const wrapper = mount(TargetBar, { props: { store, integratedTitleBar: false } });
    const trigger = wrapper.get("button[aria-controls='target-picker']");
    expect(trigger.text()).toContain("atlas");
    expect(trigger.text()).toContain("feature/search");

    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("#repositories-heading").text()).toBe("Repositories");
    expect(wrapper.get("#worktrees-heading").text()).toBe("Worktrees");

    await wrapper.findAll(".worktree-row")[0]!.trigger("click");
    expect(wrapper.emitted("selectWorktree")).toEqual([["/tmp/atlas"]]);
  });

  it("places opening a repository inside the target switcher", async () => {
    const wrapper = mount(TargetBar, { props: { store, integratedTitleBar: false } });
    expect(wrapper.find(".open-folder").exists()).toBe(false);

    await wrapper.get("button[aria-controls='target-picker']").trigger("click");
    await wrapper.get(".open-folder").trigger("click");
    expect(wrapper.emitted("openFolder")).toHaveLength(1);
  });

  it("offers explicit relocation and removal for the selected repository", async () => {
    const wrapper = mount(TargetBar, { props: { store, integratedTitleBar: false } });
    await wrapper.get("button[aria-controls='target-picker']").trigger("click");

    const actions = wrapper.findAll(".repository-action");
    expect(actions.map((action) => action.text())).toEqual([
      "Locate this repository…",
      "Remove this repository",
    ]);
    await actions[0]!.trigger("click");
    expect(wrapper.emitted("locateRepo")).toEqual([["acme/atlas"]]);
  });
});

describe("TargetBar and its pull requests", () => {
  it("names the pull request open on a worktree's branch, and opens it", async () => {
    // The branch and its pull request are the same work. Leaving them unconnected made the
    // pull request list look wrong to a reviewer who had just selected that branch.
    const wrapper = mount(TargetBar, { props: { store, integratedTitleBar: false } });
    await wrapper.get("button[aria-controls='target-picker']").trigger("click");

    const badges = wrapper.findAll(".pr-badge");
    expect(badges).toHaveLength(1); // only feature/search has one open
    expect(badges[0]!.text()).toBe("#7");

    await badges[0]!.trigger("click");
    expect(wrapper.emitted("selectPr")).toEqual([[7]]);
    expect(wrapper.emitted("selectWorktree")).toBeUndefined(); // the row underneath stays untouched
  });

  it("names the pull request being reviewed rather than a worktree nobody is looking at", async () => {
    const reviewing = { ...store, currentRepoId: "acme/atlas", view: { pr: pr(7, "feature/search", "Search across notes"), files: [], notes: [] } } as unknown as Store;
    const wrapper = mount(TargetBar, { props: { store: reviewing, integratedTitleBar: false } });

    const trigger = wrapper.get("button[aria-controls='target-picker']");
    expect(trigger.text()).toContain("#7 Search across notes");
    expect(trigger.text()).not.toContain("feature/search");
  });

  it("keeps naming the worktree while a pull request from another repository is loaded", async () => {
    const elsewhere = { ...store, currentRepoId: "acme/beacon", view: { pr: pr(9, "other", "Elsewhere"), files: [], notes: [] } } as unknown as Store;
    const wrapper = mount(TargetBar, { props: { store: elsewhere, integratedTitleBar: false } });

    expect(wrapper.get("button[aria-controls='target-picker']").text()).toContain("feature/search");
  });
});
