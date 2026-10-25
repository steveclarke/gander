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
  githubViewedSync: { pending: 0, failed: 0, message: null },
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
      view: { pr: { number: 1 }, files: [], notes: [] },
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

  it("shows pending and failed GitHub Viewed work", async () => {
    const mutableStore = reactive({
      ...store,
      githubViewedSync: { pending: 2, failed: 0, message: null },
    }) as Store;
    const wrapper = mount(StatusBar, {
      props: { store: mutableStore, treeVisible: true, isDevelopment: false, worktreeLabel: null, zoomLevel: 0 },
    });

    expect(wrapper.get(".github-sync").text()).toBe("GitHub sync · 2 pending");

    mutableStore.githubViewedSync = { pending: 0, failed: 1, message: "Bad credentials" };
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".github-sync").text()).toBe("GitHub sync · 1 failed");
    expect(wrapper.get(".github-sync").classes()).toContain("failed");
    expect(wrapper.get(".github-sync").attributes("title")).toBe("Bad credentials");
  });

  it("offers Retry and Dismiss for failed GitHub Viewed work", async () => {
    const calls: string[] = [];
    const failingStore = reactive({
      ...store,
      githubViewedSync: { pending: 0, failed: 2, message: "GitHub Viewed sync failed for a.rb: Something went wrong. The Gander review is saved." },
      retryGithubViewedSync: async () => { calls.push("retry"); },
      dismissGithubViewedSync: async () => { calls.push("dismiss"); },
    }) as Store;
    const wrapper = mount(StatusBar, {
      props: { store: failingStore, treeVisible: true, isDevelopment: false, worktreeLabel: null, zoomLevel: 0 },
    });

    expect(wrapper.get("button.github-sync").attributes("popovertarget")).toBe("github-sync-menu");
    expect(wrapper.get("#github-sync-menu").text()).toContain("The Gander review is saved.");
    const [dismiss, retry] = wrapper.findAll("#github-sync-menu .actions button");
    expect(dismiss!.text()).toBe("Dismiss");
    expect(retry!.text()).toBe("Retry");
    await retry!.trigger("click");
    await dismiss!.trigger("click");
    expect(calls).toEqual(["retry", "dismiss"]);
  });

  it("says where a repository's notes go, offers Change, and warns when the claim is gone", async () => {
    const routed = reactive({
      ...store, currentRepoId: "acme/harbor", targetRepoId: null, localView: null,
      serviceStatus: { state: "connected", serviceVersion: "0.11.0", supportedVersion: "0.11.0", serverName: "Team" },
    }) as unknown as Store;
    const wrapper = mount(StatusBar, { props: { store: routed, treeVisible: true, isDevelopment: false, worktreeLabel: null, zoomLevel: 0 } });

    expect(wrapper.get(".service-label").text()).toBe("Notes save to Team · Service connected · 0.11.0");
    await wrapper.get(".change-server").trigger("click");
    expect(wrapper.emitted("changeServer")).toEqual([["acme/harbor"]]);

    routed.serviceStatus = { ...routed.serviceStatus, claimLost: true };
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".service-label").text()).toBe("Team no longer covers this repository · notes still save there");
    expect(wrapper.get(".service").classes()).toContain("warning");
    wrapper.unmount();
  });
});
