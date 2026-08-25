import { readonly, shallowRef, type DeepReadonly, type ShallowRef } from "vue";

export const ACTIVITY_MODES = ["pulls", "explorer", "changes"] as const;
export type ActivityMode = typeof ACTIVITY_MODES[number];
export type DropEdge = "before" | "after";

const STORAGE_KEY = "gander.activityOrder";
const DEFAULT_ORDER: ActivityMode[] = [...ACTIVITY_MODES];

export function parseActivityOrder(value: unknown): ActivityMode[] | null {
  if (!Array.isArray(value) || value.length !== ACTIVITY_MODES.length) return null;
  if (!value.every((item): item is ActivityMode => ACTIVITY_MODES.includes(item as ActivityMode))) return null;
  if (new Set(value).size !== ACTIVITY_MODES.length) return null;
  return [...value];
}

export function reorderActivity(
  order: readonly ActivityMode[],
  dragged: ActivityMode,
  target: ActivityMode,
  edge: DropEdge,
): ActivityMode[] {
  if (dragged === target) return [...order];
  const next = order.filter((item) => item !== dragged);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex + (edge === "after" ? 1 : 0), 0, dragged);
  return next;
}

export function moveActivity(order: readonly ActivityMode[], id: ActivityMode, offset: -1 | 1): ActivityMode[] {
  const from = order.indexOf(id);
  const to = Math.min(order.length - 1, Math.max(0, from + offset));
  if (from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

function load(storage: Pick<Storage, "getItem">): ActivityMode[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? [...DEFAULT_ORDER] : parseActivityOrder(JSON.parse(raw)) ?? [...DEFAULT_ORDER];
  } catch {
    return [...DEFAULT_ORDER];
  }
}

export interface ActivityOrder {
  order: DeepReadonly<ShallowRef<ActivityMode[]>>;
  setOrder(order: readonly ActivityMode[]): void;
  move(id: ActivityMode, offset: -1 | 1): void;
}

/** The reviewer's per-machine activity-bar order and the only actions that can change it. */
export function useActivityOrder(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): ActivityOrder {
  const order = shallowRef(load(storage));

  function setOrder(next: readonly ActivityMode[]): void {
    const parsed = parseActivityOrder(next);
    if (!parsed) return;
    order.value = parsed;
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  }

  function move(id: ActivityMode, offset: -1 | 1): void {
    setOrder(moveActivity(order.value, id, offset));
  }

  return { order: readonly(order), setOrder, move };
}
