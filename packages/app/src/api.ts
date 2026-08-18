import type { NewQuestion, PrSummary, PrView, RepoEntry } from "@gander/shared";
import type { AppSettings } from "./settings.js";

export interface GanderApi {
  listRepos(): Promise<RepoEntry[]>;
  addRepo(url: string): Promise<RepoEntry>;
  listPrs(repoId: string): Promise<PrSummary[]>;
  lastReview(): Promise<{ repoId: string; prNumber: number } | null>;
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
}
