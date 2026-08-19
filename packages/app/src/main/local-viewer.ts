import type { LocalFileEntry, LocalView } from "@gander/shared";
import type { GitEngine } from "./git.js";

export type LocalViewUpdate =
  | { path: string; view: LocalView; error: null }
  | { path: string; view: null; error: string };

export interface LocalViewWatcher {
  close(): void;
}

const POLL_MS = 500;

function identity(view: LocalView, explorerFiles: LocalFileEntry[]): string {
  return JSON.stringify({
    headSha: view.worktree.headSha,
    branch: view.worktree.branch,
    defaultBranch: view.defaultBranch,
    mergeBaseSha: view.mergeBaseSha,
    files: view.files.map((file) => [file.path, file.status, file.baseHash, file.headHash]),
    explorerFiles: explorerFiles.map((file) => file.path),
  });
}

/**
 * Watch one selected worktree with one fixed timer. Recursive native watchers can consume
 * one descriptor per directory (and fail on large repos), while per-file watchers grow
 * without bound. Re-deriving through real Git observes working files, the index, HEAD, and
 * refs with the same semantics as the displayed view, then emits only meaningful changes.
 */
export async function watchLocalView(
  git: GitEngine,
  worktreePath: string,
  onUpdate: (update: LocalViewUpdate) => void,
  initialView?: LocalView,
): Promise<LocalViewWatcher> {
  const [firstView, firstExplorerFiles] = await Promise.all([
    initialView ?? git.localView(worktreePath),
    git.listLocalFiles(worktreePath),
  ]);
  let previous = identity(firstView, firstExplorerFiles);
  let explorerFiles = firstExplorerFiles;
  let explorerTick = 0;
  let previousError: string | null = null;
  let closed = false;
  let computing = false;

  const recompute = async (): Promise<void> => {
    if (closed || computing) return;
    computing = true;
    try {
      const view = await git.localView(worktreePath);
      // Walking a complete filesystem tree every 500ms is bounded but unnecessarily
      // expensive. Diff/ref state stays responsive; ignored-only additions can lag by at
      // most two seconds before the Explorer refreshes.
      if (++explorerTick % 4 === 0) explorerFiles = await git.listLocalFiles(worktreePath);
      const next = identity(view, explorerFiles);
      if (next !== previous || previousError !== null) {
        previous = next;
        previousError = null;
        onUpdate({ path: worktreePath, view, error: null });
      }
    } catch (err) {
      const error = (err as Error).message;
      if (error !== previousError) {
        previousError = error;
        onUpdate({ path: worktreePath, view: null, error });
      }
    } finally {
      computing = false;
    }
  };

  const timer = setInterval(() => void recompute(), POLL_MS);
  return {
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
