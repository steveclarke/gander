import { rm } from "node:fs/promises";
import type { FixtureRepo } from "../../src/main/fixtures.js";
import { makeFixtureRepo } from "../../src/main/fixtures.js";

type FixtureContent = string | Uint8Array;

export interface RepositoryFixture {
  repoId: string;
  title: string;
  number: number;
  url: string;
  checkout: FixtureRepo;
  baseSha: string;
  headSha: string;
  worktreePath?: string;
}

export async function createRepositoryFixture(options: {
  repoId: string;
  title?: string;
  featureFiles?: Record<string, FixtureContent>;
  baseFiles?: Record<string, FixtureContent>;
}): Promise<RepositoryFixture> {
  const checkout = await makeFixtureRepo(options.featureFiles, options.baseFiles);
  return {
    repoId: options.repoId,
    title: options.title ?? "Review the fixture change",
    number: 1,
    url: `https://github.com/${options.repoId}.git`,
    checkout,
    baseSha: await checkout.git(["rev-parse", "main"]),
    headSha: await checkout.git(["rev-parse", "refs/pull/1/head"]),
  };
}

export async function removeRepositoryFixture(repository: RepositoryFixture): Promise<void> {
  if (repository.worktreePath) {
    await repository.checkout.git(["worktree", "remove", "--force", repository.worktreePath]);
  }
  await rm(repository.checkout.dir, { recursive: true, force: true });
}
