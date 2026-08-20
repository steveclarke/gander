import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * The two ways out of an open menu that are not clicking something in it: pressing Escape,
 * and clicking anywhere else. Both listen on the document, because "anywhere else" is the
 * whole window and Escape has to work while focus is still on the trigger.
 */
export function useDismissable(
  isOpen: () => boolean,
  root: Ref<HTMLElement | null>,
  close: () => void,
): void {
  function onPointerDown(event: PointerEvent): void {
    if (isOpen() && event.target instanceof Node && !root.value?.contains(event.target)) close();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && isOpen()) close();
  }

  onMounted(() => {
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeydown);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeydown);
  });
}
