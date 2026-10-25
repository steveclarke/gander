import {
  COLOR_THEME_ARGUMENT,
  DEVELOPMENT_ARGUMENT,
  WINDOW_STYLE_ARGUMENT,
  WORKTREE_LABEL_ARGUMENT,
  type GanderApi,
  type InitialWindowState,
  type WindowStyle,
} from "../api.js";
import type { OpenTarget } from "@gander/shared";
import type { LocalViewUpdate } from "../main/local-viewer.js";
import type { GithubViewedSyncStatus } from "../main/github-viewed-queue.js";
import type { ServerChoiceRequest } from "../main/server-choice.js";
import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from "../themes.js";

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Subscribe = (channel: string, listener: (...args: any[]) => void) => () => void;

export function initialWindowStateFromArguments(argv: string[]): InitialWindowState {
  const argumentValue = (prefix: string): string | undefined =>
    argv.filter((argument) => argument.startsWith(prefix)).at(-1)?.slice(prefix.length);
  const rawWindowStyle = argumentValue(WINDOW_STYLE_ARGUMENT);
  const windowStyle: WindowStyle = rawWindowStyle === "integrated-titlebar"
    ? "integrated-titlebar"
    : "native-titlebar";
  let rawTheme = "";
  try {
    rawTheme = decodeURIComponent(argumentValue(COLOR_THEME_ARGUMENT) ?? "");
  } catch {
    // A malformed user-supplied process argument must not prevent the preload bridge
    // from loading. Main's validated argument still wins when it is appended later.
  }
  const colorTheme = (THEME_IDS as readonly string[]).includes(rawTheme)
    ? rawTheme as ThemeId
    : DEFAULT_THEME_ID;
  let worktreeLabel: string | null = null;
  try {
    const encodedWorktreeLabel = argumentValue(WORKTREE_LABEL_ARGUMENT);
    if (encodedWorktreeLabel) worktreeLabel = decodeURIComponent(encodedWorktreeLabel);
  } catch {
    // Treat malformed process input as absent. Main's encoded value is well-formed.
  }
  return {
    windowStyle,
    colorTheme,
    isDevelopment: argv.includes(DEVELOPMENT_ARGUMENT),
    worktreeLabel,
  };
}

export function createGanderApi(
  invoke: Invoke,
  subscribe: Subscribe,
  initialWindowState: InitialWindowState = {
    windowStyle: "native-titlebar",
    colorTheme: DEFAULT_THEME_ID,
    isDevelopment: false,
    worktreeLabel: null,
  },
): GanderApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    invoke(`gander:${channel}`, ...args) as Promise<T>;

  return {
    initialWindowState,
    listRepos: () => call("listRepos"),
    chooseLocalRepo: (expectedRepoId) => call("chooseLocalRepo", expectedRepoId),
    removeRepo: (repoId) => call("removeRepo", repoId),
    listWorktrees: (repoId) => call("listWorktrees", repoId),
    listPrs: (repoId) => call("listPrs", repoId),
    lastReview: () => call("lastReview"),
    initialTarget: () => call("initialTarget"),
    onOpenTarget: (listener) => subscribe("gander:openTarget", (target: OpenTarget) => listener(target)),
    serviceStatus: (repoId) => call("serviceStatus", repoId),
    openPr: (repoId, prNumber) => call("openPr", repoId, prNumber),
    setChecked: (repoId, prNumber, path, checked, reviewSessionId) => call("setChecked", repoId, prNumber, path, checked, reviewSessionId),
    setCheckedMany: (repoId, prNumber, paths, checked, reviewSessionId) => call("setCheckedMany", repoId, prNumber, paths, checked, reviewSessionId),
    refreshPr: (repoId, prNumber, reviewSessionId) => call("refreshPr", repoId, prNumber, reviewSessionId),
    reviewedSnapshot: (repoId, prNumber, path, reviewSessionId) => call("reviewedSnapshot", repoId, prNumber, path, reviewSessionId),
    imagePreview: (repoId, prNumber, path, reviewSessionId) => call("imagePreview", repoId, prNumber, path, reviewSessionId),
    openLocal: (repoId, path) => call("openLocal", repoId, path),
    listLocalFiles: (path, directory = "") => call("listLocalFiles", path, directory),
    localFile: (path, filePath) => call("localFile", path, filePath),
    refreshLocal: (path) => call("refreshLocal", path),
    localImagePreview: (path) => call("localImagePreview", path),
    closeLocal: () => call("closeLocal"),
    onLocalViewChanged: (listener) => subscribe("gander:localViewChanged", (update: LocalViewUpdate) => listener(update)),
    addNote: (repoId, prNumber, input, reviewSessionId) => call("addNote", repoId, prNumber, input, reviewSessionId),
    updateNote: (repoId, prNumber, id, input, reviewSessionId) => call("updateNote", repoId, prNumber, id, input, reviewSessionId),
    deleteNote: (repoId, prNumber, id, reviewSessionId) => call("deleteNote", repoId, prNumber, id, reviewSessionId),
    onServersChanged: (listener) => subscribe("gander:serversChanged", listener),
    getServers: () => call("getServers"),
    saveServer: (server) => call("saveServer", server),
    removeServer: (id) => call("removeServer", id),
    setRepoServer: (repoId, serverId) => call("setRepoServer", repoId, serverId),
    changeRepoServer: (repoId) => call("changeRepoServer", repoId),
    onChooseServer: (listener) => subscribe("gander:chooseServer", (request: ServerChoiceRequest) => listener(request)),
    answerServerChoice: (requestId, serverId) => call("answerServerChoice", requestId, serverId),
    testConnection: (url, token) => call("testConnection", url, token),
    setGithubToken: (token) => call("setGithubToken", token),
    githubViewedSyncStatus: () => call("githubViewedSyncStatus"),
    onGithubViewedSyncStatus: (listener) => subscribe("gander:githubViewedSyncStatus", (status: GithubViewedSyncStatus) => listener(status)),
    retryGithubViewedSync: () => call("retryGithubViewedSync"),
    dismissGithubViewedSync: () => call("dismissGithubViewedSync"),
    getSettings: () => call("getSettings"),
    updateSettings: (settings) => call("updateSettings", settings),
    onOpenSettings: (listener) => subscribe("gander:openSettings", listener),
    getZoomLevel: () => call("getZoomLevel"),
    setZoomLevel: (level) => call("setZoomLevel", level),
    onZoomChanged: (listener) => subscribe("gander:zoomChanged", (level: number) => listener(level)),
  };
}
