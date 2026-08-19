import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const appRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gander-repair-"));
  mkdirSync(join(root, "bin"), { recursive: true });
  copyFileSync(join(appRoot, "bin/repair-electron"), join(root, "bin/repair-electron"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bin/repair-electron", () => {
  // The service image installs `--filter @gander/service...`, which leaves out the
  // app package entirely while still running the workspace root's postinstall hook.
  // Failing there broke `docker compose up --build` and so every deployment.
  it("succeeds when the app package was never installed", () => {
    const result = spawnSync(join(root, "bin/repair-electron"), [], { encoding: "utf8" });

    expect(`${result.stdout}${result.stderr}`).toBe("");
    expect(result.status).toBe(0);
  });
});
