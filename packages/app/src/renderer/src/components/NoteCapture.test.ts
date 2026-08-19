// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store.js";
import NoteCapture from "./NoteCapture.vue";

describe("NoteCapture", () => {
  it("opens as a substantial, described writing surface", () => {
    const store = {
      selectedPath: "src/review.ts",
      addNote: vi.fn(),
    } as unknown as Store;
    const wrapper = mount(NoteCapture, {
      props: { store, target: { path: "src/review.ts", line: 12 } },
    });

    const note = wrapper.get("textarea");
    expect(note.attributes("rows")).toBe("12");
    expect(note.attributes("aria-describedby")).toBe("note-capture-hint");
    expect(wrapper.get("label").attributes("for")).toBe(note.attributes("id"));

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

    expect(wrapper.get("label").text()).toContain("reviewed-file.ts · line 17");
    await wrapper.get("textarea").setValue("Keep this anchor");
    await wrapper.get("form").trigger("submit");

    expect(addNote).toHaveBeenCalledWith("Keep this anchor", "reviewed-file.ts", 17);
    expect(wrapper.emitted("close")).toHaveLength(1);
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
});
