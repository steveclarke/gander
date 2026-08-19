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

function githubHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

export async function listOpenPrs(repoId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PrSummary[]> {
  const headers = githubHeaders(token);
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

/**
 * Where `gh` is, for an app that was not started from a shell.
 *
 * A GUI launch inherits `PATH=/usr/bin:/bin:/usr/sbin:/sbin` — none of the places a
 * package manager installs to — so looking the binary up on PATH finds nothing on a
 * machine where the reviewer's own terminal runs `gh` perfectly well.
 */
const GH_PATHS = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh"];

/** Whether a token GitHub will accept, and who it belongs to — for the settings pane. */
export async function checkGithubToken(token: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; login: string } | { ok: false; reason: string }> {
  const apiUrl = (process.env.GANDER_GITHUB_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetchImpl(`${apiUrl}/user`, {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/vnd.github+json" },
    });
  } catch (err) {
    return { ok: false, reason: `Could not reach GitHub: ${(err as Error).message}` };
  }
  if (res.status === 401) return { ok: false, reason: "GitHub rejected that token." };
  if (!res.ok) return { ok: false, reason: `GitHub answered ${res.status}` };
  const body = (await res.json()) as { login?: unknown };
  return { ok: true, login: typeof body.login === "string" ? body.login : "an account" };
}

export async function resolveGithubToken(configToken?: string, execFileImpl: ExecFileFn = runGhAuthToken): Promise<string> {
  // An explicit process override must win in automation, where consulting a developer's
  // gh session would make a local fake depend on credentials it neither needs nor should see.
  if (process.env.GANDER_GITHUB_TOKEN) return process.env.GANDER_GITHUB_TOKEN;
  // The configured token first among the real sources: someone who has entered one has
  // said which credential to use, and spawning a process to second-guess that is slower
  // and less predictable.
  if (configToken) return configToken;
  for (const gh of GH_PATHS) {
    try {
      const { stdout } = await execFileImpl(gh, ["auth", "token"]);
      if (stdout.trim()) return stdout.trim();
    } catch { /* not there, or not logged in — try the next */ }
  }
  throw new Error("No GitHub token. Add one in Settings → Connection, or log in with `gh auth login` and restart Gander.");
}
