import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrSummary } from "@gander/shared";
import { buildServer } from "../../../service/src/server.js";
import { openStorage, type Storage } from "../../../service/src/storage.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { createGitEngine, type GitEngine } from "./git.js";
import { createServiceClient } from "./service-client.js";
import { createReviewer, type Reviewer } from "./review.js";

let fixture: FixtureRepo; let clonesRoot: string; let dbDir: string;
let storage: Storage; let server: FastifyInstance; let reviewer: Reviewer; let port: number;

async function currentPr(fx: FixtureRepo): Promise<PrSummary> {
  const headSha = await fx.git(["rev-parse", "refs/pull/1/head"]);
  const baseSha = await fx.git(["rev-parse", "main"]);
  return { number: 1, title: "Feature", body: "", draft: false, baseRef: "main", baseSha, headRef: "feature", stack: null, headSha };
}

beforeEach(async () => {
  fixture = await makeFixtureRepo();
  clonesRoot = mkdtempSync(join(tmpdir(), "gander-clones-"));
  dbDir = mkdtempSync(join(tmpdir(), "gander-db-"));
  storage = openStorage(join(dbDir, "t.db"));
  server = buildServer({ storage, token: "t", version: "test" });
  await server.listen({ port: 0, host: "127.0.0.1" });
  port = (server.addresses()[0] as { port: number }).port;

  reviewer = createReviewer({
    git: createGitEngine(clonesRoot),
    service: createServiceClient(() => ({ url: `http://127.0.0.1:${port}`, token: "t" })),
    listPrs: async () => [await currentPr(fixture)],
    repoUrl: () => fixture.dir,
    machine: "test-machine",
  });
});
afterEach(async () => {
  await server.close(); storage.close();
  for (const d of [fixture.dir, clonesRoot, dbDir]) rmSync(d, { recursive: true, force: true });
});

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("review pipeline", () => {
  it("openPr returns the PR's files with contents and unchecked state", async () => {
    const view = await reviewer.openPr("acme/atlas", 1);
    expect(view.pr.number).toBe(1);
    expect(view.files.map((f) => [f.path, f.status])).toEqual([["a.rb", "M"], ["b.rb", "A"]]);
    const a = view.files[0]!;
    expect(a.baseContent).toBe("class A\nend\n");
    expect(a.headContent).toBe("class A\n  def go; end\nend\n");
    expect(a.headHash).toBe(sha256(a.headContent!));
    expect(a.checked).toBe(false);
    expect(a.changedSince).toBe(false);
  });

  it("setChecked persists through the service and survives re-open", async () => {
    await reviewer.openPr("acme/atlas", 1);
    const view = await reviewer.setChecked("acme/atlas", 1, "a.rb", true);
    expect(view.files.find((f) => f.path === "a.rb")!.checked).toBe(true);

    const reopened = await reviewer.openPr("acme/atlas", 1);
    expect(reopened.files.find((f) => f.path === "a.rb")!.checked).toBe(true);
  });

  it("adds a reviewer reply through the real service and keeps it on reopen", async () => {
    await reviewer.openPr("acme/atlas", 1);
    const withQuestion = await reviewer.addQuestion("acme/atlas", 1, { path: "a.rb", line: 2, text: "Why?" });
    const id = withQuestion.questions[0]!.id;

    const replied = await reviewer.addReviewerReply("acme/atlas", 1, id, "Because the caller retries.");
    expect(replied.questions[0]).toMatchObject({
      state: "open", replies: [{ author: "reviewer", text: "Because the caller retries." }],
    });
    expect((await reviewer.openPr("acme/atlas", 1)).questions[0]?.replies).toHaveLength(1);
  });

  it("setCheckedMany checks a batch from the cached view and persists it", async () => {
    await reviewer.openPr("acme/atlas", 1);
    const view = await reviewer.setCheckedMany("acme/atlas", 1, ["a.rb", "b.rb"], true);
    expect(view.files.every((f) => f.checked)).toBe(true);
    const reopened = await reviewer.openPr("acme/atlas", 1);
    expect(reopened.files.every((f) => f.checked)).toBe(true);
  });

  it("setChecked throws if the PR was never opened", async () => {
    await expect(reviewer.setChecked("acme/atlas", 1, "a.rb", true)).rejects.toThrow(/opened before/i);
  });

  it("content change after checkoff un-checks with changedSince — and identical content survives history rewrites", async () => {
    await reviewer.openPr("acme/atlas", 1);
    await reviewer.setChecked("acme/atlas", 1, "a.rb", true);
    await reviewer.setChecked("acme/atlas", 1, "b.rb", true);

    // Amend the PR: a.rb changes content; b.rb is rewritten into a new commit with identical content.
    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "a.rb"), "class A\n  def go; puts 1; end\nend\n");
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "--amend", "-m", "rewritten feature"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const view = await reviewer.openPr("acme/atlas", 1);
    const a = view.files.find((f) => f.path === "a.rb")!;
    const b = view.files.find((f) => f.path === "b.rb")!;
    expect(a.checked).toBe(false);
    expect(a.changedSince).toBe(true);
    expect(b.checked).toBe(true);        // content identical -> review survives the force-push
    expect(b.changedSince).toBe(false);

    // The un-check was persisted, not just displayed: read storage directly, not
    // just the derived view (which would read false from hash mismatch alone even
    // if the PUT never happened).
    await reviewer.openPr("acme/atlas", 1);
    const stored = storage.getReview("acme/atlas", 1).files.find((f) => f.path === "a.rb")!;
    expect(stored.checked).toBe(false);
  });

  it("changedSince survives a second re-open, after the stored checked flag has already gone false", async () => {
    await reviewer.openPr("acme/atlas", 1);
    await reviewer.setChecked("acme/atlas", 1, "a.rb", true);

    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "a.rb"), "class A\n  def go; puts 1; end\nend\n");
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "--amend", "-m", "rewritten feature"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const first = await reviewer.openPr("acme/atlas", 1);
    expect(first.files.find((f) => f.path === "a.rb")!.changedSince).toBe(true);

    // The stored checked flag is now false, per the persisted-uncheck test above —
    // the flag must still be derived from the hash mismatch, not from `checked`.
    const second = await reviewer.openPr("acme/atlas", 1);
    const a = second.files.find((f) => f.path === "a.rb")!;
    expect(a.checked).toBe(false);
    expect(a.changedSince).toBe(true);
  });

  it("re-checking a changed file clears changedSince and persists the new snapshot", async () => {
    await reviewer.openPr("acme/atlas", 1);
    await reviewer.setChecked("acme/atlas", 1, "a.rb", true);

    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "a.rb"), "class A\n  def go; puts 1; end\nend\n");
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "--amend", "-m", "rewritten feature"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    await reviewer.openPr("acme/atlas", 1);
    const reChecked = await reviewer.setChecked("acme/atlas", 1, "a.rb", true);
    const a = reChecked.files.find((f) => f.path === "a.rb")!;
    expect(a.checked).toBe(true);
    expect(a.changedSince).toBe(false);

    const reopened = await reviewer.openPr("acme/atlas", 1);
    const aReopened = reopened.files.find((f) => f.path === "a.rb")!;
    expect(aReopened.checked).toBe(true);
    expect(aReopened.changedSince).toBe(false);
  });

  it("refreshPr re-reads no blobs when the head is unchanged, and fully recomputes once it moves", async () => {
    let showFileCalls = 0;
    const baseEngine = createGitEngine(clonesRoot);
    const countingEngine: GitEngine = {
      ...baseEngine,
      async showFile(clone, rev, path) {
        showFileCalls += 1;
        return baseEngine.showFile(clone, rev, path);
      },
    };
    const instrumented = createReviewer({
      git: countingEngine,
      service: createServiceClient(() => ({ url: `http://127.0.0.1:${port}`, token: "t" })),
      listPrs: async () => [await currentPr(fixture)],
      repoUrl: () => fixture.dir,
      machine: "test-machine",
    });

    await instrumented.openPr("acme/atlas", 1);
    const afterOpen = showFileCalls;
    expect(afterOpen).toBeGreaterThan(0);

    // Head hasn't moved: refreshPr must not spawn a single `git show`.
    const unchanged = await instrumented.refreshPr("acme/atlas", 1);
    expect(showFileCalls).toBe(afterOpen);
    expect(unchanged.files.map((f) => f.path)).toEqual(["a.rb", "b.rb"]);

    // Cross-machine sync must still work on the no-blob-read path: a checkoff made
    // "elsewhere" (a direct service call, standing in for another machine) shows up.
    await instrumented.setChecked("acme/atlas", 1, "a.rb", true);
    const afterCheck = await instrumented.refreshPr("acme/atlas", 1);
    expect(showFileCalls).toBe(afterOpen); // still no new blob reads
    expect(afterCheck.files.find((f) => f.path === "a.rb")!.checked).toBe(true);

    // Now genuinely move the PR head — refreshPr must recompute fully.
    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "a.rb"), "class A\n  def go; puts 2; end\nend\n");
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "-m", "advance the PR"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const moved = await instrumented.refreshPr("acme/atlas", 1);
    expect(showFileCalls).toBeGreaterThan(afterOpen);
    expect(moved.files.find((f) => f.path === "a.rb")!.changedSince).toBe(true);
  });

  it("previews modified, added, and deleted images without persisting binary snapshots", async () => {
    await server.close(); storage.close();
    rmSync(fixture.dir, { recursive: true, force: true });
    const basePng = readFileSync(join(import.meta.dirname, "../../resources/icon.png"));
    const headPng = readFileSync(join(import.meta.dirname, "../../resources/icon-dev.png"));
    fixture = await makeFixtureRepo(
      { "modified.png": headPng, "added.png": headPng },
      { "modified.png": basePng, "deleted.png": basePng },
    );
    await fixture.git(["checkout", "feature"]);
    await fixture.git(["rm", "deleted.png"]);
    await fixture.git(["commit", "--amend", "--no-edit"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    storage = openStorage(join(dbDir, "images.db"));
    server = buildServer({ storage, token: "t", version: "test" });
    await server.listen({ port: 0, host: "127.0.0.1" });
    port = (server.addresses()[0] as { port: number }).port;
    reviewer = createReviewer({
      git: createGitEngine(clonesRoot),
      service: createServiceClient(() => ({ url: `http://127.0.0.1:${port}`, token: "t" })),
      listPrs: async () => [await currentPr(fixture)],
      repoUrl: () => fixture.dir,
      machine: "test-machine",
    });

    const view = await reviewer.openPr("acme/atlas", 1);
    expect(view.files.find((file) => file.path === "modified.png")).toMatchObject({
      status: "M", baseContent: null, headContent: null,
    });
    await expect(reviewer.imagePreview("acme/atlas", 1, "modified.png")).resolves.toMatchObject({
      base: { kind: "image", mediaType: "image/png" },
      head: { kind: "image", mediaType: "image/png" },
    });
    await expect(reviewer.imagePreview("acme/atlas", 1, "added.png")).resolves.toMatchObject({
      base: { kind: "absent" }, head: { kind: "image" },
    });
    await expect(reviewer.imagePreview("acme/atlas", 1, "deleted.png")).resolves.toMatchObject({
      base: { kind: "image" }, head: { kind: "absent" },
    });

    await reviewer.setChecked("acme/atlas", 1, "modified.png", true);
    expect(storage.getSnapshot("acme/atlas", 1, "modified.png")).toMatchObject({
      baseContent: null, headContent: null,
    });
  });
});
