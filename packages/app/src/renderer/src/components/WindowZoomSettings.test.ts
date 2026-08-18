// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../../settings.js";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import WindowZoomSettings from "./WindowZoomSettings.vue";

describe("WindowZoomSettings", () => {
  it("saves fractional default zoom and resets it to 100%", async () => {
    const update = vi.fn(async (settings: AppSettings) => {
      store.settings = settings;
      return true;
    });
    const store: EditorSettingsStore = reactive({
      settings: DEFAULT_APP_SETTINGS,
      busy: false,
      error: null,
      async load() {},
      update,
    });
    const wrapper = mount(WindowZoomSettings, { props: { store } });
    const input = wrapper.get("input[name='window.zoomLevel']");

    expect((input.element as HTMLInputElement).value).toBe("0");
    expect(wrapper.get("#window-zoom-percentage").text()).toBe("100%");
    await input.setValue("0.5");
    await input.trigger("change");
    await flushPromises();
    expect(update).toHaveBeenLastCalledWith({
      ...DEFAULT_APP_SETTINGS,
      window: { zoomLevel: 0.5 },
    });
    expect(wrapper.get("#window-zoom-percentage").text()).toBe("110%");

    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(update).toHaveBeenLastCalledWith(DEFAULT_APP_SETTINGS);
  });
});
