import { onBeforeUnmount } from "vue";

export interface DebouncedSave {
  /** Typing continues: push the save out to the far side of the pause. */
  schedule(): void;
  /** Save now if one is waiting. For leaving a field, and for leaving the pane. */
  flush(): Promise<void>;
  /** Drop a waiting save. For "Use default", which saves something else instead. */
  cancel(): void;
}

/**
 * A settings field has no Save button: it saves itself once the reviewer stops typing.
 * The waiting save has to survive the two ways a reviewer leaves without pausing —
 * tabbing out of the field and closing Settings — or the edit they just made is the one
 * edit that never lands.
 */
export function useDebouncedSave(save: () => void | Promise<void>, delayMs = 400): DebouncedSave {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, delayMs);
  }

  async function flush(): Promise<void> {
    if (timer === null) return;
    cancel();
    await save();
  }

  onBeforeUnmount(() => { void flush(); });

  return { schedule, flush, cancel };
}
