// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store.js";
import NoteCapture from "./NoteCapture.vue";

describe("NoteCapture", () => {
  it("opens as a compact, non-modal writing surface with a visible target", () => {
    const store = {
      selectedPath: "src/review.ts",
      addNote: vi.fn(),
    } as unknown as Store;
    const wrapper = mount(NoteCapture, {
      props: { store, target: { path: "src/review.ts", line: 12 } },
    });

    const note = wrapper.get("textarea");
    expect(note.attributes("rows")).toBe("4");
    expect(note.attributes("aria-label")).toBe("Note text");
    expect(note.attributes("aria-describedby")).toBe("note-capture-hint");
    expect(wrapper.get("form").attributes("role")).toBe("form");
    expect(wrapper.find("[role='dialog']").exists()).toBe(false);
    expect(wrapper.get("button.target").text()).toBe("review.ts:12");
    expect(wrapper.text()).toContain("src/review.ts");

    wrapper.unmount();
  });

  it("submits the explicit file and line even if the store selection moves", async () => {
    const addNote = vi.fn(async () => {});
    const store = {
      selectedPath: "new-selection.ts",
      addNote,
    } as unknown as Store;
    const wrapper = mount(NoteCapture, {
      props: {
        store,
        target: { path: "reviewed-file.ts", line: 17 },
      },
    });

    expect(wrapper.get("button.target").text()).toBe("reviewed-file.ts:17");
    await wrapper.get("textarea").setValue("Keep this anchor");
    await wrapper.get("form").trigger("submit");

    expect(addNote).toHaveBeenCalledWith("Keep this anchor", "reviewed-file.ts", 17);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("offers mouse controls for saving and cancelling", async () => {
    const addNote = vi.fn(async () => {});
    const store = { addNote } as unknown as Store;
    const wrapper = mount(NoteCapture, {
      props: { store, target: { path: "src/review.ts", line: 12 } },
      attachTo: document.body,
    });

    const save = wrapper.get("button.save");
    expect(save.text()).toBe("Save");
    expect(save.attributes("disabled")).toBeDefined();

    await wrapper.get("textarea").setValue("Review this with a mouse");
    expect(save.attributes("disabled")).toBeUndefined();
    (save.element as HTMLButtonElement).click();
    await flushPromises();

    expect(addNote).toHaveBeenCalledWith("Review this with a mouse", "src/review.ts", 12);
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();

    const cancelWrapper = mount(NoteCapture, {
      props: { store, target: { path: "src/review.ts", line: 12 } },
    });
    await cancelWrapper.get("button.cancel").trigger("click");

    expect(cancelWrapper.emitted("close")).toHaveLength(1);
    expect(addNote).toHaveBeenCalledTimes(1);
  });

  it("supports a pull-request-level target", async () => {
    const addNote = vi.fn(async () => {});
    const store = { addNote } as unknown as Store;
    const wrapper = mount(NoteCapture, {
      props: { store, target: { path: null, line: null } },
    });

    await wrapper.get("textarea").setValue("Across the whole PR");
    await wrapper.get("form").trigger("submit");

    expect(addNote).toHaveBeenCalledWith("Across the whole PR", null, null);
  });

  it("returns to its frozen file and line without changing the draft", async () => {
    const store = { addNote: vi.fn() } as unknown as Store;
    const target = { path: "src/review.ts", line: 12 };
    const wrapper = mount(NoteCapture, { props: { store, target } });

    await wrapper.get("textarea").setValue("Keep this draft");
    await wrapper.get("button.target").trigger("click");

    expect(wrapper.emitted("navigate")).toEqual([[target]]);
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("Keep this draft");
  });
});
