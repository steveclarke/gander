import type { GanderApi } from "../api.js";

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export function createGanderApi(invoke: Invoke): GanderApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    invoke(`gander:${channel}`, ...args) as Promise<T>;

  return {
    listRepos: () => call("listRepos"),
    addRepo: (url) => call("addRepo", url),
    listPrs: (repoId) => call("listPrs", repoId),
    lastReview: () => call("lastReview"),
    serviceHealthy: () => call("serviceHealthy"),
    openPr: (repoId, prNumber) => call("openPr", repoId, prNumber),
    setChecked: (repoId, prNumber, path, checked) => call("setChecked", repoId, prNumber, path, checked),
    setCheckedMany: (repoId, prNumber, paths, checked) => call("setCheckedMany", repoId, prNumber, paths, checked),
    refreshPr: (repoId, prNumber) => call("refreshPr", repoId, prNumber),
    reviewedSnapshot: (repoId, prNumber, path) => call("reviewedSnapshot", repoId, prNumber, path),
    addQuestion: (repoId, prNumber, input) => call("addQuestion", repoId, prNumber, input),
    deleteQuestion: (repoId, prNumber, id) => call("deleteQuestion", repoId, prNumber, id),
    getSettings: () => call("getSettings"),
    updateSettings: (settings) => call("updateSettings", settings),
  };
}
