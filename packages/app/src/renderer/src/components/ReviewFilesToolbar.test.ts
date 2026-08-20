// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewFilesToolbar from "./ReviewFilesToolbar.vue";

describe("ReviewFilesToolbar", () => {
  it("exposes every tree action as a mouse-friendly button", async () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: false, remainingCount: 3, totalCount: 5, hasDirectories: true },
    });

    expect(wrapper.text()).toContain("3 of 5 remaining");
    for (const [label, event] of [
      ["Expand all folders", "expandAll"],
      ["Collapse reviewed folders", "collapseReviewed"],
      ["Collapse all folders", "collapseAll"],
      ["Show remaining files only", "toggleRemaining"],
    ] as const) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger("click");
      expect(wrapper.emitted(event)).toHaveLength(1);
    }
  });

  it("shows the remaining filter as pressed and disables folder actions when unavailable", () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: true, remainingCount: 0, totalCount: 1, hasDirectories: false },
    });

    expect(wrapper.get('[aria-label="Show remaining files only"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.findAll("button:disabled")).toHaveLength(3);
  });
});
