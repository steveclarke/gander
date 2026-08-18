import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { linkedWorktreeLabel } from "./development-context.js";

let fixture: FixtureRepo;
const linkedWorktrees: string[] = [];
const containers: string[] = [];

beforeEach(async () => {
  fixture = await makeFixtureRepo();
});

afterEach(async () => {
  for (const worktree of linkedWorktrees.splice(0)) {
    await fixture.git(["worktree", "remove", "--force", worktree]);
  }
  for (const container of containers.splice(0)) rmSync(container, { recursive: true, force: true });
  rmSync(fixture.dir, { recursive: true, force: true });
});

async function addWorktree(args: string[]): Promise<string> {
  const container = mkdtempSync(join(tmpdir(), "gander-linked-worktree-"));
  const worktree = join(container, "checkout");
  containers.push(container);
  await fixture.git(["worktree", "add", ...args, worktree]);
  linkedWorktrees.push(worktree);
  return worktree;
}

describe("development worktree context", () => {
  it("omits a label for the main working tree", async () => {
    expect(await linkedWorktreeLabel(fixture.dir)).toBeNull();
  });

  it("labels a linked worktree with its branch", async () => {
    const worktree = await addWorktree(["-b", "review-status"]);

    expect(await linkedWorktreeLabel(worktree)).toBe("review-status");
  });

  it("uses the worktree directory when HEAD is detached", async () => {
    const worktree = await addWorktree(["--detach"]);

    expect(await linkedWorktreeLabel(worktree)).toBe(basename(worktree));
  });
});
