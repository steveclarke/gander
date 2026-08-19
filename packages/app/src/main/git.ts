import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readSync, realpathSync, renameSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, FileStatus, LocalFile, LocalFileEntry, LocalView, LocalWorktree } from "@gander/shared";
import { imageMediaType, MAX_IMAGE_BYTES, type ImageSide } from "../image-preview.js";

const FILE_STATUSES: readonly FileStatus[] = ["A", "M", "D", "R"];

function parseFileStatus(raw: string): FileStatus {
  if (raw === "T") return "M";
  if ((FILE_STATUSES as readonly string[]).includes(raw)) return raw as FileStatus;
  throw new Error(`unrecognized git diff status letter: ${raw}`);
}

const run = promisify(execFile);

// Nothing must ever block on an interactive credential prompt — there is no terminal under
// Electron for git to prompt into, so a private repo without a credential helper would just
// hang forever with no feedback. GIT_ASKPASS: "echo" makes any password prompt resolve to an
// empty string immediately instead of blocking.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };

// Generous enough for a full bare clone of a large repo, but finite: a hung git process must
// eventually surface as a loud, named error rather than an app that looks frozen.
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_LOCAL_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_EXPLORER_ENTRIES_PER_DIRECTORY = 50_000;

// git's wording when the *path* is absent at an otherwise valid revision. "invalid object
// name" / "bad revision" mean the revision itself is unresolvable and must never match here.
const PATH_ABSENT_AT_REVISION = /does not exist in|exists on disk, but not in/i;

export interface ShowFileResult {
  /** Decoded UTF-8 content, or null if the path is absent at this revision or the blob is binary. */
  content: string | null;
  /**
   * sha256 of the raw blob bytes. Null only when the path is absent at this revision — a
   * binary blob still gets a real hash, computed over its raw bytes, so change detection
   * (hasSnapshot/changedSince in review.ts) keeps working for binary files even though their
   * content is withheld. This is what makes `content === null` distinguishable: paired with
   * `hash === null` it means "absent here"; paired with a real `hash` it means "binary here".
   */
  hash: string | null;
  binary: boolean;
}

export interface DiffPath { path: string; status: FileStatus; basePath: string; }

export interface GitEngine {
  ensureClone(repoId: string, url: string): Promise<string>;
  fetchPr(cloneDir: string, prNumber: number, baseRef: string): Promise<void>;
  /** Fetch several pull request heads and their base branches in one network operation. */
  fetchPrs(cloneDir: string, prs: Array<{ number: number; baseRef: string }>): Promise<void>;
  mergeBase(cloneDir: string, a: string, b: string): Promise<string>;
  /** `basePath` is the path at `base`, which differs from `path` only for a rename. */
  diffFiles(cloneDir: string, base: string, head: string): Promise<DiffPath[]>;
  showFile(cloneDir: string, rev: string, path: string): Promise<ShowFileResult>;
  showImage(cloneDir: string, rev: string, path: string): Promise<ImageSide>;
  resolveRef(cloneDir: string, ref: string): Promise<string>;
  originUrl(repoDir: string): Promise<string>;
  worktreeRoot(repoDir: string): Promise<string>;
  listWorktrees(repoDir: string): Promise<LocalWorktree[]>;
  localView(worktreeDir: string): Promise<LocalView>;
  /** Lists one directory only; recursion belongs to explicit Explorer expansion. */
  listLocalFiles(worktreeDir: string, directory?: string): Promise<LocalFileEntry[]>;
  localFile(worktreeDir: string, path: string): Promise<LocalFile>;
  localImage(worktreeDir: string, mergeBaseSha: string, path: string, basePath?: string): Promise<{ base: ImageSide; head: ImageSide }>;
}


