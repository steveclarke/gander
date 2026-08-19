/**
 * Every key the review surface answers to, in one table.
 *
 * The handler and the `?` sheet both read this, so a binding cannot be added without the
 * help learning about it, and the help cannot claim a key that does nothing.
 */

/** Keys that begin a two-key binding rather than doing anything themselves. */
export type Prefix = "g";
export const PREFIXES: Prefix[] = ["g"];

export type Command =
  | "next-file"
  | "previous-file"
  | "first-file"
  | "last-file"
  | "toggle-directory"
  | "dismiss"
  | "toggle-checked"
  | "mark-and-advance"
  | "mark-and-retreat"
  | "next-change"
  | "previous-change"
  | "delta-view"
  | "capture-note"
  | "toggle-notes"
  | "toggle-tree"
  | "help";

export interface Binding {
  command: Command;
  /** `event.key` values that run the command. */
  keys: string[];
  /** What the sheet prints, which is not always what `event.key` reports. */
  label: string;
  description: string;
  group: "Move" | "Review" | "Read" | "Panels";
  /** Held with Command on macOS, Control elsewhere. */
  meta?: true;
  /** Reached by pressing this key first, vim's two-key form. */
  prefix?: Prefix;
}

export const BINDINGS: Binding[] = [
  { command: "next-file", keys: ["j", "ArrowDown"], label: "j / ↓", description: "Next row", group: "Move" },
  { command: "previous-file", keys: ["k", "ArrowUp"], label: "k / ↑", description: "Previous row", group: "Move" },
  { command: "first-file", keys: ["g"], prefix: "g", label: "gg", description: "First row", group: "Move" },
  { command: "last-file", keys: ["G"], label: "⇧G", description: "Last row", group: "Move" },
  { command: "toggle-directory", keys: ["o"], label: "o", description: "Open the directory and step in, or close the one you are in", group: "Move" },
  { command: "dismiss", keys: ["Escape"], label: "Esc", description: "Close what is open on top", group: "Move" },

  { command: "toggle-checked", keys: ["m", " "], label: "m / Space", description: "Mark or unmark this file, or the whole directory", group: "Review" },
  { command: "mark-and-advance", keys: ["J"], label: "⇧J", description: "Mark it and go to the next unmarked row", group: "Review" },
  { command: "mark-and-retreat", keys: ["K"], label: "⇧K", description: "Mark it and go to the previous unmarked row", group: "Review" },
  { command: "capture-note", keys: ["n"], label: "n", description: "Capture a note", group: "Review" },
  { command: "toggle-notes", keys: ["N"], label: "⇧N", description: "Show or hide the notes", group: "Review" },

  { command: "next-change", keys: ["]"], label: "]", description: "Next change in this file", group: "Read" },
  { command: "previous-change", keys: ["["], label: "[", description: "Previous change in this file", group: "Read" },
  { command: "delta-view", keys: ["d"], label: "d", description: "Changes since your review", group: "Read" },

  { command: "toggle-tree", keys: ["b"], label: "⌘B", description: "Show or hide the file tree", group: "Panels", meta: true },
  { command: "help", keys: ["?"], label: "?", description: "This list", group: "Panels" },
];

export const GROUPS: Binding["group"][] = ["Move", "Review", "Read", "Panels"];

/**
 * `pending` is the prefix key already pressed, if any. A binding with a prefix is reachable
 * only while that prefix is pending, and a plain binding only while none is — so `g` can
 * begin `gg` without `G` or any other key having to know about it.
 */
export function bindingFor(event: KeyboardEvent, pending: Prefix | null = null): Binding | null {
  const held = event.metaKey || event.ctrlKey;
  return BINDINGS.find((binding) => {
    if ((binding.meta === true) !== held) return false;
    if (event.altKey) return false;
    if ((binding.prefix ?? null) !== pending) return false;
    return binding.keys.includes(event.key);
  }) ?? null;
}

/** True when this key only makes sense as the start of a two-key binding. */
export function isPrefix(event: KeyboardEvent, pending: Prefix | null): Prefix | null {
  if (pending !== null || event.metaKey || event.ctrlKey || event.altKey) return null;
  return PREFIXES.find((prefix) => prefix === event.key) ?? null;
}
