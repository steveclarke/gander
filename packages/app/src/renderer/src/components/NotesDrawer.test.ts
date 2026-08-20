// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrView } from "@gander/shared";
import type { Store } from "../store.js";
import { pendingReveal } from "../selection.js";
import NotesDrawer from "./NotesDrawer.vue";

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

const view = (notes: PrView["notes"]): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headRef: "feature", stack: null, headSha: "b" },
  files: [],
  notes,
});

function store(notes: PrView["notes"], overrides: Partial<Store> = {}): Store {
  return {
    view: view(notes),
    selectedPath: null,
    async deleteNote() {},
    async updateNote() {},
    select() {},
    ...overrides,
  } as unknown as Store;
}

const notes: PrView["notes"] = [
  {
    id: 1,
    path: "src/a-very-long-file-name.ts",
    line: 37,
    text: "Why does this branch need to handle the shared path this way?",
    state: "open",
    headSha: "b",
    sourceContext: { startLine: 35, lines: ["before", "context", "target", "after", "later"] },
    inProgressNote: null,
    commitRef: null,
    summary: null,
    createdAt: "2026-08-18T00:00:00.000Z",
  },
  {
    id: 2,
    path: "src/addressed.ts",
    line: 9,
    text: "Could this preserve the existing caller contract?",
    state: "addressed",
    headSha: "b",
    sourceContext: null,
    inProgressNote: null,
    commitRef: "abc1234",
    summary: "Kept the contract and added coverage.",
    createdAt: "2026-08-18T01:00:00.000Z",
  },
];

