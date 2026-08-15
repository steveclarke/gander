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

  it("showFile returns content for existing paths and null for absent ones", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    expect(await engine.showFile(clone, head, "b.rb")).toBe("class B\nend\n");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    expect(await engine.showFile(clone, base, "b.rb")).toBeNull();
  });
});
