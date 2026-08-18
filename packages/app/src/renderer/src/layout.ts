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
  questionsDock: Dock;
  treeWidth: number;
  questionsWidth: number;
  questionsHeight: number;
}

const DEFAULTS: Layout = {
  questionsDock: "right",
  treeWidth: 264,
  questionsWidth: 320,
  questionsHeight: 260,
};

export function parseLayout(value: unknown): Layout | null {
  if (
    typeof value !== "object" || value === null
    || Object.keys(value).length !== 4
    || !("questionsDock" in value) || (value.questionsDock !== "right" && value.questionsDock !== "bottom")
    || !("treeWidth" in value) || typeof value.treeWidth !== "number" || !Number.isFinite(value.treeWidth)
    || !("questionsWidth" in value) || typeof value.questionsWidth !== "number" || !Number.isFinite(value.questionsWidth)
    || !("questionsHeight" in value) || typeof value.questionsHeight !== "number" || !Number.isFinite(value.questionsHeight)
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

export const questionsDock = ref<Dock>(state.questionsDock);
export const treeWidth = ref(state.treeWidth);
export const questionsWidth = ref(state.questionsWidth);
export const questionsHeight = ref(state.questionsHeight);

watch([questionsDock, treeWidth, questionsWidth, questionsHeight], () => {
  const next: Layout = {
    questionsDock: questionsDock.value,
    treeWidth: treeWidth.value,
    questionsWidth: questionsWidth.value,
    questionsHeight: questionsHeight.value,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
});

/** Keeps a panel from being dragged to nothing, or wide enough to swallow the diff. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
