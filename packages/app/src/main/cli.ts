import type { OpenTarget } from "@gander/shared";

/**
 * What the app was asked to open, read from the command line.
 *
 * The audience is an agent that has just finished a branch and wants the reviewer
 * looking at it, so the accepted forms are the strings an agent already holds: a
 * repository id, a pull request number, or the pull request URL itself.
 */

const REPO_ID = /^[^/\s]+\/[^/\s]+$/;
const PR_URL = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const REPO_HASH_NUMBER = /^([^/\s]+\/[^/\s]+)#(\d+)$/;

function valueOf(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === flag) return argv[i + 1] ?? "";
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return null;
}

/**
 * Returns null when no target was named. Chromium adds its own switches to argv
 * (`--user-data-dir` and friends), so anything unrecognized is ignored rather than
 * treated as an error.
 *
 * @throws when a flag is present but unusable — better a message than a silent launch
 *   onto the wrong review.
 */
export function parseOpenTarget(argv: string[]): OpenTarget | null {
  const repoArg = valueOf(argv, "--repo");
  const prArg = valueOf(argv, "--pr");

  let repoId: string | null = null;
  let prNumber: number | null = null;

  if (repoArg !== null) {
    if (!REPO_ID.test(repoArg)) throw new Error(`--repo expects owner/name, got ${JSON.stringify(repoArg)}`);
    repoId = repoArg;
  }

  if (prArg !== null) {
    const url = PR_URL.exec(prArg);
    const hash = REPO_HASH_NUMBER.exec(prArg);
    if (url !== null) {
      repoId = url[1] ?? repoId;
      prNumber = Number(url[2]);
    } else if (hash !== null) {
      repoId = hash[1] ?? repoId;
      prNumber = Number(hash[2]);
    } else if (/^\d+$/.test(prArg)) {
      prNumber = Number(prArg);
    } else {
      throw new Error(`--pr expects a number, owner/name#number, or a pull request URL, got ${JSON.stringify(prArg)}`);
    }
    if (prNumber <= 0) throw new Error(`--pr expects a positive number, got ${JSON.stringify(prArg)}`);
  }

  if (repoId === null) {
    if (prNumber !== null) throw new Error("--pr needs a repository: pass --repo owner/name, or give --pr the pull request URL");
    return null;
  }
  return { repoId, prNumber };
}
