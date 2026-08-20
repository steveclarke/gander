import type { FileCheckoff, NewNote, PrFile, PrListItem, PrSummary, PrView, ReviewState, UpdateNote } from "@gander/shared";
import type { GitEngine } from "./git.js";
import { ServiceConnectionError, STALE_SERVICE_DATA_WRITE_ERROR, type ServiceClient } from "./service-client.js";
import type { ImagePreview, ImageSide } from "../image-preview.js";

export interface ReviewerDeps {
  git: GitEngine;
  service: ServiceClient;
  listPrs(repoId: string): Promise<PrSummary[]>;
  repoUrl(repoId: string): string;
  machine: string;
}
export interface Reviewer {
  listPrsWithProgress(repoId: string): Promise<PrListItem[]>;
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  refreshPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  setCheckedMany(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView>;
  addNote(repoId: string, prNumber: number, input: Omit<NewNote, "headSha" | "sourceContext">): Promise<PrView>;
  updateNote(repoId: string, prNumber: number, id: number, input: UpdateNote): Promise<PrView>;
  deleteNote(repoId: string, prNumber: number, id: number): Promise<PrView>;
  /** The file as it stood when the reviewer last checked it — the base for the delta view. */
  reviewedSnapshot(repoId: string, prNumber: number, path: string): Promise<string | null>;
  imagePreview(repoId: string, prNumber: number, path: string): Promise<ImagePreview>;
}

interface CacheEntry {
  view: PrView;
  headSha: string;
  clone: string;
  mergeBase: string;
  /** False after a service failure until an authoritative read replaces service-owned state. */
  serviceStateFresh: boolean;
}

export function createReviewer(deps: ReviewerDeps): Reviewer {
  const cache = new Map<string, CacheEntry>();
  const key = (repoId: string, prNumber: number): string => `${repoId}#${prNumber}`;

  async function useCachedViewOnConnectionFailure(
    repoId: string,
    prNumber: number,
    load: () => Promise<PrView>,
  ): Promise<PrView> {
    try {
      return await load();
    } catch (err) {
      const cached = cache.get(key(repoId, prNumber));
      if (err instanceof ServiceConnectionError && cached) {
        cached.serviceStateFresh = false;
        return cached.view;
      }
      throw err;
    }
  }

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

  async function computeFiles(repoId: string, prNumber: number, clone: string, mergeBase: string, head: string, knownState?: ReviewState): Promise<PrFile[]> {
    const changed = await deps.git.diffFiles(clone, mergeBase, head);
    const state = knownState ?? await deps.service.getReview(repoId, prNumber);

    const raw: PrFile[] = [];
    for (const { path, status, basePath } of changed) {
      // A rename's base side exists only under its old path. Reading the new path at the
      // merge base comes back "absent", which showFile reports as null content — and the
      // whole file then reads as newly added instead of as the change actually made.
      const baseFile = await deps.git.showFile(clone, mergeBase, basePath);
      const headFile = await deps.git.showFile(clone, head, path);
      raw.push({
        path, status,
        ...(basePath === path ? {} : { basePath }),
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
    // guessing pull request numbers to find the notes.
    const siblings = pr.stack === null ? [] : all.filter((p) => p.stack?.id === pr.stack?.id && p.number !== pr.number);
    await Promise.all([write(pr), ...siblings.map(write)]);
  }

  /**
   * Fetches the branch and records its context, up to the point where the head sha is known.
   *
   * Recorded here so an agent working in a checkout of this branch can ask the service for
   * its notes by branch name, without the service needing GitHub credentials — and so
   * the answer can name which pull request, and which member of a stack, it is. Kept current
   * on every refresh too: it is what tells an agent that a note's line number predates
   * the commits now on the branch.
   */
  async function fetchHead(repoId: string, prNumber: number): Promise<{ pr: PrSummary; clone: string; head: string }> {
    const all = await deps.listPrs(repoId);
    const pr = all.find((p) => p.number === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not open on ${repoId}`);

    const clone = await deps.git.ensureClone(repoId, deps.repoUrl(repoId));
    await deps.git.fetchPr(clone, prNumber, pr.baseRef);
    await recordContext(repoId, prNumber, pr, all);
    const head = await deps.git.resolveRef(clone, `refs/gander/pr/${prNumber}`);
    return { pr, clone, head };
  }

  /** Reads every blob afresh and caches the result: the path taken whenever the head moved. */
  async function recomputeView(repoId: string, prNumber: number, pr: PrSummary, clone: string, head: string): Promise<PrView> {
    const base = await deps.git.resolveRef(clone, `refs/gander/base/${pr.baseRef}`);
    const mergeBase = await deps.git.mergeBase(clone, base, head);
    const files = await computeFiles(repoId, prNumber, clone, mergeBase, head);
    const notes = await deps.service.listNotes(repoId, prNumber);
    const view: PrView = { pr, files, notes };
    cache.set(key(repoId, prNumber), { view, headSha: head, clone, mergeBase, serviceStateFresh: true });
    return view;
  }

  async function loadPr(repoId: string, prNumber: number): Promise<PrView> {
    const { pr, clone, head } = await fetchHead(repoId, prNumber);
    return recomputeView(repoId, prNumber, pr, clone, head);
  }

  async function openPr(repoId: string, prNumber: number): Promise<PrView> {
    return useCachedViewOnConnectionFailure(repoId, prNumber, () => loadPr(repoId, prNumber));
  }

  async function loadRefresh(repoId: string, prNumber: number): Promise<PrView> {
    const { pr, clone, head } = await fetchHead(repoId, prNumber);

    const cached = cache.get(key(repoId, prNumber));
    if (cached && cached.headSha === head) {
      // Head hasn't moved: no need to re-read a single blob. Still hit the service —
      // that's how a checkoff made on another machine shows up here — and re-derive
      // checked/changedSince against the blob content and hashes we already have cached.
      const state = await deps.service.getReview(repoId, prNumber);
      const files = applyServiceState(cached.view.files, state);
      const notes = await deps.service.listNotes(repoId, prNumber);
      const view: PrView = { pr, files, notes };
      cache.set(key(repoId, prNumber), { ...cached, view, serviceStateFresh: true });
      return view;
    }

    // Head moved (or nothing was cached yet): fall back to a full recompute, same as openPr.
    return recomputeView(repoId, prNumber, pr, clone, head);
  }

  async function refreshPr(repoId: string, prNumber: number): Promise<PrView> {
    return useCachedViewOnConnectionFailure(repoId, prNumber, () => loadRefresh(repoId, prNumber));
  }

  async function applyChecked(repoId: string, prNumber: number, paths: string[], checked: boolean): Promise<PrView> {
    const entry = requireWritable(repoId, prNumber);
    const { view } = entry;
    for (const path of paths) {
      const file = view.files.find((f) => f.path === path);
      if (!file) throw new Error(`${path} is not part of PR #${prNumber}`);
      if (checked) {
        await writeServiceState(entry, () => deps.service.putFileState(repoId, prNumber, {
          checked: true, path,
          baseHash: file.baseHash, headHash: file.headHash,
          baseContent: file.baseContent, headContent: file.headContent,
          machine: deps.machine,
        }));
        file.checked = true;
        file.changedSince = false;
      } else {
        await writeServiceState(entry, () => deps.service.putFileState(repoId, prNumber, { checked: false, path }));
        file.checked = false;
      }
    }
    return view;
  }

  function requireWritable(repoId: string, prNumber: number): CacheEntry {
    const entry = cache.get(key(repoId, prNumber));
    if (!entry) throw new Error(`PR #${prNumber} on ${repoId} must be opened first`);
    if (!entry.serviceStateFresh) {
      throw new ServiceConnectionError(STALE_SERVICE_DATA_WRITE_ERROR);
    }
    return entry;
  }

  async function writeServiceState<T>(entry: CacheEntry, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof ServiceConnectionError) entry.serviceStateFresh = false;
      throw err;
    }
  }

  return {
    async listPrsWithProgress(repoId) {
      const [prs, reviews] = await Promise.all([
        deps.listPrs(repoId),
        deps.service.listReviews(repoId),
      ]);
      const states = new Map(reviews.map((review) => [review.prNumber, review]));
      const started = prs.filter((pr) => states.get(pr.number)?.files.some(
        (file) => file.baseHash !== null || file.headHash !== null,
      ));
      const progress = new Map<number, { done: number; total: number }>();

      if (started.length > 0) {
        const clone = await deps.git.ensureClone(repoId, deps.repoUrl(repoId));
        // Pull request rows are a repository-level view. Fetch all reviewed heads in one
        // operation instead of opening each pull request (and fetching it) in series.
        await deps.git.fetchPrs(clone, started.map(({ number, baseRef }) => ({ number, baseRef })));
        await Promise.all(started.map(async (pr) => {
          const head = await deps.git.resolveRef(clone, `refs/gander/pr/${pr.number}`);
          const base = await deps.git.resolveRef(clone, `refs/gander/base/${pr.baseRef}`);
          const mergeBase = await deps.git.mergeBase(clone, base, head);
          const files = await computeFiles(repoId, pr.number, clone, mergeBase, head, states.get(pr.number));
          progress.set(pr.number, { done: files.filter((file) => file.checked).length, total: files.length });
        }));
      }

      return prs.map((pr) => ({ ...pr, reviewProgress: progress.get(pr.number) ?? null }));
    },
    openPr,
    refreshPr,
    async addNote(repoId, prNumber, input) {
      const entry = requireWritable(repoId, prNumber);
      const { view } = entry;
      const file = input.path === null ? undefined : view.files.find((candidate) => candidate.path === input.path);
      const lines = file?.headContent?.split("\n") ?? [];
      const sourceContext = input.line === null || input.line > lines.length
        ? null
        : {
            startLine: Math.max(1, input.line - 2),
            lines: lines.slice(Math.max(0, input.line - 3), input.line + 2),
          };
      const note = await writeServiceState(entry, () => deps.service.addNote(repoId, prNumber, {
        ...input,
        headSha: view.pr.headSha,
        sourceContext,
      }));
      view.notes = [...view.notes, note];
      return view;
    },
    async reviewedSnapshot(repoId, prNumber, path) {
      return (await deps.service.getSnapshot(repoId, prNumber, path)).headContent;
    },
    async updateNote(repoId, prNumber, id, input) {
      const entry = requireWritable(repoId, prNumber);
      const note = await writeServiceState(entry, () => deps.service.updateNote(repoId, prNumber, id, input));
      entry.view.notes = entry.view.notes.map((candidate) => candidate.id === id ? note : candidate);
      return entry.view;
    },
    async imagePreview(repoId, prNumber, path) {
      const entry = cache.get(key(repoId, prNumber));
      if (!entry) throw new Error(`PR #${prNumber} on ${repoId} must be opened first`);
      const file = entry.view.files.find((candidate) => candidate.path === path);
      if (!file) throw new Error(`${path} is not part of PR #${prNumber}`);
      // Each side reads the path that revision actually knows: a rename's base blob lives
      // under its old name. showImage resolves a size before anything else and raises on a
      // path the revision does not hold, so passing the new path here would fail outright.
      const side = (hash: string | null, rev: string, at: string): Promise<ImageSide> => hash === null
        ? Promise.resolve({ kind: "absent" })
        : deps.git.showImage(entry.clone, rev, at);
      const [base, head] = await Promise.all([
        side(file.baseHash, entry.mergeBase, file.basePath ?? path),
        side(file.headHash, entry.headSha, path),
      ]);
      return { base, head };
    },
    async deleteNote(repoId, prNumber, id) {
      const entry = requireWritable(repoId, prNumber);
      const { view } = entry;
      await writeServiceState(entry, () => deps.service.deleteNote(repoId, prNumber, id));
      view.notes = view.notes.filter((q) => q.id !== id);
      return view;
    },
    setChecked: (repoId, prNumber, path, checked) => applyChecked(repoId, prNumber, [path], checked),
    setCheckedMany: (repoId, prNumber, paths, checked) => applyChecked(repoId, prNumber, paths, checked),
  };
}
