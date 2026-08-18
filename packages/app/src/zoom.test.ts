import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM_LEVEL,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  clampZoomLevel,
  zoomPercentage,
} from "./zoom.js";

describe("window zoom", () => {
  it("converts Electron zoom levels to effective percentages", () => {
    expect(zoomPercentage(DEFAULT_ZOOM_LEVEL)).toBe(100);
    expect(zoomPercentage(0.5)).toBe(110);
    expect(zoomPercentage(1)).toBe(120);
    expect(zoomPercentage(-1)).toBe(83);
  });

  it("clamps controls to the supported limits", () => {
    expect(clampZoomLevel(-100)).toBe(ZOOM_LEVEL_MIN);
    expect(clampZoomLevel(100)).toBe(ZOOM_LEVEL_MAX);
    expect(() => clampZoomLevel(Number.NaN)).toThrow(/finite/);
  });
});
