import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Codex session hook", () => {
  it("records the main Codex session id without letting a child replace it", () => {
    const directory = mkdtempSync(join(tmpdir(), "gander-codex-hook-"));
    directories.push(directory);
    const outputPath = join(directory, "session-id");
    const result = spawnSync(
      "pnpm",
      ["--silent", "--filter", "@gander/app", "exec", "tsx", resolve("packages/app/src/main/agent-session-hook.ts")],
      {
        cwd: resolve("."),
        env: { ...process.env, GANDER_CODEX_SESSION_FILE: outputPath },
        input: JSON.stringify({
          session_id: "01a017aa-4047-7040-bed9-576465989960",
          hook_event_name: "SessionStart",
          source: "startup",
          cwd: resolve("."),
        }),
        encoding: "utf8",
      },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const childResult = spawnSync(
      "pnpm",
      ["--silent", "--filter", "@gander/app", "exec", "tsx", resolve("packages/app/src/main/agent-session-hook.ts")],
      {
        cwd: resolve("."),
        env: { ...process.env, GANDER_CODEX_SESSION_FILE: outputPath },
        input: JSON.stringify({
          session_id: "01a017af-d9f9-7072-9660-5d1a60926d82",
          hook_event_name: "SessionStart",
          source: "startup",
          cwd: resolve("."),
        }),
        encoding: "utf8",
      },
    );

    expect(childResult.stderr).toBe("");
    expect(childResult.status).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe("01a017aa-4047-7040-bed9-576465989960\n");
  });
});
