import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";
import type { PrFile } from "@gander/shared";
import { bindingFor, isPrefix, type Command, type Prefix } from "../keymap.js";
import { collapsedDirs, cursor, edge, filesAt, nextUnmarked, parentOf, rowAt, step } from "../tree-nav.js";
import { useTreeJump, type TreeJump } from "../tree-jump.js";
import type { Store } from "../store.js";
import type { WorkbenchMode } from "./use-workbench.js";

/** The two things only the diff editor can do, reached from the keymap. */
export interface DiffCommands {
  goToChange(target: "next" | "previous"): void;
  showDelta(): void;
}

export interface KeyboardSurface {
  store: Store;
  /** Which surface is on screen. A half-typed jump does not survive leaving it. */
  mode: () => WorkbenchMode;
  treeVisible: Ref<boolean>;
  drawerOpen: Ref<boolean>;
  helpOpen: Ref<boolean>;
  /** Null until the review surface has mounted its diff. */
  diff: () => DiffCommands | null;
  captureNote: () => void;
}

/**
 * Every key the reviewer presses outside a text box, and the cursor it moves.
 *
 * Selection is the app's cursor, so these keys work wherever the reviewer is looking —
 * the tree, the diff, the notes. Nothing in the app is editable, which is what makes bare
 * letters safe; `isTyping` guards the note input and the settings fields, the only places
 * a letter means itself.
 */
export function useReviewKeyboard(surface: KeyboardSurface): TreeJump {
  const { store } = surface;
  const treeJump = useTreeJump(() => store.files(), (path) => { moveTo(path); });

  // The half-typed jump is about what is on screen right now, so changing the surface,
  // changing which pull request is open, or hiding the tree all retire it.
  watch(
    [surface.mode, () => `${store.currentRepoId ?? ""}#${store.view?.pr.number ?? ""}`, surface.treeVisible],
    () => treeJump.cancel(),
  );

  function isTyping(target: HTMLElement | null): boolean {
    if (target === null) return false;
    if (target.closest("[data-app-typing='true']") !== null) return true;
    if (target.closest(".monaco-editor") !== null) return false;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  }

  function runCommand(command: Command): boolean {
    const files = store.files();
    const at = cursor.value ?? store.selectedPath;

    switch (command) {
      case "next-file":
      case "previous-file":
        return moveTo(step(files, at, command === "next-file" ? 1 : -1));
      case "first-file":
      case "last-file":
        return moveTo(edge(files, command === "first-file" ? "first" : "last"));
      case "jump-row":
        return surface.treeVisible.value && store.currentRepoId === store.targetRepoId && treeJump.start();
      case "toggle-directory": {
        if (at === null) return true;
        // Opening a directory is how a reviewer says "let me look in here", so the cursor
        // goes in with it. On anything else the same key closes the directory the cursor is
        // inside and steps out to it, which is the way back.
        if (rowAt(files, at)?.type === "dir" && collapsedDirs.has(at)) {
          collapsedDirs.delete(at);
          return moveTo(step(files, at, 1));
        }
        const dir = rowAt(files, at)?.type === "dir" ? at : parentOf(files, at);
        if (dir === null) return true;
        collapsedDirs.add(dir);
        return moveTo(dir);
      }
      case "dismiss": {
        if (!surface.helpOpen.value) return false;
        surface.helpOpen.value = false;
        return true;
      }
      case "toggle-checked": {
        mark(at, null);
        return true;
      }
      case "mark-and-advance":
      case "mark-and-retreat": {
        // Read before marking: once this row is marked it is no longer a candidate, and the
        // search would step over where the reviewer actually is.
        const next = nextUnmarked(files, at, command === "mark-and-advance" ? 1 : -1);
        mark(at, true);
        if (next !== null && next !== at) moveTo(next);
        return true;
      }
      case "next-change":
        surface.diff()?.goToChange("next");
        return true;
      case "previous-change":
        surface.diff()?.goToChange("previous");
        return true;
      case "delta-view":
        surface.diff()?.showDelta();
        return true;
      case "capture-note":
        surface.captureNote();
        return true;
      case "toggle-notes":
        surface.drawerOpen.value = !surface.drawerOpen.value;
        return true;
      case "toggle-tree":
        surface.treeVisible.value = !surface.treeVisible.value;
        return true;
      case "help":
        surface.helpOpen.value = !surface.helpOpen.value;
        return true;
    }
  }

  /**
   * Moves the cursor, and opens the row when it is a file. A directory has nothing to show,
   * so passing over one leaves the reader looking at the file they were already reading.
   */
  function moveTo(path: string | null): boolean {
    if (path === null) return true;
    cursor.value = path;
    if (rowAt(store.files(), path)?.type === "file") store.select(path);
    return true;
  }

  /** Marks a row: one file, or every file under a directory. `checked` null means toggle. */
  function mark(path: string | null, checked: boolean | null): void {
    const under = filesAt(store.files(), path).filter((file): file is PrFile => "checked" in file);
    if (under.length === 0) return;
    const next = checked ?? under.some((file) => !file.checked);
    const changing = under.filter((file) => file.checked !== next).map((file) => file.path);
    if (changing.length === 0) return;
    if (changing.length === 1) void store.setChecked(changing[0]!, next);
    else void store.setCheckedMany(changing, next);
  }

  // Keyboard movement can leave the cursor outside the scrolled area, where the reviewer
  // cannot see what they are on. Follow it; a mouse click is already in view.
  watch(cursor, async () => {
    await nextTick();
    document.querySelector(".view-sidebar .tnode.cur")?.scrollIntoView({ block: "nearest" });
  });

  // A file opened by any other route — a click, a note, opening the pull request — becomes
  // where the keyboard continues from.
  watch(() => store.selectedPath, (path) => {
    if (path !== null && rowAt(store.files(), cursor.value)?.type !== "dir") cursor.value = path;
  });

  // The half-typed prefix of a two-key binding. Cleared by whatever comes next, so a `g`
  // followed by anything other than the key that completes a chord does nothing at all.
  let pending: Prefix | null = null;

  function onKey(event: KeyboardEvent): void {
    if (isTyping(event.target as HTMLElement | null)) return;
    if (treeJump.active.value && treeJump.handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const started = isPrefix(event, pending);
    if (started !== null) {
      pending = started;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const binding = bindingFor(event, pending);
    pending = null;
    if (binding === null) return;
    // Everything but the panel toggles is about a pull request under review; in the local
    // viewer there is no checkoff, no note, and no delta to reach.
    const reviewing = store.view !== null && surface.mode() === "pulls";
    if (!reviewing && binding.group !== "Panels") return;
    if (!runCommand(binding.command)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  window.addEventListener("keydown", onKey, true);
  onBeforeUnmount(() => { window.removeEventListener("keydown", onKey, true); });

  return treeJump;
}
