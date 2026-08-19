import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitEngine, type GitEngine } from "./git.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { watchLocalView, type LocalViewWatcher } from "./local-viewer.js";

let fixture: FixtureRepo;
let engine: GitEngine;
let watcher: LocalViewWatcher | null;

beforeEach(async () => {
  fixture = await makeFixtureRepo();
  const mainSha = await fixture.git(["rev-parse", "refs/heads/main"]);
  await fixture.git(["update-ref", "refs/remotes/origin/main", mainSha]);
  await fixture.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  engine = createGitEngine(mkdtempSync(join(tmpdir(), "gander-watcher-clones-")));
  watcher = null;
});

afterEach(() => {
  watcher?.close();
  rmSync(fixture.dir, { recursive: true, force: true });
});

describe("local view watcher", () => {
  it("recomputes the selected view when a working file changes", async () => {
    const update = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("local view watcher did not update")), 5_000);
      void watchLocalView(engine, fixture.dir, (result) => {
        const content = result.view?.files.find((file) => file.path === "live.txt")?.headContent;
        if (content) {
          clearTimeout(timeout);
          resolve(content);
        }
      }).then((created) => { watcher = created; }, reject);
    });

    // Wait until watcher setup has completed before producing the event under test.
    while (watcher === null) await new Promise((resolve) => setTimeout(resolve, 5));
    writeFileSync(join(fixture.dir, "live.txt"), "visible without refresh\n");

    await expect(update).resolves.toBe("visible without refresh\n");
  });
});
