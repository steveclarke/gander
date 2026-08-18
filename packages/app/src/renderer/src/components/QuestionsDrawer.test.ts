// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { PrView } from "@gander/shared";
import type { Store } from "../store.js";
import QuestionsDrawer from "./QuestionsDrawer.vue";

const view = (questions: PrView["questions"]): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
  files: [],
  questions,
});

function store(questions: PrView["questions"]): Store {
  return {
    view: view(questions),
    selectedPath: null,
    async addReviewerReply() {},
    async deleteQuestion() {},
  } as unknown as Store;
}

describe("QuestionsDrawer", () => {
  it("offers add actions in the empty state", async () => {
    const wrapper = mount(QuestionsDrawer, { props: { store: store([]), dock: "right" } });

    const actions = wrapper.findAll("button[aria-label='Add question (N)'], .empty button");
    expect(actions).toHaveLength(2);
    await actions[1]!.trigger("click");

    expect(wrapper.emitted("addQuestion")).toHaveLength(1);
  });

  it("keeps the header add action when questions are populated", async () => {
    const wrapper = mount(QuestionsDrawer, {
      props: {
        store: store([{
          id: 1,
          path: "a.ts",
          line: 3,
          text: "Why?",
          state: "open",
          headSha: "b",
          commitRef: null,
          note: null,
          createdAt: "2026-08-18T00:00:00.000Z",
          replies: [],
        }]),
        dock: "right",
      },
    });

    expect(wrapper.find(".empty").exists()).toBe(false);
    await wrapper.get("button[aria-label='Add question (N)']").trigger("click");

    expect(wrapper.emitted("addQuestion")).toHaveLength(1);
  });
});
