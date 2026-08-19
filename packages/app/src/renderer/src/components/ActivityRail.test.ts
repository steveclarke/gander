// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ActivityRail from "./ActivityRail.vue";

describe("ActivityRail", () => {
  it("keeps every repository lens available while a local target is selected", async () => {
    const wrapper = mount(ActivityRail, {
      props: { active: "pulls", hasTarget: true },
    });

    expect(wrapper.get("button[aria-label='Explorer']").attributes("disabled")).toBeUndefined();
    expect(wrapper.get("button[aria-label='Current Diff']").attributes("disabled")).toBeUndefined();
    expect(wrapper.get("button[aria-label='Pull Requests']").attributes("disabled")).toBeUndefined();

    await wrapper.get("button[aria-label='Explorer']").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["explorer"]]);
  });

  it("disables every repository lens when no valid local target exists", () => {
    const wrapper = mount(ActivityRail, {
      props: { active: "settings", hasTarget: false },
    });

    expect(wrapper.get("button[aria-label='Explorer']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button[aria-label='Current Diff']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button[aria-label='Pull Requests']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button[aria-label='Editor settings']").attributes("disabled")).toBeUndefined();
  });
});
