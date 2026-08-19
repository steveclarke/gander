// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import LocalWorktreeList from "./LocalWorktreeList.vue";

describe("LocalWorktreeList", () => {
  it("uses native buttons and identifies the selected worktree", async () => {
    const wrapper = mount(LocalWorktreeList, {
      props: {
        worktrees: [
          { path: "/tmp/main", branch: "main", headSha: "a".repeat(40), locked: false },
          { path: "/tmp/feature", branch: "feature", headSha: "b".repeat(40), locked: true },
        ],
        selectedPath: "/tmp/feature",
      },
    });

    const options = wrapper.findAll("button[role='option']");
    expect(options).toHaveLength(2);
    expect(options[0]!.attributes("aria-selected")).toBe("false");
    expect(options[1]!.attributes("aria-selected")).toBe("true");
    await options[0]!.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["/tmp/main"]]);
  });
});
