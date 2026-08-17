import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitEngine, type GitEngine } from "./git.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";

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
      { path: "a.rb", status: "M" },
      { path: "b.rb", status: "A" },
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
    expect(files).toContainEqual({ path: "renamed.txt", status: "R" });
    expect(files.some((f) => f.path === "unchanged.txt")).toBe(false);
  });
});
