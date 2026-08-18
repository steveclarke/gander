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

interface Layout {
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

function load(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULTS };
    // Merged over the defaults so a layout saved by an earlier version, missing whatever
    // was added since, opens with sensible values instead of NaN widths.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Layout>) };
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
