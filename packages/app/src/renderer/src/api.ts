import type { GanderApi } from "../../api.js";
export type { ConnectionCheck, GanderApi, GithubRepository, GithubTokenCheck } from "../../api.js";
export const api = (window as unknown as { gander: GanderApi }).gander;
