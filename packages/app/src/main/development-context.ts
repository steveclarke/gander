import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", ["-C", cwd, ...args])).stdout.trim();
}

export async function linkedWorktreeLabel(cwd: string): Promise<string | null> {
  const [gitDir, commonDir] = await Promise.all([
    git(cwd, ["rev-parse", "--absolute-git-dir"]),
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (resolve(gitDir) === resolve(commonDir)) return null;

  const branch = await git(cwd, ["branch", "--show-current"]);
  if (branch !== "") return branch;

  return basename(await git(cwd, ["rev-parse", "--show-toplevel"]));
}
