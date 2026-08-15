import { createHash } from "node:crypto";
import type { FileCheckoff, PrFile, PrSummary, PrView } from "@gander/shared";
import type { GitEngine } from "./git.js";
import type { ServiceClient } from "./service-client.js";

export interface ReviewerDeps {
  git: GitEngine;
  service: ServiceClient;
  listPrs(repoId: string): Promise<PrSummary[]>;
  repoUrl(repoId: string): string;
  machine: string;
}
export interface Reviewer {
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView>;
}

const sha256 = (s: string | null): string | null =>
  s === null ? null : createHash("sha256").update(s).digest("hex");

export function createReviewer(deps: ReviewerDeps): Reviewer {
  const cache = new Map<string, PrView>();
  const key = (repoId: string, prNumber: number): string => `${repoId}#${prNumber}`;

  async function openPr(repoId: string, prNumber: number): Promise<PrView> {
    const pr = (await deps.listPrs(repoId)).find((p) => p.number === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not open on ${repoId}`);

    const clone = await deps.git.ensureClone(repoId, deps.repoUrl(repoId));
    await deps.git.fetchPr(clone, prNumber, pr.baseRef);
    const head = await deps.git.resolveRef(clone, `refs/gander/pr/${prNumber}`);
    const base = await deps.git.resolveRef(clone, `refs/gander/base/${pr.baseRef}`);
    const mergeBase = await deps.git.mergeBase(clone, base, head);
    const changed = await deps.git.diffFiles(clone, mergeBase, head);

    const state = await deps.service.getReview(repoId, prNumber);
    const byPath = new Map<string, FileCheckoff>(state.files.map((f) => [f.path, f]));

    const files: PrFile[] = [];
    for (const { path, status } of changed) {
      const baseContent = await deps.git.showFile(clone, mergeBase, path);
      const headContent = await deps.git.showFile(clone, head, path);
      const baseHash = sha256(baseContent);
      const headHash = sha256(headContent);
      const stored = byPath.get(path);
      const stillValid = stored?.checked === true && stored.baseHash === baseHash && stored.headHash === headHash;
      const changedSince = stored?.checked === true && !stillValid;
      if (changedSince) {
        await deps.service.putFileState(repoId, prNumber, { checked: false, path });
      }
      files.push({ path, status, baseContent, headContent, baseHash, headHash, checked: stillValid === true, changedSince: changedSince === true });
    }
    const view: PrView = { pr, files };
    cache.set(key(repoId, prNumber), view);
    return view;
  }

  async function applyChecked(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView> {
    const view = cache.get(key(repoId, prNumber));
    if (!view) throw new Error(`PR #${prNumber} on ${repoId} must be opened before checking files`);
    for (const path of paths) {
      const file = view.files.find((f) => f.path === path);
      if (!file) throw new Error(`${path} is not part of PR #${prNumber}`);
      if (checked) {
        await deps.service.putFileState(repoId, prNumber, {
          checked: true, path,
          baseHash: file.baseHash, headHash: file.headHash,
          baseContent: file.baseContent, headContent: file.headContent,
          machine: deps.machine,
        });
        file.checked = true;
        file.changedSince = false;
      } else {
        await deps.service.putFileState(repoId, prNumber, { checked: false, path });
        file.checked = false;
      }
    }
    return view;
  }

  return {
    openPr,
    setChecked: (repoId, prNumber, path, checked) => applyChecked(repoId, prNumber, [path], checked),
    setCheckedMany: (repoId, prNumber, paths, checked) => applyChecked(repoId, prNumber, paths, checked),
  };
}
