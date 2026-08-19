// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextTabs from "./ContextTabs.vue";

const tabs = [
  { key: "local:acme/atlas:/tmp/feature", type: "local" as const, repoId: "acme/atlas", path: "/tmp/feature", label: "feature", selectedPath: null, surface: "explorer" as const },
  { key: "pr:acme/atlas:7", type: "pr" as const, repoId: "acme/atlas", prNumber: 7, label: "Improve search", selectedPath: null },
];

describe("ContextTabs", () => {
  it("uses separate tab and close buttons with roving keyboard activation", async () => {
    const wrapper = mount(ContextTabs, { props: { tabs, activeKey: tabs[0]!.key, integratedTitleBar: false } });
    const tabButtons = wrapper.findAll("[role='tab']");
    expect(tabButtons.map((tab) => tab.attributes("tabindex"))).toEqual(["0", "-1"]);
    expect(wrapper.findAll(".context-tab > button")).toHaveLength(4);

    await tabButtons[0]!.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("activate")).toEqual([[tabs[1]!.key]]);
    await wrapper.get(`button[aria-label='Close ${tabs[0]!.label}']`).trigger("click");
    expect(wrapper.emitted("close")).toEqual([[tabs[0]!.key]]);
  });
});
