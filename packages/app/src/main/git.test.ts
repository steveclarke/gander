import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitEngine, type GitEngine } from "./git.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { MAX_IMAGE_BYTES } from "../image-preview.js";

let fixture: FixtureRepo; let clonesRoot: string; let engine: GitEngine;

beforeEach(async () => {
  fixture = await makeFixtureRepo();
  clonesRoot = mkdtempSync(join(tmpdir(), "gander-clones-"));
  engine = createGitEngine(clonesRoot);
});
afterEach(() => { rmSync(fixture.dir, { recursive: true, force: true }); rmSync(clonesRoot, { recursive: true, force: true }); });

describe("git engine", () => {
  it("clones bare, fetches a PR, and diffs base...head", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const mb = await engine.mergeBase(clone, base, head);
    expect(mb).toBe(base); // feature branched off main tip

    const files = await engine.diffFiles(clone, mb, head);
    expect(files).toEqual([
      { path: "a.rb", status: "M", basePath: "a.rb" },
      { path: "b.rb", status: "A", basePath: "b.rb" },
    ]);
  });

  it("ensureClone is idempotent and fetchPr picks up new commits", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    // advance the PR in origin
    await fixture.git(["checkout", "feature"]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(fixture.dir, "c.rb"), "class C\nend\n");
    await fixture.git(["add", "-A"]); await fixture.git(["commit", "-m", "more"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const again = await engine.ensureClone("acme/atlas", fixture.dir);
    expect(again).toBe(clone);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const files = await engine.diffFiles(clone, await engine.resolveRef(clone, "refs/gander/base/main"), head);
    expect(files.map((f) => f.path)).toContain("c.rb");
  });

  it("concurrent ensureClone calls for the same repo share one clone", async () => {
    // Overlapping openPr calls (a second click while the first clone is still running) used
    // to clone into the same destination and delete each other's in-progress pack files.
    const results = await Promise.all([
      engine.ensureClone("acme/atlas", fixture.dir),
      engine.ensureClone("acme/atlas", fixture.dir),
      engine.ensureClone("acme/atlas", fixture.dir),
    ]);
    expect(new Set(results).size).toBe(1);

    // Every caller gets a usable repo, and no temp directory survives.
    const head = await engine.resolveRef(results[0]!, "refs/heads/main");
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(clonesRoot).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("showFile returns content for existing paths and null for absent ones", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const present = await engine.showFile(clone, head, "b.rb");
    expect(present.content).toBe("class B\nend\n");
    expect(present.binary).toBe(false);
    expect(present.hash).not.toBeNull();

    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    const absent = await engine.showFile(clone, base, "b.rb");
    expect(absent.content).toBeNull();
    expect(absent.hash).toBeNull();
    expect(absent.binary).toBe(false);
  });

  it("showFile detects a binary blob, withholds its content, but still hashes it", async () => {
    // A real binary fixture: a NUL byte anywhere in the blob is git's own binary heuristic.
    const { writeFileSync } = await import("node:fs");
    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x01]));
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "-m", "add binary fixture"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");

    const atHead = await engine.showFile(clone, head, "logo.png");
    expect(atHead.content).toBeNull();
    expect(atHead.binary).toBe(true);
    expect(atHead.hash).not.toBeNull(); // real hash from raw bytes, distinguishable from "absent"

    const atBase = await engine.showFile(clone, base, "logo.png");
    expect(atBase.content).toBeNull();
    expect(atBase.hash).toBeNull(); // absent at base — same content-shape as binary, different hash-shape
    expect(atBase.binary).toBe(false);
  });

  it("showImage transports only signature-detected, bounded image bytes", async () => {
    const png = readFileSync(join(import.meta.dirname, "../../resources/icon.png"));
    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "real-image.dat"), png);
    writeFileSync(join(fixture.dir, "ordinary.bin"), Buffer.from([0, 1, 2, 3, 4]));
    writeFileSync(join(fixture.dir, "corrupt.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    png.copy(oversized, 0, 0, 16);
    writeFileSync(join(fixture.dir, "oversized.bin"), oversized);
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "-m", "add image cases"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");

    const image = await engine.showImage(clone, head, "real-image.dat");
    expect(image).toMatchObject({ kind: "image", mediaType: "image/png", size: png.length });
    expect(image.kind === "image" && Buffer.from(image.bytes).equals(png)).toBe(true);
    await expect(engine.showImage(clone, head, "ordinary.bin")).resolves.toEqual({ kind: "unsupported", size: 5 });
    await expect(engine.showImage(clone, head, "corrupt.png")).resolves.toMatchObject({ kind: "image", mediaType: "image/png" });
    await expect(engine.showImage(clone, head, "oversized.bin")).resolves.toEqual({
      kind: "too-large", size: MAX_IMAGE_BYTES + 1, limit: MAX_IMAGE_BYTES,
    });
    expect((await engine.showFile(clone, head, "corrupt.png")).binary).toBe(true);
  });

  it("showFile throws (does not swallow) when the revision itself is bad", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    await expect(engine.showFile(clone, "not-a-real-rev", "b.rb")).rejects.toThrow();
  });

  it("diffFiles reports a rename with the new path and status R", async () => {
    // Rename unchanged.txt -> renamed.txt on the feature branch, keep content identical
    // so git's rename detection (-M) fires, then advance refs/pull/1/head to it.
    await fixture.git(["checkout", "feature"]);
    await fixture.git(["mv", "unchanged.txt", "renamed.txt"]);
    await fixture.git(["commit", "-m", "rename unchanged.txt"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const files = await engine.diffFiles(clone, base, head);
    expect(files).toContainEqual({ path: "renamed.txt", status: "R", basePath: "unchanged.txt" });
    expect(files.some((f) => f.path === "unchanged.txt")).toBe(false);
  });

  it("diffFiles keeps the merge-base path of a rename that also changed content", async () => {
    // The reviewable file is the new path, but its base side only exists under the old
    // one. Losing basePath here is what made a renamed file read as wholly added.
    // The file is long enough that a one-line edit stays above git's -M similarity
    // threshold, so this is a real R and not a delete/add pair.
    const original = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n";
    const renamed = await makeFixtureRepo({}, { "long.txt": original });
    try {
      await renamed.git(["checkout", "feature"]);
      await renamed.git(["mv", "long.txt", "moved.txt"]);
      writeFileSync(join(renamed.dir, "moved.txt"), original.replace("three\n", "THREE\n"));
      await renamed.git(["add", "-A"]);
      await renamed.git(["commit", "-m", "rename and edit"]);
      await renamed.git(["update-ref", "refs/pull/1/head", await renamed.git(["rev-parse", "HEAD"])]);
      await renamed.git(["checkout", "main"]);

      const clone = await engine.ensureClone("acme/moved", renamed.dir);
      await engine.fetchPr(clone, 1, "main");
      const base = await engine.resolveRef(clone, "refs/gander/base/main");
      const head = await engine.resolveRef(clone, "refs/gander/pr/1");
      const files = await engine.diffFiles(clone, base, head);

      const moved = files.find((f) => f.path === "moved.txt");
      expect(moved).toEqual({ path: "moved.txt", status: "R", basePath: "long.txt" });
      // The base side has to be readable at the old path, or the diff shows a whole new file.
      expect((await engine.showFile(clone, base, moved!.basePath)).content).toBe(original);
    } finally {
      rmSync(renamed.dir, { recursive: true, force: true });
    }
  });

  it("diffFiles returns paths git would otherwise quote and escape", async () => {
    // Without -z, git applies core.quotePath: a non-ASCII name comes back as
    // "src/caf\303\251.ts" — quotes and octal escapes included — and no longer
    // names a blob that showFile can resolve.
    await fixture.git(["checkout", "feature"]);
    mkdirSync(join(fixture.dir, "src"), { recursive: true });
    writeFileSync(join(fixture.dir, "src/café.ts"), "export const x = 1;\n");
    writeFileSync(join(fixture.dir, "src/with space.ts"), "export const y = 2;\n");
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "-m", "unicode and spaces"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const files = await engine.diffFiles(clone, base, head);

    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(["src/café.ts", "src/with space.ts"]));
    expect((await engine.showFile(clone, head, "src/café.ts")).content).toBe("export const x = 1;\n");
  });

  it("discovers real linked worktrees and derives local changes from merge-base through the working tree", async () => {
    const mainSha = await fixture.git(["rev-parse", "refs/heads/main"]);
    await fixture.git(["update-ref", "refs/remotes/origin/main", mainSha]);
    await fixture.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const linked = mkdtempSync(join(tmpdir(), "gander-worktree-"));
    rmSync(linked, { recursive: true });
    await fixture.git(["worktree", "add", linked, "feature"]);
    writeFileSync(join(linked, "a.rb"), "class A\n  def local; end\nend\n");
    writeFileSync(join(linked, "untracked.ts"), "export const local = true;\n");
    writeFileSync(join(linked, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(linked, "ignored.txt"), "not reviewable\n");
    await fixture.git(["-C", linked, "rm", "--cached", "unchanged.txt"]);
    writeFileSync(join(linked, "unchanged.txt"), "changed but still present\n");

    try {
      const worktrees = await engine.listWorktrees(linked);
      expect(worktrees.map((worktree) => realpathSync(worktree.path))).toEqual(expect.arrayContaining([realpathSync(fixture.dir), realpathSync(linked)]));
      expect(worktrees.find((worktree) => realpathSync(worktree.path) === realpathSync(linked))).toMatchObject({ branch: "feature", locked: false });

      const view = await engine.localView(linked);
      expect(view.defaultBranch).toBe("main");
      expect(view.mergeBaseSha).toBe(mainSha);
      expect(view.files.map((file) => [file.path, file.status])).toEqual([
        [".gitignore", "A"],
        ["a.rb", "M"],
        ["b.rb", "A"],
        ["unchanged.txt", "M"],
        ["untracked.ts", "A"],
      ]);
      expect(view.files.find((file) => file.path === "a.rb")).toMatchObject({
        baseContent: "class A\nend\n",
        headContent: "class A\n  def local; end\nend\n",
      });
      expect(view.files.some((file) => file.path === "ignored.txt")).toBe(false);

      rmSync(join(linked, "b.rb"));
      mkdirSync(join(linked, "vendor/cache"), { recursive: true });
      writeFileSync(join(linked, "vendor/cache/archive.zip"), "dependency cache\n");
      const explorer = await engine.listLocalFiles(linked);
      expect(explorer).toEqual([
        { path: "vendor", kind: "directory" },
        { path: ".gitignore", kind: "file" },
        { path: "a.rb", kind: "file" },
        { path: "ignored.txt", kind: "file" },
        { path: "unchanged.txt", kind: "file" },
        { path: "untracked.ts", kind: "file" },
      ]);
      expect(await engine.listLocalFiles(linked, "vendor")).toEqual([
        { path: "vendor/cache", kind: "directory" },
      ]);
      expect(await engine.listLocalFiles(linked, "vendor/cache")).toEqual([
        { path: "vendor/cache/archive.zip", kind: "file" },
      ]);
      await expect(engine.listLocalFiles(linked, ".git")).rejects.toThrow("Cannot display Git metadata");
      await expect(engine.listLocalFiles(linked, "../")).rejects.toThrow("outside the worktree");
      expect(await engine.localFile(linked, "untracked.ts")).toMatchObject({
        path: "untracked.ts",
        content: "export const local = true;\n",
        binary: false,
      });
      expect(await engine.localFile(linked, "ignored.txt")).toMatchObject({ content: "not reviewable\n" });
      await expect(engine.localFile(linked, ".git/config")).rejects.toThrow("Cannot display Git metadata");

      const external = join(clonesRoot, "outside.png");
      writeFileSync(external, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      symlinkSync(external, join(linked, "outside-link.png"));
      const withLink = await engine.localView(linked);
      expect(withLink.files.find((file) => file.path === "outside-link.png")?.headContent).toBe(external);
      expect((await engine.localImage(linked, withLink.mergeBaseSha, "outside-link.png")).head.kind).toBe("unsupported");
    } finally {
      await fixture.git(["worktree", "remove", "--force", linked]);
    }
  });

  it("uses the original merge-base path for a renamed local file", async () => {
    const mainSha = await fixture.git(["rev-parse", "refs/heads/main"]);
    await fixture.git(["update-ref", "refs/remotes/origin/main", mainSha]);
    await fixture.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const linked = mkdtempSync(join(tmpdir(), "gander-rename-worktree-"));
    rmSync(linked, { recursive: true });
    await fixture.git(["worktree", "add", "-b", "rename-local", linked, "main"]);
    await fixture.git(["-C", linked, "mv", "unchanged.txt", "renamed.txt"]);

    try {
      const view = await engine.localView(linked);
      expect(view.files).toContainEqual(expect.objectContaining({
        path: "renamed.txt",
        basePath: "unchanged.txt",
        status: "R",
        baseContent: "same\n",
        headContent: "same\n",
      }));
    } finally {
      await fixture.git(["worktree", "remove", "--force", linked]);
      await fixture.git(["branch", "-D", "rename-local"]);
    }
  });

  it("shows a real file-to-symlink type change as a modification without following it", async () => {
    const mainSha = await fixture.git(["rev-parse", "refs/heads/main"]);
    await fixture.git(["update-ref", "refs/remotes/origin/main", mainSha]);
    await fixture.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const linked = mkdtempSync(join(tmpdir(), "gander-type-worktree-"));
    rmSync(linked, { recursive: true });
    await fixture.git(["worktree", "add", "-b", "type-local", linked, "main"]);
    rmSync(join(linked, "unchanged.txt"));
    symlinkSync("a.rb", join(linked, "unchanged.txt"));

    try {
      expect((await engine.localView(linked)).files).toContainEqual(expect.objectContaining({
        path: "unchanged.txt",
        status: "M",
        headContent: "a.rb",
      }));
    } finally {
      await fixture.git(["worktree", "remove", "--force", linked]);
      await fixture.git(["branch", "-D", "type-local"]);
    }
  });
});
