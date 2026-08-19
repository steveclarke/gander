// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Store } from "../store.js";
import TargetBar from "./TargetBar.vue";

const store = {
  repos: [
    { repoId: "acme/atlas", url: "https://github.com/acme/atlas", localPath: "/tmp/atlas" },
    { repoId: "acme/beacon", url: "https://github.com/acme/beacon", localPath: "/tmp/beacon" },
  ],
  worktrees: [
    { path: "/tmp/atlas", branch: "main", headSha: "a".repeat(40), locked: false },
    { path: "/tmp/atlas-feature", branch: "feature/search", headSha: "b".repeat(40), locked: false },
  ],
  targetRepoId: "acme/atlas",
  targetWorktreePath: "/tmp/atlas-feature",
  busy: false,
} as Store;

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

    await wrapper.get(".worktree-row:nth-of-type(1)").trigger("click");
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
