import { repoIdFromUrl, type RepoEntry } from "@gander/shared";
import type { GitEngine } from "./git.js";

/**
 * Resolves repository identity from Git itself. A typed URL is never enough to register
 * a repository: the checkout is the product's starting point and its origin supplies the
 * GitHub identity used for pull requests.
 */
export async function repositoryFromLocalPath(
  git: Pick<GitEngine, "worktreeRoot" | "originUrl">,
  selectedPath: string,
  expectedRepoId?: string,
): Promise<RepoEntry> {
  const localPath = await git.worktreeRoot(selectedPath);
  const url = await git.originUrl(localPath);
  const repoId = repoIdFromUrl(url);
  if (expectedRepoId !== undefined && repoId !== expectedRepoId) {
    throw new Error(`That folder belongs to ${repoId}, not ${expectedRepoId}`);
  }
  return { repoId, url, localPath };
}

export function assertRepositoryRegistered(repos: RepoEntry[], repoId: string): void {
  if (!repos.some((repo) => repo.repoId === repoId)) {
    throw new Error(`${repoId} is not registered. Open one of its checkout folders first.`);
  }
}

/**
 * Registers `repoId` from the checkout a command was run in, when the app has not seen it
 * before. Identity still comes from that checkout's origin, so this is the same
 * registration the folder picker performs — only the folder comes from the caller, which
 * is already standing in one, rather than from a dialog.
 *
 * Returns the entry when one was added, so the caller knows to save its config.
 */
export async function registerFromCheckout(
  git: Pick<GitEngine, "worktreeRoot" | "originUrl">,
  repos: RepoEntry[],
  repoId: string,
  checkoutPath: string | null,
): Promise<RepoEntry | null> {
  if (repos.some((repo) => repo.repoId === repoId)) return null;
  if (checkoutPath === null) {
    throw new Error(`${repoId} is not registered. Open one of its checkout folders first.`);
  }
  const entry = await repositoryFromLocalPath(git, checkoutPath, repoId);
  repos.push(entry);
  return entry;
}