async function gitPrefix(cloneDir: string, rev: string, path: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ["cat-file", "blob", `${rev}:${path}`];
    const child = spawn("git", ["-C", cloneDir, ...args], { env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let byteCount = 0;
    let enough = false;
    const timer = setTimeout(() => child.kill(), DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (enough) return;
      const remaining = length - byteCount;
      chunks.push(chunk.subarray(0, remaining));
      byteCount += Math.min(chunk.length, remaining);
      if (byteCount >= length) {
        enough = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (enough || code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`git ${args.join(" ")} failed: ${Buffer.concat(errors).toString().trim() || `exited ${code ?? signal}`}`));
    });
  });
}

function describeGitError(args: string[], err: unknown, timeoutMs: number): Error {
  const e = err as { stderr?: string | Buffer; message: string; killed?: boolean; signal?: string | null };
  const stderr = e.stderr ? e.stderr.toString().trim() : "";
  // execFile also kills the child when stdout/stderr exceed maxBuffer — don't call that a
  // timeout, it's a different failure with a different fix.
  const isMaxBuffer = /maxBuffer/i.test(e.message) || /maxBuffer/i.test(stderr);
  if (e.killed && !isMaxBuffer) {
    return new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms and was aborted`);
  }
  return new Error(`git ${args.join(" ")} failed: ${stderr || e.message}`);
}

async function git(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return (await gitBuffer(cwd, args, timeoutMs)).toString("utf8");
}

async function gitBuffer(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      env: GIT_ENV,
      encoding: "buffer",
    });
    return stdout;
  } catch (err) {
    throw describeGitError(args, err, timeoutMs);
  }
}

function fileResult(buf: Buffer): ShowFileResult {
  const hash = createHash("sha256").update(buf).digest("hex");
  const binary = buf.includes(0) || imageMediaType(buf) !== null;
  return binary ? { content: null, hash, binary: true } : { content: buf.toString("utf8"), hash, binary: false };
}

function safeWorkingPath(worktreeDir: string, path: string): string {
  const root = resolve(worktreeDir);
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`git returned a path outside the worktree: ${path}`);
  }
  return absolute;
}

function validateExplorerPath(worktreeDir: string, path: string): void {
  const root = resolve(worktreeDir);
  const absolute = safeWorkingPath(root, path);
  const parts = relative(root, absolute).split(/[\\/]/);
  if (parts.includes(".git")) throw new Error(`Cannot display Git metadata: ${path}`);

  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Cannot display a file through a non-directory worktree entry: ${path}`);
    }
  }
}

function workingFile(worktreeDir: string, path: string): ShowFileResult {
  const absolute = safeWorkingPath(worktreeDir, path);
  if (!existsSync(absolute)) return { content: null, hash: null, binary: false };
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return fileResult(Buffer.from(readlinkSync(absolute)));
  if (stat.isDirectory()) {
    const hash = createHash("sha256").update(`directory\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`).digest("hex");
    return { content: null, hash, binary: true };
  }
  if (!stat.isFile()) throw new Error(`Cannot display special worktree entry: ${path}`);
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error(`Cannot display non-file worktree entry: ${path}`);
    // Local views have no content-addressed review state. A metadata-derived digest for an
    // oversized file keeps the poller bounded while still invalidating when the file moves.
    if (opened.size > MAX_LOCAL_CONTENT_BYTES) {
      const hash = createHash("sha256").update(`oversized\0${opened.size}\0${opened.mtimeMs}\0${opened.ctimeMs}`).digest("hex");
      return { content: null, hash, binary: true };
    }
    return fileResult(readFileSync(fd));
  } finally {
    closeSync(fd);
  }
}

function imageSide(bytes: Buffer): ImageSide {
  const size = bytes.length;
  const mediaType = imageMediaType(bytes.subarray(0, Math.min(bytes.length, 32)));
  if (size > MAX_IMAGE_BYTES) return mediaType === null
    ? { kind: "unsupported", size }
    : { kind: "too-large", size, limit: MAX_IMAGE_BYTES };
  return mediaType === null ? { kind: "unsupported", size } : { kind: "image", mediaType, size, bytes };
}

