// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../../settings.js";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import WorkbenchSettings from "./WorkbenchSettings.vue";

describe("WorkbenchSettings", () => {
  it("lists bundled themes and saves the selected registry identifier", async () => {
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
    const wrapper = mount(WorkbenchSettings, { props: { store } });

    const select = wrapper.get("select[name='workbench.colorTheme']");
    const iconSelect = wrapper.get("select[name='workbench.iconTheme']");
    expect((select.element as HTMLSelectElement).value).toBe("Catppuccin Mocha");
    expect(select.findAll("option").map((option) => option.text())).toEqual([
      "Catppuccin Mocha",
      "Gander Dark",
    ]);
    expect((iconSelect.element as HTMLSelectElement).value).toBe("catppuccin-mocha");
    expect(iconSelect.findAll("option").map((option) => option.text())).toEqual(["Catppuccin Mocha"]);

    await select.setValue("Gander Dark");
    expect(update).toHaveBeenCalledWith({
      ...DEFAULT_APP_SETTINGS,
      workbench: { colorTheme: "Gander Dark", iconTheme: "catppuccin-mocha" },
    });
    expect(wrapper.text()).toContain("Source: Gander");
    expect(wrapper.text()).toContain("Source: Catppuccin Icons for VS Code 1.26.0");

    await iconSelect.trigger("change");
    expect(update).toHaveBeenLastCalledWith({
      ...DEFAULT_APP_SETTINGS,
      workbench: { colorTheme: "Gander Dark", iconTheme: "catppuccin-mocha" },
    });
  });
});
