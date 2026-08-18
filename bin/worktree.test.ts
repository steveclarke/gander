import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { platform } from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const appRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

let tmpRoot: string;
let repo: string;
let worktreeRoot: string;
let fakeBin: string;
let env: NodeJS.ProcessEnv;

type CommandResult = { status: number | null; output: string };

function run(command: string, args: string[], cwd = repo): CommandResult {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runSuccessfully(command: string, args: string[], cwd = repo): CommandResult {
  const result = run(command, args, cwd);
  if (result.status !== 0) throw new Error(result.output);
  return result;
}

function worktree(...args: string[]): CommandResult {
  return run(join(repo, "bin/worktree"), args);
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "gander-worktree-test-"));
  repo = join(tmpRoot, "gander");
  worktreeRoot = join(tmpRoot, "gander-worktrees");
  fakeBin = join(tmpRoot, "bin");

  mkdirSync(join(repo, "bin"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(join(appRoot, "bin/worktree"), join(repo, "bin/worktree"));
  chmodSync(join(repo, "bin/worktree"), 0o755);

  writeExecutable(join(repo, "bin/setup"), `#!/usr/bin/env bash
set -euo pipefail
mkdir -p .gander
printf 'GANDER_PORT=4321\nGANDER_SERVICE_URL=http://127.0.0.1:4321\n' > .env
cp .env .pc_env
printf '{"repos":[]}\n' > .gander/config.json
touch setup-ran
`);
  writeExecutable(join(fakeBin, "outport"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(fakeBin, "pbcopy"), "#!/usr/bin/env bash\ncat >/dev/null\n");
  writeExecutable(join(fakeBin, "gh"), `#!/usr/bin/env bash
case "$1" in
  issue) printf 'Add Color Theme\n' ;;
  pr) printf 'feature/remote-review\n' ;;
  *) exit 1 ;;
esac
`);

  env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    GANDER_WORKTREE_ROOT: worktreeRoot,
  };

  runSuccessfully("git", ["init", "-b", "master"]);
  runSuccessfully("git", ["config", "user.name", "Gander Test"]);
  runSuccessfully("git", ["config", "user.email", "gander@example.com"]);
  writeFileSync(join(repo, ".gitignore"), ".env\n.pc_env\n.gander/\nsetup-ran\n");
  writeFileSync(join(repo, "README.md"), "fake Gander repo\n");
  runSuccessfully("git", ["add", "."]);
  runSuccessfully("git", ["commit", "-m", "initial"]);
});

afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe.skipIf(platform === "win32")("bin/worktree", () => {
  it("creates and bootstraps an isolated worktree", () => {
    const result = worktree("add", "feature/settings");
    expect(result.status, result.output).toBe(0);

    const path = join(worktreeRoot, "feature-settings");
    expect(existsSync(join(path, "setup-ran"))).toBe(true);
    expect(readFileSync(join(path, ".env"), "utf8")).toContain("GANDER_PORT=4321");
    expect(runSuccessfully("git", ["branch", "--show-current"], path).output.trim()).toBe("feature/settings");

    const listed = worktree("list");
    expect(listed.status, listed.output).toBe(0);
    expect(listed.output).toContain("feature/settings");
    expect(listed.output).toContain("Port: 4321");
    expect(realpathSync(worktree("path", "settings").output.trim())).toBe(realpathSync(path));

    const removed = worktree("remove", "feature/settings", "--delete-branch", "--yes");
    expect(removed.status, removed.output).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(run("git", ["show-ref", "--verify", "refs/heads/feature/settings"]).status).not.toBe(0);
  });

  it("can create a worktree without bootstrapping it", () => {
    const result = worktree("add", "scratch", "--init=false");
    expect(result.status, result.output).toBe(0);

    const path = join(worktreeRoot, "scratch");
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(path, "setup-ran"))).toBe(false);

    const removed = worktree("remove", "scratch", "--delete-branch", "--yes");
    expect(removed.status, removed.output).toBe(0);
  });

  it("names a branch from a GitHub issue", () => {
    const result = worktree("add", "--gh", "3", "--init=false");
    expect(result.status, result.output).toBe(0);

    const path = join(worktreeRoot, "3-add-color-theme");
    expect(existsSync(path)).toBe(true);
    expect(runSuccessfully("git", ["branch", "--show-current"], path).output.trim()).toBe("3-add-color-theme");

    const removed = worktree("remove", "3-add-color-theme", "--delete-branch", "--yes");
    expect(removed.status, removed.output).toBe(0);
  });

  it("keeps an unmerged branch unless force deletion is explicit", () => {
    const added = worktree("add", "unmerged", "--init=false");
    expect(added.status, added.output).toBe(0);

    const path = join(worktreeRoot, "unmerged");
    writeFileSync(join(path, "change.txt"), "keep me\n");
    runSuccessfully("git", ["add", "change.txt"], path);
    runSuccessfully("git", ["commit", "-m", "unmerged change"], path);

    const removed = worktree("remove", "unmerged", "--delete-branch", "--yes");
    expect(removed.status).toBe(1);
    expect(removed.output).toContain("unmerged and was kept");
    expect(existsSync(path)).toBe(false);
    expect(run("git", ["show-ref", "--verify", "refs/heads/unmerged"]).status).toBe(0);
  });
});
