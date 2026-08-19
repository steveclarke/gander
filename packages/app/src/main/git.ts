import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileStatus } from "@gander/shared";
import { imageMediaType, MAX_IMAGE_BYTES, type ImageSide } from "../image-preview.js";

const FILE_STATUSES: readonly FileStatus[] = ["A", "M", "D", "R"];

function parseFileStatus(raw: string): FileStatus {
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

export interface GitEngine {
  ensureClone(repoId: string, url: string): Promise<string>;
  fetchPr(cloneDir: string, prNumber: number, baseRef: string): Promise<void>;
  mergeBase(cloneDir: string, a: string, b: string): Promise<string>;
  diffFiles(cloneDir: string, base: string, head: string): Promise<Array<{ path: string; status: FileStatus }>>;
  showFile(cloneDir: string, rev: string, path: string): Promise<ShowFileResult>;
  showImage(cloneDir: string, rev: string, path: string): Promise<ImageSide>;
  resolveRef(cloneDir: string, ref: string): Promise<string>;
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
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      env: GIT_ENV,
    });
    return stdout;
  } catch (err) {
    throw describeGitError(args, err, timeoutMs);
  }
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
      await git(cloneDir, [
        "fetch", "--force", "origin",
        `+refs/pull/${prNumber}/head:refs/gander/pr/${prNumber}`,
        `+refs/heads/${baseRef}:refs/gander/base/${baseRef}`,
      ], FETCH_TIMEOUT_MS);
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
      let buf: Buffer;
      try {
        buf = await gitBuffer(cloneDir, ["show", `${rev}:${path}`]);
      } catch (err) {
        const msg = (err as Error).message;
        // Only absorb messages about the *path* being absent at a valid revision.
        // "invalid object name" / "bad revision" mean the revision itself is
        // unresolvable (corrupt clone, stale ref) and must throw, not fake a miss.
        if (/does not exist in|exists on disk, but not in/i.test(msg)) return { content: null, hash: null, binary: false };
        throw err;
      }
      const hash = createHash("sha256").update(buf).digest("hex");
      // NUL byte in the content is the standard cheap binary heuristic (same one git itself
      // uses internally). Decoding a binary blob as UTF-8 would mangle it into U+FFFD replacement
      // characters that then get hashed and stored as the "reviewed snapshot" — nonsense.
      // Some valid image encodings can avoid a NUL in small files. Treat a recognized
      // image signature as binary too, so its bytes are never decoded or snapshotted as text.
      const binary = buf.includes(0) || imageMediaType(buf) !== null;
      if (binary) return { content: null, hash, binary: true };
      return { content: buf.toString("utf8"), hash, binary: false };
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
  };
}
