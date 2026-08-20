import { onBeforeUnmount, onMounted, shallowRef, type ShallowRef } from "vue";
import type { GanderApi } from "../api.js";
import { DEFAULT_ZOOM_LEVEL, clampZoomLevel } from "../../../zoom.js";

/**
 * The window's zoom, which the menu and the keyboard can change behind the app's back —
 * hence the subscription rather than a value read once.
 */
export function useWindowZoom(api: GanderApi): {
  level: ShallowRef<number>;
  change(level: number): Promise<void>;
} {
  const level = shallowRef(DEFAULT_ZOOM_LEVEL);
  let unsubscribe: (() => void) | null = null;

  onMounted(async () => {
    unsubscribe = api.onZoomChanged((changed) => { level.value = changed; });
    level.value = await api.getZoomLevel();
  });

  onBeforeUnmount(() => { unsubscribe?.(); });

  return {
    level,
    // Clamp first so the control settles where it will land, rather than overshooting and
    // snapping back a round trip later.
    async change(next: number): Promise<void> {
      level.value = clampZoomLevel(next);
      level.value = await api.setZoomLevel(next);
    },
  };
}
