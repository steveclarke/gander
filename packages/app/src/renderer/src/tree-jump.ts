import { computed, shallowRef, type ComputedRef } from "vue";
import type { ChangedFile } from "@gander/shared";
import { pathOf, rows } from "./tree-nav.js";
import { basename } from "./paths.js";

// Flash's crucial trick: labels come from ordinary keys that cannot extend the current
// search on any target. A key can therefore mean "keep typing" or "jump" without a mode
// switch, modifier, or completion key. Digits cover small trees whose names use most letters.
const TARGET_LABELS = [..."asdfghjklqwertyuiopzxcvbnm1234567890"];

export interface JumpTarget {
  path: string;
  name: string;
  matchIndices: number[];
  label: string | null;
}

/** The positions of a case-insensitive subsequence match, or null when it does not match. */
export function matchName(name: string, query: string): number[] | null {
  const characters = [...name];
  const wanted = [...query.toLocaleLowerCase()];
  const indices: number[] = [];
  let from = 0;

  for (const character of wanted) {
    const index = characters.findIndex((candidate, candidateIndex) =>
      candidateIndex >= from && candidate.toLocaleLowerCase() === character,
    );
    if (index === -1) return null;
    indices.push(index);
    from = index + 1;
  }
  return indices;
}

/** Targets in draw order. `rows` deliberately excludes children of collapsed directories. */
export function jumpTargets(files: ChangedFile[], query: string): JumpTarget[] {
  const matches = rows(files).flatMap((node) => {
    const path = pathOf(node);
    const name = node.type === "dir" ? node.name : basename(path);
    const matchIndices = matchName(name, query);
    return matchIndices === null ? [] : [{ path, name, matchIndices }];
  });
  const sole = matches.length === 1;
  const continuations = new Set(matches.flatMap((match) => {
    const afterMatch = (match.matchIndices.at(-1) ?? -1) + 1;
    return [...match.name].slice(afterMatch).map((character) => character.toLocaleLowerCase());
  }));
  const labels = TARGET_LABELS.filter((label) => !continuations.has(label));
  return matches.map((match, index) => ({
    ...match,
    label: sole ? null : labels[index] ?? null,
  }));
}

interface TreeJump {
  active: ComputedRef<boolean>;
  targetsByPath: ComputedRef<ReadonlyMap<string, JumpTarget>>;
  start: () => boolean;
  cancel: () => void;
  handleKey: (event: KeyboardEvent) => boolean;
}

/** Owns the short-lived keyboard mode; the tree only receives its derived presentation. */
export function useTreeJump(files: () => ChangedFile[], moveTo: (path: string) => void): TreeJump {
  const query = shallowRef<string | null>(null);
  const active = computed(() => query.value !== null);
  const targets = computed(() => query.value === null ? [] : jumpTargets(files(), query.value));
  const targetsByPath = computed<ReadonlyMap<string, JumpTarget>>(() =>
    new Map(targets.value.map((target) => [target.path, target])),
  );

  function cancel(): void {
    query.value = null;
  }

  function finishIfUnambiguous(): void {
    const target = targets.value.length === 1 ? targets.value[0] : undefined;
    if (target === undefined) return;
    cancel();
    moveTo(target.path);
  }

  function start(): boolean {
    query.value = "";
    if (targets.value.length === 0) {
      cancel();
      return false;
    }
    finishIfUnambiguous();
    return true;
  }

  function handleKey(event: KeyboardEvent): boolean {
    if (query.value === null) return false;
    if (event.key === "Escape") {
      cancel();
      return true;
    }

    const labeled = targets.value.find((target) => target.label === event.key);
    if (labeled !== undefined) {
      cancel();
      moveTo(labeled.path);
      return true;
    }

    if (event.key === "Backspace") {
      query.value = query.value.slice(0, -1);
      finishIfUnambiguous();
      return true;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;

    query.value += event.key;
    finishIfUnambiguous();
    return true;
  }

  return { active, targetsByPath, start, cancel, handleKey };
}
