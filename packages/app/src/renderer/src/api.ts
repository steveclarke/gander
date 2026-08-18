import type { GanderApi } from "../../api.js";
export type { GanderApi } from "../../api.js";
export const api = (window as unknown as { gander: GanderApi }).gander;
