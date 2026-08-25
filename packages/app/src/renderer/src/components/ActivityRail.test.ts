// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ActivityRail from "./ActivityRail.vue";

describe("ActivityRail", () => {
  beforeEach(() => localStorage.clear());

  it("puts Pull Requests first by default", () => {
    const wrapper = mount(ActivityRail, {
      props: { active: "pulls", hasTarget: true },
    });

    expect(wrapper.findAll(".rail-action").map((button) => button.attributes("aria-label"))).toEqual([
      "Pull Requests",
      "Explorer",
      "Current Diff",
      "Editor settings",
    ]);
  });

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

  it("moves a focused view with Alt+Arrow and remembers the order", async () => {
    const wrapper = mount(ActivityRail, {
      props: { active: "pulls", hasTarget: true },
    });

    await wrapper.get("button[aria-label='Pull Requests']").trigger("keydown", { altKey: true, key: "ArrowDown" });

    expect(wrapper.findAll(".rail-action").map((button) => button.attributes("aria-label"))).toEqual([
      "Explorer",
      "Pull Requests",
      "Current Diff",
      "Editor settings",
    ]);
    expect(JSON.parse(localStorage.getItem("gander.activityOrder") ?? "null")).toEqual([
      "explorer",
      "pulls",
      "changes",
    ]);
  });
});
