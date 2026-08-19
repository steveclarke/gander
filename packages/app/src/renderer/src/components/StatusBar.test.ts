// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import type { Store } from "../store.js";
import StatusBar from "./StatusBar.vue";

const store = {
  serviceStatus: { state: "connected", serviceVersion: "0.1.0", supportedVersion: "0.1.0" },
  view: null,
  lastFetchAt: null,
  busy: false,
} as Store;

describe("StatusBar", () => {
  it("shows a development marker only for a development launch", () => {
    const development = mount(StatusBar, {
      props: { store, treeVisible: true, isDevelopment: true, worktreeLabel: null, zoomLevel: 0 },
    });
    const release = mount(StatusBar, {
      props: { store, treeVisible: true, isDevelopment: false, worktreeLabel: null, zoomLevel: 0 },
    });

    expect(development.get(".development").text()).toBe("DEV");
    expect(development.get(".development").attributes("title")).toBe("Development build");
    expect(development.get(".development").attributes("aria-label")).toBe("Development build");
    expect(release.find(".development").exists()).toBe(false);

    development.unmount();
    release.unmount();
  });

  it("identifies a linked worktree by branch name", () => {
    const wrapper = mount(StatusBar, {
      props: {
        store,
        treeVisible: true,
        isDevelopment: true,
        worktreeLabel: "feature/review-status",
        zoomLevel: 0,
      },
    });

    expect(wrapper.get(".development-kind").text()).toBe("DEV");
    expect(wrapper.get(".worktree-label").text()).toBe("· feature/review-status");
    expect(wrapper.get(".development").attributes("title")).toBe("Development build · feature/review-status");

    wrapper.unmount();
  });

  it("makes cached offline reads and both version-skew policies visible", async () => {
    const mutableStore = reactive({
      ...store,
      view: { pr: { number: 1 }, files: [], questions: [] },
      serviceStatus: { state: "unreachable", reason: "connection refused" },
    }) as unknown as Store;
    const wrapper = mount(StatusBar, {
      props: { store: mutableStore, treeVisible: true, isDevelopment: false, worktreeLabel: null, zoomLevel: 0 },
    });
    expect(wrapper.get(".service").text()).toContain("showing cached review");
    expect(wrapper.get(".service").attributes("title")).toBe("connection refused");

    mutableStore.serviceStatus = { state: "incompatible", serviceVersion: "0.0.9", supportedVersion: "0.1.0", reason: "update service" };
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".service").text()).toContain("too old · update to 0.1.0");

    mutableStore.serviceStatus = { state: "newer", serviceVersion: "0.2.0", supportedVersion: "0.1.0" };
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".service").text()).toContain("newer · app supports 0.1.0");
    expect(wrapper.get(".service").classes()).toContain("warning");

    wrapper.unmount();
  });
});
