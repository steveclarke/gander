import { execFile } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileStatus } from "@gander/shared";

const FILE_STATUSES: readonly FileStatus[] = ["A", "M", "D", "R"];

function parseFileStatus(raw: string): FileStatus {
  if ((FILE_STATUSES as readonly string[]).includes(raw)) return raw as FileStatus;
  throw new Error(`unrecognized git diff status letter: ${raw}`);
}

const run = promisify(execFile);

export interface GitEngine {
  ensureClone(repoId: string, url: string): Promise<string>;
  fetchPr(cloneDir: string, prNumber: number, baseRef: string): Promise<void>;
  mergeBase(cloneDir: string, a: string, b: string): Promise<string>;
  diffFiles(cloneDir: string, base: string, head: string): Promise<Array<{ path: string; status: FileStatus }>>;
  showFile(cloneDir: string, rev: string, path: string): Promise<string | null>;
  resolveRef(cloneDir: string, ref: string): Promise<string>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args.join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

export function createGitEngine(clonesRoot: string): GitEngine {
  return {
    async ensureClone(repoId, url) {
      const dir = join(clonesRoot, repoId.replace("/", "__") + ".git");
      if (!existsSync(dir)) {
        mkdirSync(clonesRoot, { recursive: true });
        // `git clone --bare` creates the destination before it finishes, so an
        // interrupted clone would leave a broken repo that existsSync reports as
        // good. Clone into a temp sibling and rename into place only on success,
        // so `dir` only ever exists in a complete state.
        const tmpDir = `${dir}.tmp`;
        rmSync(tmpDir, { recursive: true, force: true }); // clear any leftover from a previous failed attempt
        await git(clonesRoot, ["clone", "--bare", url, tmpDir]);
        renameSync(tmpDir, dir);
      }
      return dir;
    },

    async fetchPr(cloneDir, prNumber, baseRef) {
      await git(cloneDir, [
        "fetch", "--force", "origin",
        `+refs/pull/${prNumber}/head:refs/gander/pr/${prNumber}`,
        `+refs/heads/${baseRef}:refs/gander/base/${baseRef}`,
      ]);
    },

    async mergeBase(cloneDir, a, b) {
      return (await git(cloneDir, ["merge-base", a, b])).trim();
    },

    async diffFiles(cloneDir, base, head) {
      // -M only (no -C), so git never emits a "C" (copy) status line here.
      const out = await git(cloneDir, ["diff", "--name-status", "-M", base, head]);
      return out.split("\n").filter(Boolean).map((line) => {
        const parts = line.split("\t");
        const status = parseFileStatus((parts[0] ?? "").charAt(0));
        // Renames report old\tnew — the new path is the reviewable file.
        const path = (status === "R" ? parts[2] : parts[1]) ?? "";
        return { path, status };
      });
    },

    async showFile(cloneDir, rev, path) {
      try {
        return await git(cloneDir, ["show", `${rev}:${path}`]);
      } catch (err) {
        const msg = (err as Error).message;
        // Only absorb messages about the *path* being absent at a valid revision.
        // "invalid object name" / "bad revision" mean the revision itself is
        // unresolvable (corrupt clone, stale ref) and must throw, not fake a miss.
        if (/does not exist in|exists on disk, but not in/i.test(msg)) return null;
        throw err;
      }
    },

    async resolveRef(cloneDir, ref) {
      return (await git(cloneDir, ["rev-parse", ref])).trim();
    },
  };
}
