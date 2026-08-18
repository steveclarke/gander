import { ref } from "vue";

/**
 * Where the reader's cursor is in the diff, and where they want to go next.
 *
 * DiffPane owns the Monaco instance and is rebuilt whenever the file or tab changes, so
 * the line cannot live in a component that outlives it. Question capture (in App) and the
 * questions drawer both need it, and neither is a parent or child of DiffPane — this small
 * module is the shared ground between them.
 */

/** 1-based line in the head revision, or null when nothing is selected. */
export const currentLine = ref<number | null>(null);

/** A line the reader asked to jump to, consumed and cleared by DiffPane. */
export const pendingReveal = ref<number | null>(null);

export function revealLine(line: number): void {
  pendingReveal.value = line;
}
