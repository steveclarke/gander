import { z } from "zod";

export const ZOOM_LEVEL_MIN = -3;
export const ZOOM_LEVEL_MAX = 6;
export const ZOOM_LEVEL_STEP = 0.5;
export const DEFAULT_ZOOM_LEVEL = 0;

export const ZoomLevelSchema = z.number().finite().min(ZOOM_LEVEL_MIN).max(ZOOM_LEVEL_MAX);

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) throw new Error("Zoom level must be a finite number");
  return Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, level));
}

/** Electron zoom levels use a 1.2 scale factor, where level 0 is 100%. */
export function zoomPercentage(level: number): number {
  return Math.round(100 * (1.2 ** clampZoomLevel(level)));
}
