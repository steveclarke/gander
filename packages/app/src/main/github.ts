import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrSummary } from "@gander/shared";

const run = promisify(execFile);

interface GhPr {
  number: number; title: string; body: string | null; draft: boolean;
  base: { ref: string; sha: string }; head: { sha: string };
}

export async function listOpenPrs(repoId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PrSummary[]> {
  const res = await fetchImpl(`https://api.github.com/repos/${repoId}/pulls?state=open&per_page=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repoId}: ${await res.text()}`);
  const prs = (await res.json()) as GhPr[];
  return prs.map((p) => ({
    number: p.number, title: p.title, body: p.body ?? "", draft: p.draft,
    baseRef: p.base.ref, baseSha: p.base.sha, headSha: p.head.sha,
  }));
}

export async function resolveGithubToken(configToken?: string): Promise<string> {
  try {
    const { stdout } = await run("gh", ["auth", "token"]);
    if (stdout.trim()) return stdout.trim();
  } catch { /* gh missing or not logged in — fall through */ }
  if (process.env.GANDER_GITHUB_TOKEN) return process.env.GANDER_GITHUB_TOKEN;
  if (configToken) return configToken;
  throw new Error("No GitHub token: log in with `gh auth login`, set GANDER_GITHUB_TOKEN, or add githubToken to the config file");
}
