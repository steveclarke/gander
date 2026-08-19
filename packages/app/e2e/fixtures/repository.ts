import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/** Rewrites the pull-request head while leaving unchanged files byte-identical. */
export async function amendPullRequest(
  repository: RepositoryFixture,
  files: Record<string, FixtureContent>,
): Promise<void> {
  await repository.checkout.git(["checkout", "feature"]);
  try {
    for (const [path, content] of Object.entries(files)) {
      const destination = join(repository.checkout.dir, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    await repository.checkout.git(["add", "-A"]);
    await repository.checkout.git(["commit", "--amend", "-m", "rewritten feature"]);
    repository.headSha = await repository.checkout.git(["rev-parse", "HEAD"]);
    await repository.checkout.git(["update-ref", `refs/pull/${repository.number}/head`, repository.headSha]);
  } finally {
    await repository.checkout.git(["checkout", "main"]);
  }
}
