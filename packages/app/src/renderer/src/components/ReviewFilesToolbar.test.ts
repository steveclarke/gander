// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewFilesToolbar from "./ReviewFilesToolbar.vue";

describe("ReviewFilesToolbar", () => {
  it("exposes every tree action as a mouse-friendly button", async () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: false, hasDirectories: true },
    });

    for (const [label, event] of [
      ["Collapse all folders", "collapseAll"],
      ["Show remaining files only", "toggleRemaining"],
    ] as const) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger("click");
      expect(wrapper.emitted(event)).toHaveLength(1);
    }
  });

  it("shows the remaining filter as pressed and disables folder actions when unavailable", () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: true, hasDirectories: false },
    });

    expect(wrapper.get('[aria-label="Show remaining files only"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.findAll("button:disabled")).toHaveLength(1);
  });
});
