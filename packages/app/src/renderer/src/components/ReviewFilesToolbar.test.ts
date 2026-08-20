// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewFilesToolbar from "./ReviewFilesToolbar.vue";

describe("ReviewFilesToolbar", () => {
  it("exposes every tree action as a mouse-friendly button", async () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: false, hasDirectories: true, allDirectoriesCollapsed: false },
    });

    for (const [label, event] of [
      ["Collapse all folders", "toggleAll"],
      ["Show remaining files only", "toggleRemaining"],
    ] as const) {
      const button = wrapper.get(`button[aria-label="${label}"]`);
      expect(button.text()).toBe("");
      await button.trigger("click");
      expect(wrapper.emitted(event)).toHaveLength(1);
    }
  });

  it("shows the remaining filter as pressed and disables folder actions when unavailable", () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: true, hasDirectories: false, allDirectoriesCollapsed: false },
    });

    expect(wrapper.get('[aria-label="Show remaining files only"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.findAll("button:disabled")).toHaveLength(1);
  });

  it("becomes an expand-all action when every folder is collapsed", async () => {
    const wrapper = mount(ReviewFilesToolbar, {
      props: { remainingOnly: false, hasDirectories: true, allDirectoriesCollapsed: false },
    });

    expect(wrapper.find('[aria-label="Collapse all folders"]').exists()).toBe(true);
    await wrapper.setProps({ allDirectoriesCollapsed: true });
    expect(wrapper.find('[aria-label="Expand all folders"]').exists()).toBe(true);
  });
});
