import type { PrSummary, PrView, RepoEntry } from "@gander/shared";

export interface GanderApi {
  listRepos(): Promise<RepoEntry[]>;
  addRepo(url: string): Promise<RepoEntry>;
  listPrs(repoId: string): Promise<PrSummary[]>;
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView>;
  refreshPr(repoId: string, prNumber: number): Promise<PrView>;
}
export const api = (window as unknown as { gander: GanderApi }).gander;
