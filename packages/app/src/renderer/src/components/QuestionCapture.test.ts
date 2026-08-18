// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store.js";
import QuestionCapture from "./QuestionCapture.vue";

describe("QuestionCapture", () => {
  it("opens as a substantial, described writing surface", () => {
    const store = {
      selectedPath: "src/review.ts",
      addQuestion: vi.fn(),
    } as unknown as Store;
    const wrapper = mount(QuestionCapture, {
      props: { store, target: { path: "src/review.ts", line: 12 } },
    });

    const question = wrapper.get("textarea");
    expect(question.attributes("rows")).toBe("12");
    expect(question.attributes("aria-describedby")).toBe("question-capture-hint");
    expect(wrapper.get("label").attributes("for")).toBe(question.attributes("id"));

    wrapper.unmount();
  });

  it("submits the explicit file and line even if the store selection moves", async () => {
    const addQuestion = vi.fn(async () => {});
    const store = {
      selectedPath: "new-selection.ts",
      addQuestion,
    } as unknown as Store;
    const wrapper = mount(QuestionCapture, {
      props: {
        store,
        target: { path: "reviewed-file.ts", line: 17 },
      },
    });

    expect(wrapper.get("label").text()).toContain("reviewed-file.ts · line 17");
    await wrapper.get("textarea").setValue("Keep this anchor");
    await wrapper.get("form").trigger("submit");

    expect(addQuestion).toHaveBeenCalledWith("Keep this anchor", "reviewed-file.ts", 17);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("supports a pull-request-level target", async () => {
    const addQuestion = vi.fn(async () => {});
    const store = { addQuestion } as unknown as Store;
    const wrapper = mount(QuestionCapture, {
      props: { store, target: { path: null, line: null } },
    });

    await wrapper.get("textarea").setValue("Across the whole PR");
    await wrapper.get("form").trigger("submit");

    expect(addQuestion).toHaveBeenCalledWith("Across the whole PR", null, null);
  });
});
