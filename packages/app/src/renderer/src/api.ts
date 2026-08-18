import type { GanderApi } from "../../api.js";
export type { ConnectionCheck, GanderApi } from "../../api.js";
export const api = (window as unknown as { gander: GanderApi }).gander;
