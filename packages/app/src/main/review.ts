import type { FileCheckoff, NewQuestion, PrFile, PrSummary, PrView } from "@gander/shared";
import type { GitEngine } from "./git.js";
import type { ServiceClient } from "./service-client.js";
import type { ImagePreview, ImageSide } from "../image-preview.js";

export interface ReviewerDeps {
  git: GitEngine;
  service: ServiceClient;
  listPrs(repoId: string): Promise<PrSummary[]>;
  repoUrl(repoId: string): string;
  machine: string;
}
export interface Reviewer {
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  refreshPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView>;
  addQuestion(repoId: string, prNumber: number, input: Omit<NewQuestion, "headSha">): Promise<PrView>;
  addReviewerReply(repoId: string, prNumber: number, id: number, text: string): Promise<PrView>;
  deleteQuestion(repoId: string, prNumber: number, id: number): Promise<PrView>;
  /** The file as it stood when the reviewer last checked it — the base for the delta view. */
  reviewedSnapshot(repoId: string, prNumber: number, path: string): Promise<string | null>;
  imagePreview(repoId: string, prNumber: number, path: string): Promise<ImagePreview>;
}

interface CacheEntry { view: PrView; headSha: string; clone: string; mergeBase: string; }

export function createReviewer(deps: ReviewerDeps): Reviewer {
  const cache = new Map<string, CacheEntry>();
  const key = (repoId: string, prNumber: number): string => `${repoId}#${prNumber}`;

  /** Re-derives checked/changedSince for the already-fetched `files` against the latest service state, without re-reading any blobs. */
  function applyServiceState(files: PrFile[], state: { files: FileCheckoff[] }): PrFile[] {
    const byPath = new Map<string, FileCheckoff>(state.files.map((f) => [f.path, f]));
    return files.map((file) => {
      const stored = byPath.get(file.path);
      // A snapshot exists once the file has ever been checked (or un-checked from
      // checked), because the service retains the prior base/head hashes as the
      // delta base even on a bare uncheck — see storage.ts's putFileState. Absence
      // of a snapshot means "never reviewed", not "unchanged". A real (non-null)
      // hash is stored for binary files too (git.ts hashes raw bytes, not decoded
      // text), so this check works the same for binary and text files.
      const hasSnapshot = stored !== undefined && (stored.baseHash !== null || stored.headHash !== null);
      const hashesMatch = hasSnapshot && stored.baseHash === file.baseHash && stored.headHash === file.headHash;
      const changedSince = hasSnapshot && !hashesMatch;
      const checked = stored?.checked === true && hashesMatch;
      return { ...file, checked, changedSince };
    });
  }

  async function computeFiles(repoId: string, prNumber: number, clone: string, mergeBase: string, head: string): Promise<PrFile[]> {
    const changed = await deps.git.diffFiles(clone, mergeBase, head);
    const state = await deps.service.getReview(repoId, prNumber);

    const raw: PrFile[] = [];
    for (const { path, status } of changed) {
      const baseFile = await deps.git.showFile(clone, mergeBase, path);
      const headFile = await deps.git.showFile(clone, head, path);
      raw.push({
        path, status,
        baseContent: baseFile.content, headContent: headFile.content,
        baseHash: baseFile.hash, headHash: headFile.hash,
        checked: false, changedSince: false,
      });
    }
    const files = applyServiceState(raw, state);
    // A file that was checked but has now drifted from its stored snapshot gets
    // un-checked server-side too, not just displayed as unchecked — otherwise the
    // "changed since your review" signal would vanish the next time anyone (on any
    // machine) reads this review from the service.
    for (const file of files) {
      const stored = state.files.find((f) => f.path === file.path);
      if (stored?.checked === true && file.changedSince) {
        await deps.service.putFileState(repoId, prNumber, { checked: false, path: file.path });
      }
    }
    return files;
  }

  async function recordContext(repoId: string, prNumber: number, pr: PrSummary, all: PrSummary[]): Promise<void> {
    const write = (p: PrSummary): Promise<void> => deps.service.setPrContext(repoId, p.number, {
      headRef: p.headRef,
      title: p.title,
      headSha: p.headSha,
      stackId: p.stack?.id ?? null,
      stackSize: p.stack?.size ?? null,
      stackPosition: p.stack?.position ?? null,
    });

    // Every member of the stack is recorded, not just the one being opened. An agent
    // stands on one branch of a stack and asks about it; if only the reviewed pull
    // request were known, that lookup would come back empty and the agent would be left
    // guessing pull request numbers to find the questions.
    const siblings = pr.stack === null ? [] : all.filter((p) => p.stack?.id === pr.stack?.id && p.number !== pr.number);
    await Promise.all([write(pr), ...siblings.map(write)]);
  }

  async function openPr(repoId: string, prNumber: number): Promise<PrView> {
    const all = await deps.listPrs(repoId);
    const pr = all.find((p) => p.number === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not open on ${repoId}`);

    const clone = await deps.git.ensureClone(repoId, deps.repoUrl(repoId));
    await deps.git.fetchPr(clone, prNumber, pr.baseRef);
    // Recorded here so an agent working in a checkout of this branch can ask the service
    // for its questions by branch name, without the service needing GitHub credentials —
    // and so the answer can name which pull request, and which member of a stack, it is.
    await recordContext(repoId, prNumber, pr, all);
    const head = await deps.git.resolveRef(clone, `refs/gander/pr/${prNumber}`);
    const base = await deps.git.resolveRef(clone, `refs/gander/base/${pr.baseRef}`);
    const mergeBase = await deps.git.mergeBase(clone, base, head);

    const files = await computeFiles(repoId, prNumber, clone, mergeBase, head);
    const questions = await deps.service.listQuestions(repoId, prNumber);
    const view: PrView = { pr, files, questions };
    cache.set(key(repoId, prNumber), { view, headSha: head, clone, mergeBase });
    return view;
  }

  async function refreshPr(repoId: string, prNumber: number): Promise<PrView> {
    const all = await deps.listPrs(repoId);
    const pr = all.find((p) => p.number === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not open on ${repoId}`);

    const clone = await deps.git.ensureClone(repoId, deps.repoUrl(repoId));
    await deps.git.fetchPr(clone, prNumber, pr.baseRef);
    // Kept current on every refresh: it is what tells an agent that a question's line
    // number predates the commits now on the branch.
    await recordContext(repoId, prNumber, pr, all);
    const head = await deps.git.resolveRef(clone, `refs/gander/pr/${prNumber}`);

    const cached = cache.get(key(repoId, prNumber));
    if (cached && cached.headSha === head) {
      // Head hasn't moved: no need to re-read a single blob. Still hit the service —
      // that's how a checkoff made on another machine shows up here — and re-derive
      // checked/changedSince against the blob content and hashes we already have cached.
      const state = await deps.service.getReview(repoId, prNumber);
      const files = applyServiceState(cached.view.files, state);
      const questions = await deps.service.listQuestions(repoId, prNumber);
      const view: PrView = { pr, files, questions };
      cache.set(key(repoId, prNumber), { ...cached, view });
      return view;
    }

    // Head moved (or nothing was cached yet): fall back to a full recompute, same as openPr.
    const base = await deps.git.resolveRef(clone, `refs/gander/base/${pr.baseRef}`);
    const mergeBase = await deps.git.mergeBase(clone, base, head);
    const files = await computeFiles(repoId, prNumber, clone, mergeBase, head);
    const questions = await deps.service.listQuestions(repoId, prNumber);
    const view: PrView = { pr, files, questions };
    cache.set(key(repoId, prNumber), { view, headSha: head, clone, mergeBase });
    return view;
  }

  async function applyChecked(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView> {
    const entry = cache.get(key(repoId, prNumber));
    if (!entry) throw new Error(`PR #${prNumber} on ${repoId} must be opened before checking files`);
    const { view } = entry;
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

  function requireOpen(repoId: string, prNumber: number): PrView {
    const entry = cache.get(key(repoId, prNumber));
    if (!entry) throw new Error(`PR #${prNumber} on ${repoId} must be opened first`);
    return entry.view;
  }

  return {
    openPr,
    refreshPr,
    async addQuestion(repoId, prNumber, input) {
      const view = requireOpen(repoId, prNumber);
      view.questions = [...view.questions, await deps.service.addQuestion(repoId, prNumber, { ...input, headSha: view.pr.headSha })];
      return view;
    },
    async reviewedSnapshot(repoId, prNumber, path) {
      return (await deps.service.getSnapshot(repoId, prNumber, path)).headContent;
    },
    async imagePreview(repoId, prNumber, path) {
      const entry = cache.get(key(repoId, prNumber));
      if (!entry) throw new Error(`PR #${prNumber} on ${repoId} must be opened first`);
      const file = entry.view.files.find((candidate) => candidate.path === path);
      if (!file) throw new Error(`${path} is not part of PR #${prNumber}`);
      const side = (hash: string | null, rev: string): Promise<ImageSide> => hash === null
        ? Promise.resolve({ kind: "absent" })
        : deps.git.showImage(entry.clone, rev, path);
      const [base, head] = await Promise.all([
        side(file.baseHash, entry.mergeBase),
        side(file.headHash, entry.headSha),
      ]);
      return { base, head };
    },
    async addReviewerReply(repoId, prNumber, id, text) {
      const view = requireOpen(repoId, prNumber);
      const question = view.questions.find((q) => q.id === id);
      if (!question) throw new Error(`Question ${id} is not part of PR #${prNumber}`);
      const reply = await deps.service.addReviewerReply(repoId, prNumber, id, text);
      question.replies = [...question.replies, reply];
      return view;
    },
    async deleteQuestion(repoId, prNumber, id) {
      const view = requireOpen(repoId, prNumber);
      await deps.service.deleteQuestion(repoId, prNumber, id);
      view.questions = view.questions.filter((q) => q.id !== id);
      return view;
    },
    setChecked: (repoId, prNumber, path, checked) => applyChecked(repoId, prNumber, [path], checked),
    setCheckedMany: (repoId, prNumber, paths, checked) => applyChecked(repoId, prNumber, paths, checked),
  };
}
