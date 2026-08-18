// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
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
      workbench: { ...DEFAULT_APP_SETTINGS.workbench, colorTheme: "Gander Dark" },
    });
    expect(wrapper.text()).toContain("Source: Gander");
    expect(wrapper.text()).toContain("Source: Catppuccin Icons for VS Code 1.26.0");

    await iconSelect.trigger("change");
    expect(update).toHaveBeenLastCalledWith({
      ...DEFAULT_APP_SETTINGS,
      workbench: { ...DEFAULT_APP_SETTINGS.workbench, colorTheme: "Gander Dark" },
    });
  });

  it("saves independent tree typography and an explicit editor inheritance choice", async () => {
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

    const family = wrapper.get("input[name='workbench.tree.fontFamily']");
    const size = wrapper.get("input[name='workbench.tree.fontSize']");
    const inherit = wrapper.get("input[name='workbench.tree.inheritEditorTypography']");
    expect((family.element as HTMLInputElement).value).toBe(DEFAULT_APP_SETTINGS.workbench.tree.fontFamily);
    expect((size.element as HTMLInputElement).value).toBe("13");
    expect((inherit.element as HTMLInputElement).checked).toBe(false);

    await family.setValue("Inter, system-ui");
    await family.trigger("change");
    await flushPromises();
    await size.setValue("14.5");
    await size.trigger("change");
    await flushPromises();
    expect(update).toHaveBeenLastCalledWith({
      ...DEFAULT_APP_SETTINGS,
      workbench: {
        ...DEFAULT_APP_SETTINGS.workbench,
        tree: { fontFamily: "Inter, system-ui", fontSize: 14.5, inheritEditorTypography: false },
      },
    });

    await inherit.setValue(true);
    await flushPromises();
    expect(update).toHaveBeenLastCalledWith({
      ...DEFAULT_APP_SETTINGS,
      workbench: {
        ...DEFAULT_APP_SETTINGS.workbench,
        tree: { fontFamily: "Inter, system-ui", fontSize: 14.5, inheritEditorTypography: true },
      },
    });
    expect(wrapper.get("input[name='workbench.tree.fontFamily']").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".preview").attributes("style")).toContain("16px");
  });
});