function workingImage(worktreeDir: string, path: string): ImageSide {
  const absolute = safeWorkingPath(worktreeDir, path);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return imageSide(Buffer.from(readlinkSync(absolute)));
  if (!stat.isFile()) return { kind: "unsupported", size: stat.size };
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { kind: "unsupported", size: opened.size };
    if (opened.size > MAX_IMAGE_BYTES) {
      const prefix = Buffer.alloc(Math.min(opened.size, 32));
      readSync(fd, prefix, 0, prefix.length, 0);
      return imageMediaType(prefix) === null
        ? { kind: "unsupported", size: opened.size }
        : { kind: "too-large", size: opened.size, limit: MAX_IMAGE_BYTES };
    }
    return imageSide(readFileSync(fd));
  } finally {
    closeSync(fd);
  }
}

function parseWorktrees(output: string): LocalWorktree[] {
  return output.split("\0\0").filter(Boolean).flatMap((record) => {
    const fields = record.split("\0");
    const value = (name: string): string | undefined => fields.find((field) => field.startsWith(`${name} `))?.slice(name.length + 1);
    const path = value("worktree");
    const headSha = value("HEAD");
    if (!path || !headSha || fields.includes("bare")) return [];
    const branchRef = value("branch");
    return [{
      path,
      headSha,
      branch: branchRef?.replace(/^refs\/heads\//, "") ?? null,
      locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
    }];
  });
}

function parseDiffPaths(output: string): DiffPath[] {
  const fields = output.split("\0");
  const files: DiffPath[] = [];
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++];
    if (!rawStatus) continue;
    const status = parseFileStatus(rawStatus.charAt(0));
    const firstPath = fields[index++] ?? "";
    if (status === "R") {
      const path = fields[index++] ?? "";
      files.push({ path, status, basePath: firstPath });
    } else {
      files.push({ path: firstPath, status, basePath: firstPath });
    }
  }
  return files;
}

