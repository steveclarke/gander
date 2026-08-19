// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../store.js";
import RepositoryPicker from "./RepositoryPicker.vue";

function fakeStore(overrides: Partial<Store> = {}): Store {
  return reactive({
    repos: [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas" }],
    githubRepos: [],
    githubReposBusy: false,
    githubReposError: null,
    busy: false,
    error: null,
    async loadGithubRepos() {
      store.githubRepos = [
        { repoId: "acme/atlas", url: "https://github.com/acme/atlas", private: true },
        { repoId: "steve/gander", url: "https://github.com/steve/gander", private: false },
      ];
    },
    async selectRepo() {},
    async addRepo() {},
    async chooseLocalRepo() { return false; },
    ...overrides,
  } as unknown as Store);
}

let store: Store;

beforeEach(() => {
  store = fakeStore();
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

describe("RepositoryPicker", () => {
  it("loads, filters, and distinguishes repositories already added", async () => {
    const wrapper = mount(RepositoryPicker, { props: { open: false, store } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.get("dialog").attributes("open")).toBeDefined();
    expect(wrapper.get(".repository-list").text()).toContain("atlas");
    expect(wrapper.get(".repository-list").text()).toContain("Added");
    expect(wrapper.get(".repository-list").text()).toContain("Private");

    const filter = wrapper.get("#repository-filter");
    (filter.element as HTMLInputElement).value = "gander";
    await filter.trigger("input");
    expect(wrapper.get(".repository-list").text()).not.toContain("atlas");
    expect(wrapper.get(".repository-list").text()).toContain("gander");
  });

  it("registers a GitHub repository and closes after it becomes selected", async () => {
    const addRepo = vi.fn(async () => {});
    store = fakeStore({ addRepo });
    const wrapper = mount(RepositoryPicker, { props: { open: false, store } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.findAll(".repository-list button")[1]!.trigger("click");
    await flushPromises();

    expect(addRepo).toHaveBeenCalledWith("https://github.com/steve/gander");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("keeps URL entry as a fallback", async () => {
    const addRepo = vi.fn(async () => {});
    store = fakeStore({ addRepo });
    const wrapper = mount(RepositoryPicker, { props: { open: false, store } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.get("#repository-url-tab").trigger("click");
    await wrapper.get("#repository-url").setValue("https://github.com/acme/hidden");
    await wrapper.get(".url-panel form").trigger("submit");
    await flushPromises();

    expect(addRepo).toHaveBeenCalledWith("https://github.com/acme/hidden");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("moves between tabs with the standard arrow, Home, and End keys", async () => {
    const wrapper = mount(RepositoryPicker, { props: { open: false, store } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.get("#github-repositories-tab").trigger("keydown", { key: "End" });
    expect(wrapper.get("#local-repository-tab").attributes("aria-selected")).toBe("true");
    await wrapper.get("#local-repository-tab").trigger("keydown", { key: "Home" });
    expect(wrapper.get("#github-repositories-tab").attributes("aria-selected")).toBe("true");
  });

  it("registers a local checkout through the native folder flow", async () => {
    const chooseLocalRepo = vi.fn(async () => true);
    store = fakeStore({ chooseLocalRepo });
    const wrapper = mount(RepositoryPicker, { props: { open: false, store } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.get("#local-repository-tab").trigger("click");
    await wrapper.get(".local-button").trigger("click");
    await flushPromises();

    expect(chooseLocalRepo).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("keeps the picker open and names a failed registration", async () => {
    store = fakeStore({
      async addRepo() { store.error = "GitHub API 403: repository unavailable"; },
    });
    const wrapper = mount(RepositoryPicker, { props: { open: false, store } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.findAll(".repository-list button")[1]!.trigger("click");
    await flushPromises();

    expect(wrapper.get(".github-action-error").text()).toContain("403");
    expect(wrapper.emitted("close")).toBeUndefined();
  });
});
