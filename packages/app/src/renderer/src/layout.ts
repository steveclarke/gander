import { ref, watch } from "vue";

/**
 * Where the panels sit and how big they are.
 *
 * Kept in localStorage rather than the config file: this is per-screen preference, it
 * changes on every drag, and routing each pixel through IPC to rewrite a JSON file on
 * disk would be a lot of machinery for something the renderer can own outright.
 */

export type Dock = "right" | "bottom";

const KEY = "gander.layout";

export interface Layout {
  notesDock: Dock;
  treeWidth: number;
  notesWidth: number;
  notesHeight: number;
}

const DEFAULTS: Layout = {
  notesDock: "right",
  treeWidth: 264,
  notesWidth: 320,
  notesHeight: 260,
};

export function parseLayout(value: unknown): Layout | null {
  if (
    typeof value !== "object" || value === null
    || Object.keys(value).length !== 4
    || !("notesDock" in value) || (value.notesDock !== "right" && value.notesDock !== "bottom")
    || !("treeWidth" in value) || typeof value.treeWidth !== "number" || !Number.isFinite(value.treeWidth)
    || !("notesWidth" in value) || typeof value.notesWidth !== "number" || !Number.isFinite(value.notesWidth)
    || !("notesHeight" in value) || typeof value.notesHeight !== "number" || !Number.isFinite(value.notesHeight)
  ) return null;
  return value as Layout;
}

function load(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULTS };
    return parseLayout(JSON.parse(raw)) ?? { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

const state = load();

export const notesDock = ref<Dock>(state.notesDock);
export const treeWidth = ref(state.treeWidth);
export const notesWidth = ref(state.notesWidth);
export const notesHeight = ref(state.notesHeight);

watch([notesDock, treeWidth, notesWidth, notesHeight], () => {
  const next: Layout = {
    notesDock: notesDock.value,
    treeWidth: treeWidth.value,
    notesWidth: notesWidth.value,
    notesHeight: notesHeight.value,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
});

/** Keeps a panel from being dragged to nothing, or wide enough to swallow the diff. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
