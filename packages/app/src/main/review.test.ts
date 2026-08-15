import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrSummary } from "@gander/shared";
import { buildServer } from "../../../service/src/server.js";
import { openStorage, type Storage } from "../../../service/src/storage.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { createGitEngine } from "./git.js";
import { createServiceClient } from "./service-client.js";
import { createReviewer, type Reviewer } from "./review.js";

let fixture: FixtureRepo; let clonesRoot: string; let dbDir: string;
let storage: Storage; let server: FastifyInstance; let reviewer: Reviewer;

async function currentPr(fx: FixtureRepo): Promise<PrSummary> {
  const headSha = await fx.git(["rev-parse", "refs/pull/1/head"]);
  const baseSha = await fx.git(["rev-parse", "main"]);
  return { number: 1, title: "Feature", body: "", draft: false, baseRef: "main", baseSha, headSha };
}

beforeEach(async () => {
  fixture = await makeFixtureRepo();
  clonesRoot = mkdtempSync(join(tmpdir(), "gander-clones-"));
  dbDir = mkdtempSync(join(tmpdir(), "gander-db-"));
  storage = openStorage(join(dbDir, "t.db"));
  server = buildServer({ storage, token: "t", version: "test" });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const port = (server.addresses()[0] as { port: number }).port;

  reviewer = createReviewer({
    git: createGitEngine(clonesRoot),
    service: createServiceClient(`http://127.0.0.1:${port}`, "t"),
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

    // The un-check was persisted, not just displayed:
    const reopened = await reviewer.openPr("acme/atlas", 1);
    expect(reopened.files.find((f) => f.path === "a.rb")!.checked).toBe(false);
  });
});
