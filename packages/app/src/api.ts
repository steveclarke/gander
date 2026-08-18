import type { NewQuestion, OpenTarget, PrSummary, PrView, RepoEntry } from "@gander/shared";
import type { AppSettings } from "./settings.js";

export interface GanderApi {
  listRepos(): Promise<RepoEntry[]>;
  addRepo(url: string): Promise<RepoEntry>;
  listPrs(repoId: string): Promise<PrSummary[]>;
  lastReview(): Promise<{ repoId: string; prNumber: number } | null>;
  /** What this launch was asked to open, from the command line. Null for an ordinary launch. */
  initialTarget(): Promise<OpenTarget | null>;
  /** Fires when an already-running app is handed a target by a later `gander` command. */
  onOpenTarget(listener: (target: OpenTarget) => void): () => void;
  serviceHealthy(): Promise<boolean>;
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView>;
  refreshPr(repoId: string, prNumber: number): Promise<PrView>;
  reviewedSnapshot(repoId: string, prNumber: number, path: string): Promise<string | null>;
  addQuestion(repoId: string, prNumber: number, input: Omit<NewQuestion, "headSha">): Promise<PrView>;
  deleteQuestion(repoId: string, prNumber: number, id: number): Promise<PrView>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  onOpenSettings(listener: () => void): () => void;
}
