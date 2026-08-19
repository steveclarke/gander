// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { PrListItem, PrSummary, ReviewProgress } from "@gander/shared";
import type { Store } from "../store.js";
import TopBar from "./TopBar.vue";

function pr(number: number, title: string, stack: PrSummary["stack"] = null, reviewProgress: ReviewProgress | null = null): PrListItem {
  return {
    number,
    title,
    body: "",
    draft: false,
    baseRef: "main",
    headRef: `feature-${number}`,
    baseSha: "base",
    headSha: `head-${number}`,
    stack,
    reviewProgress,
  };
}

function storeWithProgress(done: number, total: number, options: {
  prs?: PrListItem[];
  currentPr?: PrSummary;
  openPr?: Store["openPr"];
} = {}): Store {
  return {
    repos: [],
    githubRepos: [],
    githubReposBusy: false,
    githubReposError: null,
    prs: options.prs ?? [],
    worktrees: [],
    currentRepoId: null,
    view: options.currentPr ? { pr: options.currentPr, files: [], questions: [] } : null,
    localView: null,
    busy: false,
    openPr: options.openPr ?? vi.fn(),
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

  it("shows the current pull request's GitHub stack position beside its number", () => {
    const currentPr = pr(22, "Add the renderer", { id: 7, size: 3, position: 2 });
    const wrapper = mount(TopBar, {
      props: {
        store: storeWithProgress(0, 0, { currentPr }),
        questions: 0,
        settingsActive: false,
        integratedTitleBar: false,
      },
    });

    expect(wrapper.get(".chip").text()).toBe("#22");
    expect(wrapper.get(".header-stack-position").text()).toContain("2/3");
    expect(wrapper.get(".header-stack-position").attributes("aria-label")).toBe("Stack position 2 of 3");

    wrapper.unmount();
  });

  it("leaves a standalone pull request header unchanged", () => {
    const wrapper = mount(TopBar, {
      props: {
        store: storeWithProgress(0, 0, { currentPr: pr(30, "Independent change") }),
        questions: 0,
        settingsActive: false,
        integratedTitleBar: false,
      },
    });

    expect(wrapper.get(".chip").text()).toBe("#30");
    expect(wrapper.find(".header-stack-position").exists()).toBe(false);

    wrapper.unmount();
  });

  it("labels a local worktree without review progress or question controls", () => {
    const store = storeWithProgress(0, 0);
    store.localView = {
      worktree: { path: "/tmp/feature", branch: "feature", headSha: "head", locked: false },
      defaultBranch: "main",
      mergeBaseSha: "base",
      files: [
        { path: "a.ts", status: "M", baseContent: "a", headContent: "b", baseHash: "a", headHash: "b" },
        { path: "b.ts", status: "A", baseContent: null, headContent: "b", baseHash: null, headHash: "b" },
      ],
    };
    const wrapper = mount(TopBar, {
      props: { store, questions: 3, settingsActive: false, integratedTitleBar: false },
    });

    expect(wrapper.get(".seg-review").text()).toContain("Local");
    expect(wrapper.get(".seg-review").text()).toContain("feature");
    expect(wrapper.get(".local-progress").text()).toBe("2 changed");
    expect(wrapper.find("button[aria-label='Questions']").exists()).toBe(false);
    expect(wrapper.find("button[aria-label='Add question (N)']").exists()).toBe(false);
    expect(wrapper.get("button[aria-label='Refresh local changes']").attributes("title")).toContain("updates live");
    wrapper.unmount();
  });

  it("groups stack members in position order while keeping standalone pull requests independent", async () => {
    const openPr = vi.fn<Store["openPr"]>().mockResolvedValue(undefined);
    const stack = { id: 7, size: 2 };
    const wrapper = mount(TopBar, {
      props: {
        store: storeWithProgress(0, 0, {
          prs: [
            { ...pr(22, "Add the renderer", { ...stack, position: 2 }, { done: 1, total: 4 }), draft: true },
            pr(30, "Independent change", null, { done: 2, total: 2 }),
            pr(21, "Add the service", { ...stack, position: 1 }),
          ],
          openPr,
        }),
        questions: 0,
        settingsActive: false,
        integratedTitleBar: false,
      },
      global: { stubs: { Teleport: true } },
    });

    await wrapper.get(".seg-review").trigger("click");

    expect(wrapper.findAll(".stack-group")).toHaveLength(1);
    expect(wrapper.findAll(".stack-group .sw-item").map((item) => item.text())).toEqual([
      "1/2#21Add the service",
      "2/2#22Add the renderer1/4 reviewed",
    ]);
    expect(wrapper.findAll(".standalone-item").map((item) => item.text())).toEqual([
      "#30Independent change Reviewed",
    ]);
    expect(wrapper.findAll(".review-progress")).toHaveLength(2);
    expect(wrapper.get(".standalone-item .review-progress svg").attributes("aria-hidden")).toBe("true");
    expect(wrapper.findAll(".dot")).toHaveLength(3);
    expect(wrapper.findAll(".dot.draft")).toHaveLength(1);
    expect(wrapper.findAll(".dot.open")).toHaveLength(2);

    await wrapper.findAll(".stack-group .sw-item")[1]!.trigger("keydown", { key: "Enter" });
    expect(openPr).toHaveBeenCalledWith(22);

    wrapper.unmount();
  });
});