describe("NotesDrawer", () => {
  beforeEach(() => {
    pendingReveal.value = null;
  });

  it("offers add actions in the empty state", async () => {
    const wrapper = mount(NotesDrawer, { props: { store: store([]), dock: "right" } });

    const actions = wrapper.findAll("button[aria-label='Add note (N)'], .empty button");
    expect(actions).toHaveLength(2);
    await actions[1]!.trigger("click");

    expect(wrapper.emitted("addNote")).toHaveLength(1);
  });

  it("keeps the header add action when notes are populated", async () => {
    const wrapper = mount(NotesDrawer, {
      props: {
        store: store([{
          id: 1,
          path: "a.ts",
          line: 3,
          text: "Why?",
          state: "open",
          headSha: "b",
          sourceContext: null,
          inProgressNote: null,
          commitRef: null,
          summary: null,
          createdAt: "2026-08-18T00:00:00.000Z",
        }]),
        dock: "right",
      },
    });

    expect(wrapper.find(".empty").exists()).toBe(false);
    await wrapper.get("button[aria-label='Add note (N)']").trigger("click");

    expect(wrapper.emitted("addNote")).toHaveLength(1);
  });

  it("opens new notes and collapses addressed notes without losing their identity", () => {
    const wrapper = mount(NotesDrawer, { props: { store: store(notes), dock: "right" } });

    const toggles = wrapper.findAll("button[aria-expanded]");
    expect(toggles).toHaveLength(2);
    expect(toggles[0]!.attributes("aria-expanded")).toBe("true");
    expect(toggles[1]!.attributes("aria-expanded")).toBe("false");

    const addressed = wrapper.get("[data-note-id='2']");
    expect(addressed.text()).toContain("addressed.ts:9");
    expect((addressed.get("select[aria-label='Status for note 2']").element as HTMLSelectElement).value).toBe("addressed");
    expect(addressed.text()).toContain("Could this preserve the existing caller contract?");
    expect(addressed.find("[data-note-body]").isVisible()).toBe(false);
  });

  it("separates active work from notes waiting on the reviewer", () => {
    const inProgress = {
      ...notes[0]!,
      id: 3,
      state: "in_progress" as const,
      inProgressNote: null,
    };
    const waiting = {
      ...notes[0]!,
      id: 4,
      state: "in_progress" as const,
      inProgressNote: "Choose whether this should retry.",
    };
    const wrapper = mount(NotesDrawer, { props: { store: store([inProgress, waiting]), dock: "right" } });

    expect(wrapper.findAll(".group-heading").map((heading) => heading.text())).toEqual([
      "In progress 1",
      "Waiting on you 1",
    ]);
    expect(wrapper.get("[data-note-id='4'] [aria-label='Waiting on reviewer']").text()).toContain("Choose whether this should retry.");
  });

  it("keeps a note expanded while its state moves between groups", async () => {
    const wrapper = mount(NotesDrawer, { props: { store: store([notes[0]!]), dock: "right" } });
    expect(wrapper.get("[data-note-id='1'] button[aria-expanded]").attributes("aria-expanded")).toBe("true");

    await wrapper.setProps({
      store: store([{
        ...notes[0]!,
        state: "addressed",
        summary: "Answered in the active session.",
      }]),
    });

    expect(wrapper.get("[data-note-id='1'] button[aria-expanded]").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("[data-note-id='1'] [aria-label='Agent update']").text()).toContain("Answered in the active session.");
  });

  it("exposes a keyboard-operable disclosure and labeled agent update", async () => {
    const wrapper = mount(NotesDrawer, { props: { store: store(notes), dock: "bottom" } });
    const addressed = wrapper.get("[data-note-id='2']");
    const toggle = addressed.get("button[aria-expanded='false']");

    await toggle.trigger("click");

    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.attributes("aria-controls")).toBe("note-body-2");
    expect(toggle.attributes("aria-label")).toBe("Collapse note 2");
    expect(addressed.get("[data-note-body]").isVisible()).toBe(true);
    expect(addressed.get("[aria-label='Agent update']").text()).toContain("Kept the contract and added coverage.");
    expect(addressed.get("[aria-label='Agent update'] code").text()).toBe("abc1234");
  });

  it("preserves navigation and delete actions inside an expanded note", async () => {
    const select = vi.fn();
    const deleteNote = vi.fn(async () => {});
    const drawerStore = store(notes, { select, deleteNote });
    const wrapper = mount(NotesDrawer, { props: { store: drawerStore, dock: "right" } });
    const open = wrapper.get("[data-note-id='1']");

    await open.get("button[data-note-location]").trigger("click");
    expect(select).toHaveBeenCalledWith("src/a-very-long-file-name.ts");
    expect(pendingReveal.value).toBe(37);

    await open.get("button[aria-label='Delete note 1']").trigger("click");
    // The click opens the confirmation; nothing is deleted until it is answered.
    expect(deleteNote).not.toHaveBeenCalled();
    await open.get("dialog.confirm button.danger").trigger("click");
    expect(deleteNote).toHaveBeenCalledWith(1);
  });

  it("edits note text and changes status through labeled controls", async () => {
    const updateNote = vi.fn(async () => {});
    const wrapper = mount(NotesDrawer, { props: { store: store(notes, { updateNote }), dock: "right" } });
    const open = wrapper.get("[data-note-id='1']");

    await open.get("button[aria-label='Edit note 1']").trigger("click");
    const editor = open.get("textarea[aria-label='Edit note 1']");
    await editor.setValue("Use the shared helper instead");
    await open.get("form.edit-form").trigger("submit");
    expect(updateNote).toHaveBeenCalledWith(1, { text: "Use the shared helper instead" });

    await open.get("select[aria-label='Status for note 1']").setValue("resolved");
    expect(updateNote).toHaveBeenCalledWith(1, { state: "resolved" });
  });

  it("cancels an edit without saving it", async () => {
    const updateNote = vi.fn(async () => {});
    const wrapper = mount(NotesDrawer, { props: { store: store(notes, { updateNote }), dock: "right" } });
    const open = wrapper.get("[data-note-id='1']");

    await open.get("button[aria-label='Edit note 1']").trigger("click");
    await open.get("textarea[aria-label='Edit note 1']").setValue("Discard this");
    await open.get(".edit-actions button[type='button']").trigger("click");

    expect(updateNote).not.toHaveBeenCalled();
    expect(open.text()).toContain("Why does this branch need");
  });

  it("deletes nothing when the confirmation is dismissed", async () => {
    const deleteNote = vi.fn(async () => {});
    const drawerStore = store(notes, { deleteNote });
    const wrapper = mount(NotesDrawer, { props: { store: drawerStore, dock: "right" } });
    const open = wrapper.get("[data-note-id='1']");

    await open.get("button[aria-label='Delete note 1']").trigger("click");
    await open.get("dialog.confirm button.cancel").trigger("click");
    expect(deleteNote).not.toHaveBeenCalled();

    // And the dialog is available again rather than stuck shut.
    await open.get("button[aria-label='Delete note 1']").trigger("click");
    await open.get("dialog.confirm button.danger").trigger("click");
    expect(deleteNote).toHaveBeenCalledWith(1);
  });

  it("counts what a delete would take with it", async () => {
    const drawerStore = store(notes);
    const wrapper = mount(NotesDrawer, { props: { store: drawerStore, dock: "right" } });
    const open = wrapper.get("[data-note-id='1']");
    await open.get("button[aria-label='Delete note 1']").trigger("click");
    expect(open.get("dialog.confirm .detail").text()).toMatch(/cannot be undone/);
  });

  it("copies a complete note and all notes as markdown", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const wrapper = mount(NotesDrawer, { props: { store: store(notes), dock: "right" } });
    const addressed = wrapper.get("[data-note-id='2']");
    await addressed.get("button[aria-expanded='false']").trigger("click");

    await addressed.get("button[aria-label='Copy note 2']").trigger("click");
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("Agent update (abc1234): Kept the contract"));

    await wrapper.get("button[aria-label='Copy all notes']").trigger("click");
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("### src/a-very-long-file-name.ts:37 — open"));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("37: target"));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("### src/addressed.ts:9 — addressed"));
  });
});
