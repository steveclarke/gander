import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitEngine } from "./git.js";
import { makeFixtureRepo } from "./fixtures.js";
import { repositoryFromLocalPath } from "./repository-registration.js";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function repositoryFixture(repoId: string) {
  const fixture = await makeFixtureRepo();
  paths.push(fixture.dir);
  await fixture.git(["remote", "add", "origin", `https://github.com/${repoId}.git`]);
  const clones = mkdtempSync(join(tmpdir(), "gander-registration-clones-"));
  paths.push(clones);
  return { fixture, git: createGitEngine(clones) };
}

describe("local repository registration", () => {
  it("derives repository identity and its checkout root from a real Git repository", async () => {
    const { fixture, git } = await repositoryFixture("acme/atlas");
    const nested = join(fixture.dir, "nested", "directory");
    mkdirSync(nested, { recursive: true });

    await expect(repositoryFromLocalPath(git, nested)).resolves.toEqual({
      repoId: "acme/atlas",
      url: "https://github.com/acme/atlas.git",
      localPath: realpathSync(fixture.dir),
    });
  });

  it("does not relocate a repository to a checkout belonging to another origin", async () => {
    const { fixture, git } = await repositoryFixture("acme/beacon");

    await expect(repositoryFromLocalPath(git, fixture.dir, "acme/atlas"))
      .rejects.toThrow("That folder belongs to acme/beacon, not acme/atlas");
  });
});
