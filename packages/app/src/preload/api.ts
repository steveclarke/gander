import type { GanderApi } from "../api.js";
import type { OpenTarget } from "@gander/shared";

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Subscribe = (channel: string, listener: (...args: any[]) => void) => () => void;

export function createGanderApi(invoke: Invoke, subscribe: Subscribe): GanderApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    invoke(`gander:${channel}`, ...args) as Promise<T>;

  return {
    listRepos: () => call("listRepos"),
    addRepo: (url) => call("addRepo", url),
    listPrs: (repoId) => call("listPrs", repoId),
    lastReview: () => call("lastReview"),
    initialTarget: () => call("initialTarget"),
    onOpenTarget: (listener) => subscribe("gander:openTarget", (target: OpenTarget) => listener(target)),
    serviceHealthy: () => call("serviceHealthy"),
    openPr: (repoId, prNumber) => call("openPr", repoId, prNumber),
    setChecked: (repoId, prNumber, path, checked) => call("setChecked", repoId, prNumber, path, checked),
    setCheckedMany: (repoId, prNumber, paths, checked) => call("setCheckedMany", repoId, prNumber, paths, checked),
    refreshPr: (repoId, prNumber) => call("refreshPr", repoId, prNumber),
    reviewedSnapshot: (repoId, prNumber, path) => call("reviewedSnapshot", repoId, prNumber, path),
    addQuestion: (repoId, prNumber, input) => call("addQuestion", repoId, prNumber, input),
    addReviewerReply: (repoId, prNumber, id, text) => call("addReviewerReply", repoId, prNumber, id, text),
    deleteQuestion: (repoId, prNumber, id) => call("deleteQuestion", repoId, prNumber, id),
    getSettings: () => call("getSettings"),
    updateSettings: (settings) => call("updateSettings", settings),
    onOpenSettings: (listener) => subscribe("gander:openSettings", listener),
  };
}
