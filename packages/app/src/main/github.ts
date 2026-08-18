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
const DEFAULT_API_URL = "https://api.github.com";

export async function listOpenPrs(repoId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PrSummary[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const apiUrl = (process.env.GANDER_GITHUB_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const all: GhPr[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchImpl(`${apiUrl}/repos/${repoId}/pulls?state=open&per_page=${PER_PAGE}&page=${page}`, { headers });
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
  // An explicit process override must win in automation, where consulting a developer's
  // gh session would make a local fake depend on credentials it neither needs nor should see.
  if (process.env.GANDER_GITHUB_TOKEN) return process.env.GANDER_GITHUB_TOKEN;
  try {
    const { stdout } = await execFileImpl("gh", ["auth", "token"]);
    if (stdout.trim()) return stdout.trim();
  } catch { /* gh missing or not logged in — fall through */ }
  if (configToken) return configToken;
  throw new Error("No GitHub token: log in with `gh auth login`, set GANDER_GITHUB_TOKEN, or add githubToken to the config file");
}
