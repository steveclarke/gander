// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Store } from "../store.js";
import TopBar from "./TopBar.vue";

function storeWithProgress(done: number, total: number): Store {
  return {
    repos: [],
    prs: [],
    currentRepoId: null,
    view: null,
    busy: false,
    progress: () => ({ done, total }),
  } as unknown as Store;
}

describe("TopBar", () => {
  it.each([
    { done: 0, total: 0, state: "progress-empty" },
    { done: 2, total: 5, state: "progress-partial" },
    { done: 5, total: 5, state: "progress-complete" },
  ])("renders $done/$total progress as one $state status", ({ done, total, state }) => {
    const wrapper = mount(TopBar, {
      props: {
        store: storeWithProgress(done, total),
        questions: 0,
        settingsActive: false,
        integratedTitleBar: false,
      },
    });

    const progress = wrapper.get(".progress");
    expect(progress.text()).toBe(`${done}/${total} reviewed`);
    expect(progress.classes()).toContain(state);
    expect(progress.find("b").exists()).toBe(false);

    wrapper.unmount();
  });
});
