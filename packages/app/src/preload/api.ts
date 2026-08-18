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
    getConnection: () => call("getConnection"),
    testConnection: (url, token) => call("testConnection", url, token),
    setConnection: (url, token) => call("setConnection", url, token),
    setGithubToken: (token) => call("setGithubToken", token),
    getSettings: () => call("getSettings"),
    updateSettings: (settings) => call("updateSettings", settings),
    onOpenSettings: (listener) => subscribe("gander:openSettings", listener),
  };
}
