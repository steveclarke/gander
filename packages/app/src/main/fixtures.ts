import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface FixtureRepo { dir: string; git(args: string[]): Promise<string>; }

/** Real repo: main (a.rb, unchanged.txt), feature branch editing a.rb + adding b.rb, refs/pull/1/head -> feature. */
type FixtureContent = string | Uint8Array;

export async function makeFixtureRepo(
  featureFiles: Record<string, FixtureContent> = {},
  baseFiles: Record<string, FixtureContent> = {},
): Promise<FixtureRepo> {
  const dir = mkdtempSync(join(tmpdir(), "gander-fixture-"));
  const git = async (args: string[]): Promise<string> =>
    (await run("git", ["-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })).stdout.trim();

  await git(["init", "-b", "main"]);
  writeFileSync(join(dir, "a.rb"), "class A\nend\n");
  writeFileSync(join(dir, "unchanged.txt"), "same\n");
  for (const [path, content] of Object.entries(baseFiles)) {
    const destination = join(dir, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  await git(["add", "-A"]); await git(["commit", "-m", "initial"]);
  await git(["checkout", "-b", "feature"]);
  writeFileSync(join(dir, "a.rb"), "class A\n  def go; end\nend\n");
  writeFileSync(join(dir, "b.rb"), "class B\nend\n");
  for (const [path, content] of Object.entries(featureFiles)) {
    const destination = join(dir, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  await git(["add", "-A"]); await git(["commit", "-m", "feature work"]);
  const headSha = await git(["rev-parse", "HEAD"]);
  await git(["update-ref", "refs/pull/1/head", headSha]);
  await git(["checkout", "main"]);
  return { dir, git };
}
