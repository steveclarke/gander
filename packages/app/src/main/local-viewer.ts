import type { LocalView } from "@gander/shared";
import type { GitEngine } from "./git.js";

export type LocalViewUpdate =
  | { path: string; view: LocalView; error: null }
  | { path: string; view: null; error: string };

export interface LocalViewWatcher {
  close(): void;
}

const POLL_MS = 500;

function identity(view: LocalView): string {
  return JSON.stringify({
    headSha: view.worktree.headSha,
    branch: view.worktree.branch,
    defaultBranch: view.defaultBranch,
    mergeBaseSha: view.mergeBaseSha,
    files: view.files.map((file) => [file.path, file.status, file.baseHash, file.headHash]),
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
  let previous = identity(initialView ?? await git.localView(worktreePath));
  let previousError: string | null = null;
  let closed = false;
  let computing = false;

  const recompute = async (): Promise<void> => {
    if (closed || computing) return;
    computing = true;
    try {
      const view = await git.localView(worktreePath);
      const next = identity(view);
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
