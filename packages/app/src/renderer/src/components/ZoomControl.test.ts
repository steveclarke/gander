// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from "../../../zoom.js";
import ZoomControl from "./ZoomControl.vue";

describe("ZoomControl", () => {
  it("shows the effective percentage and exposes named toolbar actions", () => {
    const wrapper = mount(ZoomControl, { props: { level: 0.5 } });

    expect(wrapper.get(".zoom-trigger").text()).toBe("110%");
    expect(wrapper.get(".zoom-trigger").attributes("aria-label")).toBe("Zoom: 110%");
    expect(wrapper.get("button[aria-label='Zoom out']").attributes("title")).toBe("Zoom out");
    expect(wrapper.get("button[aria-label='Zoom in']").attributes("title")).toBe("Zoom in");
    expect(wrapper.get("button[aria-label='Reset zoom to 100%']").text()).toContain("Reset");
  });

  it("emits increment, decrement, and reset levels", async () => {
    const wrapper = mount(ZoomControl, { props: { level: 1 } });

    await wrapper.get("button[aria-label='Zoom out']").trigger("click");
    await wrapper.get("button[aria-label='Zoom in']").trigger("click");
    await wrapper.get("button[aria-label='Reset zoom to 100%']").trigger("click");

    expect(wrapper.emitted("change")).toEqual([[0.5], [1.5], [0]]);
  });

  it("disables only the action that would exceed a limit", async () => {
    const wrapper = mount(ZoomControl, { props: { level: ZOOM_LEVEL_MIN } });
    expect(wrapper.get("button[aria-label='Zoom out']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button[aria-label='Zoom in']").attributes("disabled")).toBeUndefined();

    await wrapper.setProps({ level: ZOOM_LEVEL_MAX });
    expect(wrapper.get("button[aria-label='Zoom out']").attributes("disabled")).toBeUndefined();
    expect(wrapper.get("button[aria-label='Zoom in']").attributes("disabled")).toBeDefined();
  });
});
