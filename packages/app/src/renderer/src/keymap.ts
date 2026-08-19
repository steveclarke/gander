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
  | "focus-tree"
  | "focus-diff"
  | "toggle-checked"
  | "check-and-advance"
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
  /** Acts only while the file tree holds focus, because it changes the tree's shape. */
  treeOnly?: true;
}

export const BINDINGS: Binding[] = [
  { command: "next-file", keys: ["j", "ArrowDown"], label: "j / ↓", description: "Next file", group: "Move" },
  { command: "previous-file", keys: ["k", "ArrowUp"], label: "k / ↑", description: "Previous file", group: "Move" },
  { command: "first-file", keys: ["Home"], label: "Home", description: "First file", group: "Move" },
  { command: "last-file", keys: ["End"], label: "End", description: "Last file", group: "Move" },
  { command: "collapse", keys: ["h", "ArrowLeft"], label: "h / ←", description: "Collapse the directory", group: "Move", treeOnly: true },
  { command: "expand", keys: ["l", "ArrowRight"], label: "l / →", description: "Expand the directory", group: "Move", treeOnly: true },
  { command: "focus-tree", keys: ["Tab"], label: "Tab", description: "Focus the file tree", group: "Move" },
  { command: "focus-diff", keys: ["Escape"], label: "Esc", description: "Return to the diff", group: "Move" },

  { command: "toggle-checked", keys: ["x", " "], label: "x / Space", description: "Check or un-check this file", group: "Review" },
  { command: "check-and-advance", keys: ["X"], label: "⇧X", description: "Check it and go to the next unchecked file", group: "Review" },
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
