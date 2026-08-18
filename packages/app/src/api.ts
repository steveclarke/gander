import type { NewQuestion, OpenTarget, PrSummary, PrView, RepoEntry } from "@gander/shared";
import type { AppSettings } from "./settings.js";
import type { ThemeId } from "./themes.js";
import type { ConnectionCheck } from "./main/connection.js";

export type WindowStyle = "native-titlebar" | "integrated-titlebar";
export const WINDOW_STYLE_ARGUMENT = "--gander-window-style=";
export const COLOR_THEME_ARGUMENT = "--gander-color-theme=";
export type GithubTokenCheck = { ok: true; login: string } | { ok: false; reason: string };

export interface InitialWindowState {
  windowStyle: WindowStyle;
  colorTheme: ThemeId;
}

export type { ConnectionCheck };

export interface GanderApi {
  /** Fixed by the main process when the window is created; renderer code cannot change it. */
  initialWindowState: InitialWindowState;
  listRepos(): Promise<RepoEntry[]>;
  addRepo(url: string): Promise<RepoEntry>;
  listPrs(repoId: string): Promise<PrSummary[]>;
  lastReview(): Promise<{ repoId: string; prNumber: number } | null>;
  /** What this launch was asked to open, from the command line. Null for an ordinary launch. */
  initialTarget(): Promise<OpenTarget | null>;
  /** Fires when an already-running app is handed a target by a later `gander` command. */
  onOpenTarget(listener: (target: OpenTarget) => void): () => void;
  /** Where the review service is, and whether the environment is deciding that. */
  getConnection(): Promise<{ url: string; token: string; githubToken: string; fromEnvironment: boolean }>;
  /** Checks the token against GitHub, and saves it only if GitHub accepts it. Empty clears it. */
  setGithubToken(token: string): Promise<GithubTokenCheck>;
  testConnection(url: string, token: string): Promise<ConnectionCheck>;
  /** Checks first, and saves only a connection that answered. */
  setConnection(url: string, token: string): Promise<ConnectionCheck>;
  serviceHealthy(): Promise<boolean>;
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView>;
  refreshPr(repoId: string, prNumber: number): Promise<PrView>;
  reviewedSnapshot(repoId: string, prNumber: number, path: string): Promise<string | null>;
  addQuestion(repoId: string, prNumber: number, input: Omit<NewQuestion, "headSha">): Promise<PrView>;
  addReviewerReply(repoId: string, prNumber: number, id: number, text: string): Promise<PrView>;
  deleteQuestion(repoId: string, prNumber: number, id: number): Promise<PrView>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  onOpenSettings(listener: () => void): () => void;
}
