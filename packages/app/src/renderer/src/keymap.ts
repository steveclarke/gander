/**
 * Every key the review surface answers to, in one table.
 *
 * The handler and the `?` sheet both read this, so a binding cannot be added without the
 * help learning about it, and the help cannot claim a key that does nothing.
 */

export type Command =
  | "next-file"
  | "previous-file"
  | "first-file"
  | "last-file"
  | "collapse"
  | "expand"
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
}

export const BINDINGS: Binding[] = [
  { command: "next-file", keys: ["j", "ArrowDown"], label: "j / ↓", description: "Next row", group: "Move" },
  { command: "previous-file", keys: ["k", "ArrowUp"], label: "k / ↑", description: "Previous row", group: "Move" },
  { command: "first-file", keys: ["Home"], label: "Home", description: "First row", group: "Move" },
  { command: "last-file", keys: ["End"], label: "End", description: "Last row", group: "Move" },
  { command: "collapse", keys: ["h", "ArrowLeft"], label: "h / ←", description: "Close the directory, or step out to it", group: "Move" },
  { command: "expand", keys: ["l", "ArrowRight", "o"], label: "l / → / o", description: "Open the directory", group: "Move" },
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

export function bindingFor(event: KeyboardEvent): Binding | null {
  const held = event.metaKey || event.ctrlKey;
  return BINDINGS.find((binding) => {
    if ((binding.meta === true) !== held) return false;
    if (event.altKey) return false;
    return binding.keys.includes(event.key);
  }) ?? null;
}
