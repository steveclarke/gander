// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedSave, type DebouncedSave } from "./use-debounced-save.js";

/** The composable needs an instance to hang `onBeforeUnmount` on, and nothing else. */
function mountWith(save: () => void | Promise<void>): {
  saver: DebouncedSave;
  unmount: () => void;
} {
  let saver: DebouncedSave | null = null;
  const wrapper = mount(defineComponent({
    setup() {
      saver = useDebouncedSave(save);
      return () => h("div");
    },
  }));
  return { saver: saver!, unmount: () => wrapper.unmount() };
}

describe("useDebouncedSave", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("saves once after typing stops, however many keystrokes preceded it", () => {
    const save = vi.fn();
    const { saver } = mountWith(save);

    saver.schedule();
    vi.advanceTimersByTime(399);
    saver.schedule();
    vi.advanceTimersByTime(399);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushes a waiting save and leaves nothing behind to fire again", async () => {
    const save = vi.fn();
    const { saver } = mountWith(save);

    saver.schedule();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushing with nothing waiting saves nothing", async () => {
    const save = vi.fn();
    const { saver } = mountWith(save);

    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("cancel drops the waiting save, for the reset that saves something else", () => {
    const save = vi.fn();
    const { saver } = mountWith(save);

    saver.schedule();
    saver.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  // Closing Settings within the pause is the way an edit gets lost, so the pane's teardown
  // has to carry the waiting save with it.
  it("saves on unmount rather than losing the last edit", () => {
    const save = vi.fn();
    const { saver, unmount } = mountWith(save);

    saver.schedule();
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
