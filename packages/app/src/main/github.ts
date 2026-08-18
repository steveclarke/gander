import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrSummary } from "@gander/shared";

type ExecFileFn = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);
const runGhAuthToken: ExecFileFn = (file, args) => execFileAsync(file, args);

interface GhPr {
  number: number; title: string; body: string | null; draft: boolean;
  base: { ref: string; sha: string }; head: { ref: string; sha: string };
  // Present since GitHub shipped stacked pull requests; absent on a standalone one.
  stack?: { id: number; size: number; position: number } | null;
}

const PER_PAGE = 100;

export async function listOpenPrs(repoId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PrSummary[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const all: GhPr[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchImpl(`https://api.github.com/repos/${repoId}/pulls?state=open&per_page=${PER_PAGE}&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repoId}: ${await res.text()}`);
    const prs = (await res.json()) as GhPr[];
    all.push(...prs);
    if (prs.length < PER_PAGE) break;
    page += 1;
  }
  return all.map((p) => ({
    number: p.number, title: p.title, body: p.body ?? "", draft: p.draft,
    baseRef: p.base.ref, baseSha: p.base.sha, headRef: p.head.ref, headSha: p.head.sha,
    stack: p.stack ?? null,
  }));
}

export async function resolveGithubToken(configToken?: string, execFileImpl: ExecFileFn = runGhAuthToken): Promise<string> {
  try {
    const { stdout } = await execFileImpl("gh", ["auth", "token"]);
    if (stdout.trim()) return stdout.trim();
  } catch { /* gh missing or not logged in — fall through */ }
  if (process.env.GANDER_GITHUB_TOKEN) return process.env.GANDER_GITHUB_TOKEN;
  if (configToken) return configToken;
  throw new Error("No GitHub token: log in with `gh auth login`, set GANDER_GITHUB_TOKEN, or add githubToken to the config file");
}
