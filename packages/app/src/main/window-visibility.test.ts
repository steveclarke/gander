import { describe, expect, it, vi } from "vitest";
import { revealWindow, windowIsHidden } from "./window-visibility.js";

function window(minimized = false) {
  return {
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
}

describe("window visibility", () => {
  it("keeps the E2E window hidden without changing renderer behavior", () => {
    const target = window(true);

    expect(windowIsHidden({ GANDER_E2E: "1" })).toBe(true);
    revealWindow(target, { GANDER_E2E: "1" });

    expect(target.restore).not.toHaveBeenCalled();
    expect(target.show).not.toHaveBeenCalled();
    expect(target.focus).not.toHaveBeenCalled();
  });

  it("restores, shows, and focuses a normal product window", () => {
    const target = window(true);

    expect(windowIsHidden({})).toBe(false);
    revealWindow(target, {});

    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.show).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledOnce();
  });
});
