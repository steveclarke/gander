import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitEngine } from "./git.js";
import { makeFixtureRepo } from "./fixtures.js";
import { registerFromCheckout, repositoryFromLocalPath } from "./repository-registration.js";
import type { RepoEntry } from "@gander/shared";

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

  // bin/gander runs inside a checkout, so asking it to open a pull request should not
  // require the reviewer to click through a folder dialog first.
  it("registers an unseen repository from the checkout the request came from", async () => {
    const { fixture, git } = await repositoryFixture("acme/atlas");
    const repos: RepoEntry[] = [];

    const added = await registerFromCheckout(git, repos, "acme/atlas", fixture.dir);

    expect(added).toEqual({ repoId: "acme/atlas", url: "https://github.com/acme/atlas.git", localPath: realpathSync(fixture.dir) });
    expect(repos).toHaveLength(1);
  });

  it("leaves an already registered repository alone", async () => {
    const { fixture, git } = await repositoryFixture("acme/atlas");
    const repos: RepoEntry[] = [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas.git", localPath: "/elsewhere" }];

    await expect(registerFromCheckout(git, repos, "acme/atlas", fixture.dir)).resolves.toBeNull();
    expect(repos[0]!.localPath).toBe("/elsewhere");
  });

  it("refuses a checkout that belongs to another repository", async () => {
    const { fixture, git } = await repositoryFixture("acme/beacon");

    await expect(registerFromCheckout(git, [], "acme/atlas", fixture.dir))
      .rejects.toThrow("That folder belongs to acme/beacon, not acme/atlas");
  });

  it("still asks for a folder when the request names no checkout", async () => {
    const { git } = await repositoryFixture("acme/atlas");

    await expect(registerFromCheckout(git, [], "acme/atlas", null))
      .rejects.toThrow("acme/atlas is not registered. Open one of its checkout folders first.");
  });
});
