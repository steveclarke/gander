// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import type { PrView } from "@gander/shared";
import type { Store } from "../store.js";
import { pendingReveal } from "../selection.js";
import QuestionsDrawer from "./QuestionsDrawer.vue";

// jsdom ships the <dialog> element without showModal/close; Chromium, which is what the
// app runs on, has both. Shimmed here rather than softened in the component, so the
// production path stays the one the browser actually takes.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

const view = (questions: PrView["questions"]): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
  files: [],
  questions,
});

function store(questions: PrView["questions"], overrides: Partial<Store> = {}): Store {
  return {
    view: view(questions),
    selectedPath: null,
    async addReviewerReply() {},
    async deleteQuestion() {},
    select() {},
    ...overrides,
  } as unknown as Store;
}

const questions: PrView["questions"] = [
  {
    id: 1,
    path: "src/a-very-long-file-name.ts",
    line: 37,
    text: "Why does this branch need to handle the shared path this way?",
    state: "open",
    headSha: "b",
    commitRef: null,
    note: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    replies: [],
  },
  {
    id: 2,
    path: "src/addressed.ts",
    line: 9,
    text: "Could this preserve the existing caller contract?",
    state: "addressed",
    headSha: "b",
    commitRef: "abc1234",
    note: "Kept the contract and added coverage.",
    createdAt: "2026-08-18T01:00:00.000Z",
    replies: [
      { id: 3, author: "agent", text: "The regression test now covers both callers.", createdAt: "2026-08-18T02:00:00.000Z" },
      { id: 4, author: "reviewer", text: "That covers my concern.", createdAt: "2026-08-18T03:00:00.000Z" },
    ],
  },
];

describe("QuestionsDrawer", () => {
  beforeEach(() => {
    pendingReveal.value = null;
  });

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

  it("opens new questions and collapses addressed threads without losing their identity", () => {
    const wrapper = mount(QuestionsDrawer, { props: { store: store(questions), dock: "right" } });

    const toggles = wrapper.findAll("button[aria-expanded]");
    expect(toggles).toHaveLength(2);
    expect(toggles[0]!.attributes("aria-expanded")).toBe("true");
    expect(toggles[1]!.attributes("aria-expanded")).toBe("false");

    const addressed = wrapper.get("[data-question-id='2']");
    expect(addressed.text()).toContain("addressed.ts:9");
    expect(addressed.get(".state").text()).toBe("addressed");
    expect(addressed.text()).toContain("Could this preserve the existing caller contract?");
    expect(addressed.text()).toContain("2 replies");
    expect(addressed.find("[data-question-body]").isVisible()).toBe(false);
  });

  it("exposes a keyboard-operable disclosure and a labeled reply hierarchy", async () => {
    const wrapper = mount(QuestionsDrawer, { props: { store: store(questions), dock: "bottom" } });
    const addressed = wrapper.get("[data-question-id='2']");
    const toggle = addressed.get("button[aria-expanded='false']");

    await toggle.trigger("click");

    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.attributes("aria-controls")).toBe("question-body-2");
    expect(toggle.attributes("aria-label")).toBe("Collapse question 2");
    expect(addressed.get("[data-question-body]").isVisible()).toBe(true);
    expect(addressed.get("[aria-label='Agent update']").text()).toContain("Kept the contract and added coverage.");
    expect(addressed.get("[aria-label='Agent update'] code").text()).toBe("abc1234");
    expect(addressed.get("[aria-label='Replies']").text()).toContain("Agent");
    expect(addressed.get("[aria-label='Replies']").text()).toContain("Reviewer");
  });

  it("preserves navigation, delete, and reply actions inside an expanded thread", async () => {
    const select = vi.fn();
    const deleteQuestion = vi.fn(async () => {});
    const addReviewerReply = vi.fn(async () => {});
    const drawerStore = store(questions, { select, deleteQuestion, addReviewerReply });
    const wrapper = mount(QuestionsDrawer, { props: { store: drawerStore, dock: "right" } });
    const open = wrapper.get("[data-question-id='1']");

    await open.get("button[data-question-location]").trigger("click");
    expect(select).toHaveBeenCalledWith("src/a-very-long-file-name.ts");
    expect(pendingReveal.value).toBe(37);

    await open.get("input[aria-label='Reply to question 1']").setValue("A reviewer follow-up");
    await open.get("form").trigger("submit");
    expect(addReviewerReply).toHaveBeenCalledWith(1, "A reviewer follow-up");

    await open.get("button[aria-label='Delete question 1']").trigger("click");
    // The click opens the confirmation; nothing is deleted until it is answered.
    expect(deleteQuestion).not.toHaveBeenCalled();
    await open.get("dialog.confirm button.danger").trigger("click");
    expect(deleteQuestion).toHaveBeenCalledWith(1);
  });

  it("deletes nothing when the confirmation is dismissed", async () => {
    const deleteQuestion = vi.fn(async () => {});
    const drawerStore = store(questions, { deleteQuestion });
    const wrapper = mount(QuestionsDrawer, { props: { store: drawerStore, dock: "right" } });
    const open = wrapper.get("[data-question-id='1']");

    await open.get("button[aria-label='Delete question 1']").trigger("click");
    await open.get("dialog.confirm button.cancel").trigger("click");
    expect(deleteQuestion).not.toHaveBeenCalled();

    // And the dialog is available again rather than stuck shut.
    await open.get("button[aria-label='Delete question 1']").trigger("click");
    await open.get("dialog.confirm button.danger").trigger("click");
    expect(deleteQuestion).toHaveBeenCalledWith(1);
  });

  it("counts what a delete would take with it", async () => {
    const drawerStore = store(questions);
    const wrapper = mount(QuestionsDrawer, { props: { store: drawerStore, dock: "right" } });
    const open = wrapper.get("[data-question-id='1']");
    await open.get("button[aria-label='Delete question 1']").trigger("click");
    expect(open.get("dialog.confirm .detail").text()).toMatch(/cannot be undone/);
  });

  it("preserves an explicit disclosure choice when a reply refreshes the question", async () => {
    const drawerStore = reactive(store(questions)) as Store;
    drawerStore.addReviewerReply = async (id, text) => {
      drawerStore.view = view(questions.map((question) => question.id === id
        ? { ...question, replies: [...question.replies, { id: 5, author: "reviewer", text, createdAt: "2026-08-18T04:00:00.000Z" }] }
        : question));
    };
    const wrapper = mount(QuestionsDrawer, { props: { store: drawerStore, dock: "right" } });
    const addressed = wrapper.get("[data-question-id='2']");
    await addressed.get("button[aria-expanded='false']").trigger("click");
    await addressed.get("input").setValue("One more thought");
    await addressed.get("form").trigger("submit");
    await flushPromises();

    expect(addressed.get("button[aria-expanded]").attributes("aria-expanded")).toBe("true");
    expect(addressed.get("[aria-label='Replies']").text()).toContain("One more thought");
  });

  it("copies a complete question thread and all threads as markdown", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const wrapper = mount(QuestionsDrawer, { props: { store: store(questions), dock: "right" } });
    const addressed = wrapper.get("[data-question-id='2']");
    await addressed.get("button[aria-expanded='false']").trigger("click");

    await addressed.get("button[aria-label='Copy question 2 thread']").trigger("click");
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("Agent update (abc1234): Kept the contract"));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("Agent: The regression test now covers both callers."));

    await wrapper.get("button[aria-label='Copy all question threads']").trigger("click");
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("### src/a-very-long-file-name.ts:37 — open"));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("### src/addressed.ts:9 — addressed"));
  });
});