export function createGitEngine(clonesRoot: string): GitEngine {
  // A first clone of a large repo takes long enough that a second openPr can arrive before
  // the first finishes. Without this, both would clone into the same destination and destroy
  // each other's partial work. Concurrent callers for the same repo share one clone.
  const inFlightClones = new Map<string, Promise<string>>();
  let tmpCounter = 0;

  async function clone(dir: string, url: string): Promise<string> {
    mkdirSync(clonesRoot, { recursive: true });
    // `git clone --bare` creates the destination before it finishes, so an
    // interrupted clone would leave a broken repo that existsSync reports as
    // good. Clone into a temp sibling and rename into place only on success,
    // so `dir` only ever exists in a complete state. The suffix is unique per
    // attempt so cleaning up one attempt can never touch another's live clone.
    const tmpDir = `${dir}.tmp-${process.pid}-${tmpCounter++}`;
    try {
      await git(clonesRoot, ["clone", "--bare", url, tmpDir], CLONE_TIMEOUT_MS);
      renameSync(tmpDir, dir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return dir;
  }

  async function fetchPrs(cloneDir: string, prs: Array<{ number: number; baseRef: string }>): Promise<void> {
    const bases = [...new Set(prs.map((pr) => pr.baseRef))];
    await git(cloneDir, [
      "fetch", "--force", "origin",
      ...prs.map((pr) => `+refs/pull/${pr.number}/head:refs/gander/pr/${pr.number}`),
      ...bases.map((baseRef) => `+refs/heads/${baseRef}:refs/gander/base/${baseRef}`),
    ], FETCH_TIMEOUT_MS);
  }

  return {
    async ensureClone(repoId, url) {
      const dir = join(clonesRoot, repoId.replace("/", "__") + ".git");
      if (existsSync(dir)) return dir;

      const pending = inFlightClones.get(dir);
      if (pending) return pending;

      const attempt = clone(dir, url).finally(() => inFlightClones.delete(dir));
      inFlightClones.set(dir, attempt);
      return attempt;
    },

    async fetchPr(cloneDir, prNumber, baseRef) {
      await fetchPrs(cloneDir, [{ number: prNumber, baseRef }]);
    },

    fetchPrs,

    async mergeBase(cloneDir, a, b) {
      return (await git(cloneDir, ["merge-base", a, b])).trim();
    },

    async diffFiles(cloneDir, base, head) {
      // -M only (no -C), so git never emits a "C" (copy) status line here. -z is not
      // optional: without it git applies core.quotePath, so a non-ASCII name arrives as
      // "src/caf\303\251.ts" — quotes and octal escapes included — and a name containing
      // a tab or newline splits into the wrong fields entirely. Either way the path no
      // longer names a blob, and showFile's "does not exist in" branch swallows it as
      // absent rather than raising. Same parse as localView, so both views agree.
      return parseDiffPaths(await git(cloneDir, ["diff", "--name-status", "-z", "-M", base, head, "--"]));
    },

    async showFile(cloneDir, rev, path) {
      let buf: Buffer;
      try {
        buf = await gitBuffer(cloneDir, ["show", `${rev}:${path}`]);
      } catch (err) {
        const msg = (err as Error).message;
        if (PATH_ABSENT_AT_REVISION.test(msg)) return { content: null, hash: null, binary: false };
        throw err;
      }
      // NUL byte in the content is the standard cheap binary heuristic (same one git itself
      // uses internally). Recognized image signatures count as binary too.
      return fileResult(buf);
    },

    async showImage(cloneDir, rev, path) {
      const sizeText = await git(cloneDir, ["cat-file", "-s", `${rev}:${path}`]);
      const size = Number.parseInt(sizeText.trim(), 10);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(`git returned an invalid blob size for ${path}`);

      if (size > MAX_IMAGE_BYTES) {
        // Read only enough bytes to identify the format. Large ordinary binaries retain
        // the generic fallback and large images are rejected without crossing IPC.
        const mediaType = imageMediaType(await gitPrefix(cloneDir, rev, path, 32));
        return mediaType === null
          ? { kind: "unsupported", size }
          : { kind: "too-large", size, limit: MAX_IMAGE_BYTES };
      }

      const bytes = await gitBuffer(cloneDir, ["show", `${rev}:${path}`]);
      const mediaType = imageMediaType(bytes);
      if (mediaType === null) return { kind: "unsupported", size };
      return { kind: "image", mediaType, size, bytes };
    },

    async resolveRef(cloneDir, ref) {
      return (await git(cloneDir, ["rev-parse", ref])).trim();
    },

    async originUrl(repoDir) {
      return (await git(repoDir, ["remote", "get-url", "origin"])).trim();
    },

    async worktreeRoot(repoDir) {
      return (await git(repoDir, ["rev-parse", "--show-toplevel"])).trim();
    },

    async listWorktrees(repoDir) {
      return parseWorktrees(await git(repoDir, ["worktree", "list", "--porcelain", "-z"]));
    },

    async localView(worktreeDir) {
      const worktrees = await this.listWorktrees(worktreeDir);
      const selectedPath = realpathSync(worktreeDir);
      const worktree = worktrees.find((candidate) => realpathSync(candidate.path) === selectedPath);
      if (!worktree) throw new Error(`git worktree list did not include ${worktreeDir}`);

      let defaultRef: string;
      try {
        defaultRef = (await git(worktreeDir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])).trim();
      } catch (err) {
        throw new Error(`Cannot determine the default branch for ${worktreeDir}: ${(err as Error).message}`);
      }
      const defaultBranch = defaultRef.replace(/^origin\//, "");
      let comparisonRef = defaultRef;
      try {
        await git(worktreeDir, ["rev-parse", "--verify", `refs/heads/${defaultBranch}`]);
        comparisonRef = `refs/heads/${defaultBranch}`;
      } catch (err) {
        // A checkout can have only the remote-tracking default branch. It is still a
        // valid base; failure of both refs is surfaced by merge-base below.
        if (!/Needed a single revision|unknown revision|bad revision/i.test((err as Error).message)) throw err;
      }
      const mergeBaseSha = (await git(worktreeDir, ["merge-base", comparisonRef, "HEAD"])).trim();
      const tracked = parseDiffPaths(await git(worktreeDir, ["diff", "--name-status", "-z", "-M", mergeBaseSha, "--"]));
      const untracked = (await git(worktreeDir, ["ls-files", "--others", "--exclude-standard", "-z"]))
        .split("\0").filter(Boolean);
      const paths = [...tracked];
      const untrackedPaths = new Set(untracked);
      const seen = new Set(paths.map((file) => file.path));
      for (const path of untracked) {
        if (!seen.has(path)) paths.push({ path, status: "A", basePath: path });
      }

      const files: ChangedFile[] = [];
      for (const entry of paths) {
        const base = entry.status === "A"
          ? { content: null, hash: null }
          : await this.showFile(worktreeDir, mergeBaseSha, entry.basePath);
        const head = workingFile(worktreeDir, entry.path);
        const readded = entry.status === "D" && untrackedPaths.has(entry.path);
        const status = readded ? "M" : entry.status;
        // `git rm --cached` leaves the file as an untracked path. The local viewer is
        // about the resulting working tree, so an identical re-add is unchanged and a
        // modified re-add is a modification, never a deletion.
        if (readded && base.hash !== null && base.hash === head.hash) continue;
        files.push({
          path: entry.path,
          ...(entry.basePath === entry.path ? {} : { basePath: entry.basePath }),
          status,
          baseContent: base.content,
          headContent: head.content,
          baseHash: base.hash,
          headHash: head.hash,
        });
      }
      files.sort((left, right) => left.path.localeCompare(right.path));
      return { worktree, defaultBranch, mergeBaseSha, files };
    },

    async listLocalFiles(worktreeDir, directory = "") {
      if (directory) validateExplorerPath(worktreeDir, `${directory}/.gander-directory-probe`);
      const absolute = directory ? join(worktreeDir, directory) : worktreeDir;
      const entries = await readdir(absolute, { withFileTypes: true });
      if (entries.length > MAX_EXPLORER_ENTRIES_PER_DIRECTORY) {
        throw new Error(`Explorer stopped after ${MAX_EXPLORER_ENTRIES_PER_DIRECTORY} entries in ${directory || worktreeDir}`);
      }
      return entries
        .filter((entry) => entry.name !== ".git" && (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()))
        .map((entry): LocalFileEntry => ({
          path: directory ? `${directory}/${entry.name}` : entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        }))
        .sort((left, right) => left.kind === right.kind
          ? left.path.localeCompare(right.path)
          : left.kind === "directory" ? -1 : 1);
    },

    async localFile(worktreeDir, path) {
      validateExplorerPath(worktreeDir, path);
      const file = workingFile(worktreeDir, path);
      if (file.hash === null) throw new Error(`${path} no longer exists in this worktree`);
      return { path, content: file.content, hash: file.hash, binary: file.binary };
    },

    async localImage(worktreeDir, mergeBaseSha, path, basePath = path) {
      const current = workingFile(worktreeDir, path);
      const head: ImageSide = current.hash === null
        ? { kind: "absent" }
        : workingImage(worktreeDir, path);
      let base: ImageSide;
      try {
        base = await this.showImage(worktreeDir, mergeBaseSha, basePath);
      } catch (err) {
        if (PATH_ABSENT_AT_REVISION.test((err as Error).message)) base = { kind: "absent" };
        else throw err;
      }
      return { base, head };
    },
  };
}
