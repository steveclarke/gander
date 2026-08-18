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
    const wrapper = mount(QuestionCapture, { props: { store, open: true } });

    const question = wrapper.get("textarea");
    expect(question.attributes("rows")).toBe("12");
    expect(question.attributes("aria-describedby")).toBe("question-capture-hint");
    expect(wrapper.get("label").attributes("for")).toBe(question.attributes("id"));

    wrapper.unmount();
  });
});
