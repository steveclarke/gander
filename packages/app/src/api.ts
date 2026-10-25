import type { ReviewServer, GanderConfig } from "./main/config.js";
import type { LocalFile, LocalFileEntry, LocalView, LocalWorktree, NewNote, OpenTarget, PrListItem, PrView, RepoEntry, UpdateNote } from "@gander/shared";
import type { AppSettings } from "./settings.js";
import type { ThemeId } from "./themes.js";
import type { ConnectionCheck, ServiceStatus } from "./main/connection.js";
import type { ImagePreview } from "./image-preview.js";
import type { LocalViewUpdate } from "./main/local-viewer.js";
import type { CheckoffResult } from "./main/review.js";
import type { GithubViewedSyncStatus } from "./main/github-viewed-queue.js";

export type { ImagePreview, ImageSide } from "./image-preview.js";
export type { GithubViewedSyncStatus } from "./main/github-viewed-queue.js";

export type WindowStyle = "native-titlebar" | "integrated-titlebar";
export const WINDOW_STYLE_ARGUMENT = "--gander-window-style=";
export const COLOR_THEME_ARGUMENT = "--gander-color-theme=";
export const DEVELOPMENT_ARGUMENT = "--gander-development";
export const WORKTREE_LABEL_ARGUMENT = "--gander-worktree-label=";
export type GithubTokenCheck = { ok: true; login: string } | { ok: false; reason: string };

export interface InitialWindowState {
  windowStyle: WindowStyle;
  colorTheme: ThemeId;
  isDevelopment: boolean;
  worktreeLabel: string | null;
}

export type { ConnectionCheck, ServiceStatus };

export interface GanderApi {
  /** Fixed by the main process when the window is created; renderer code cannot change it. */
  initialWindowState: InitialWindowState;
  listRepos(): Promise<RepoEntry[]>;
  /** Prompts for a local checkout, validates its origin, and registers its repository. */
  chooseLocalRepo(expectedRepoId?: string): Promise<RepoEntry | null>;
  removeRepo(repoId: string): Promise<void>;
  listWorktrees(repoId: string): Promise<LocalWorktree[]>;
  listPrs(repoId: string): Promise<PrListItem[]>;
  lastReview(): Promise<{ repoId: string; prNumber: number } | null>;
  /** What this launch was asked to open, from the command line. Null for an ordinary launch. */
  initialTarget(): Promise<OpenTarget | null>;
  /** Fires when an already-running app is handed a target by a later `gander` command. */
  onOpenTarget(listener: (target: OpenTarget) => void): () => void;
  /** Where the review service is, and whether the environment is deciding that. */
  onServersChanged(listener: () => void): () => void;
  getServers(): Promise<{ servers: ReviewServer[]; ownerServers: GanderConfig["ownerServers"]; repos: RepoEntry[]; githubToken: string; fromEnvironment: boolean }>;
  saveServer(server: ReviewServer): Promise<ConnectionCheck>;
  removeServer(id: string): Promise<void>;
  setOwnerServers(rules: GanderConfig["ownerServers"]): Promise<void>;
  setRepoServer(repoId: string, serverId: string): Promise<void>;
  /** Checks the token against GitHub, and saves it only if GitHub accepts it. Empty clears it. */
  setGithubToken(token: string): Promise<GithubTokenCheck>;
  githubViewedSyncStatus(): Promise<GithubViewedSyncStatus>;
  onGithubViewedSyncStatus(listener: (status: GithubViewedSyncStatus) => void): () => void;
  retryGithubViewedSync(): Promise<void>;
  dismissGithubViewedSync(): Promise<void>;
  testConnection(url: string, token: string): Promise<ConnectionCheck>;
  /** Checks first, and saves only a connection that answered. */
  serviceStatus(repoId?: string): Promise<ServiceStatus>;
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean, reviewSessionId?: string): Promise<CheckoffResult>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean, reviewSessionId?: string): Promise<CheckoffResult>;
  refreshPr(repoId: string, prNumber: number, reviewSessionId?: string): Promise<PrView>;
  reviewedSnapshot(repoId: string, prNumber: number, path: string, reviewSessionId?: string): Promise<string | null>;
  imagePreview(repoId: string, prNumber: number, path: string, reviewSessionId?: string): Promise<ImagePreview>;
  openLocal(repoId: string, path: string): Promise<LocalView>;
  /** Lists one directory only. Descendants are requested when the reviewer expands it. */
  listLocalFiles(path: string, directory?: string): Promise<LocalFileEntry[]>;
  localFile(path: string, filePath: string): Promise<LocalFile>;
  refreshLocal(path: string): Promise<LocalView>;
  localImagePreview(path: string): Promise<ImagePreview>;
  closeLocal(): Promise<void>;
  onLocalViewChanged(listener: (update: LocalViewUpdate) => void): () => void;
  addNote(repoId: string, prNumber: number, input: Omit<NewNote, "headSha" | "sourceContext">, reviewSessionId?: string): Promise<PrView>;
  updateNote(repoId: string, prNumber: number, id: number, input: UpdateNote, reviewSessionId?: string): Promise<PrView>;
  deleteNote(repoId: string, prNumber: number, id: number, reviewSessionId?: string): Promise<PrView>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  onOpenSettings(listener: () => void): () => void;
  getZoomLevel(): Promise<number>;
  setZoomLevel(level: number): Promise<number>;
  onZoomChanged(listener: (level: number) => void): () => void;
}
