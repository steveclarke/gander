import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { platform } from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const appRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

let tmpRoot: string;
let repo: string;
let fakeBin: string;
let argsFile: string;
let envFile: string;
let env: NodeJS.ProcessEnv;

type CommandResult = { status: number | null; output: string };

function run(...args: string[]): CommandResult {
  const result = spawnSync(join(repo, "bin/dev"), args, {
    cwd: join(repo, "nested/directory"), env, encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "gander-dev-cli-test-"));
  repo = join(tmpRoot, "gander");
  fakeBin = join(tmpRoot, "bin");
  argsFile = join(tmpRoot, "args");
  envFile = join(tmpRoot, "env");

  mkdirSync(join(repo, "bin"), { recursive: true });
  mkdirSync(join(repo, "nested/directory"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(join(appRoot, "bin/dev"), join(repo, "bin/dev"));
  chmodSync(join(repo, "bin/dev"), 0o755);

  writeFileSync(join(repo, ".pc_env"), [
    "GANDER_PORT=4321",
    "GANDER_SERVICE_URL=http://127.0.0.1:4321",
    "GANDER_TOKEN=checkout-token",
    "GANDER_APP_SOCKET=/tmp/gander-app-gander-test.sock",
    "PC_SOCKET_PATH=/tmp/process-compose-gander-test.sock",
    "",
  ].join("\n"));

  writeExecutable(join(fakeBin, "process-compose"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$DEV_TEST_ARGS_FILE"
printf 'GANDER_PORT=%s\nGANDER_SERVICE_URL=%s\nGANDER_TOKEN=%s\nGANDER_APP_SOCKET=%s\nPC_SOCKET_PATH=%s\n' \
  "\${GANDER_PORT:-}" "\${GANDER_SERVICE_URL:-}" "\${GANDER_TOKEN:-}" \
  "\${GANDER_APP_SOCKET:-}" "\${PC_SOCKET_PATH:-}" > "$DEV_TEST_ENV_FILE"

case "\${DEV_TEST_MODE:-success}" in
  success)
    if [[ " $* " == *" --output json "* ]]; then
      printf '%s\n' '[{"name":"service","status":"Running"}]'
    else
      printf '%s\n' 'PID NAME STATUS' '123 service Running'
    fi
    ;;
  empty) exit 0 ;;
  error)
    printf '%s\n' 'dial unix: connection refused' >&2
    exit 7
    ;;
esac
`);

  env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    DEV_TEST_ARGS_FILE: argsFile,
    DEV_TEST_ENV_FILE: envFile,
    GANDER_PORT: "",
    PC_SOCKET_PATH: "",
  };
});

afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe.skipIf(platform === "win32")("bin/dev", () => {
  it("starts the dev stack from the process-compose config when Docker Compose is also present", () => {
    writeFileSync(join(repo, "compose.yml"), "services:\n  gander:\n    image: gander\n");
    writeFileSync(join(repo, "process-compose.yml"), "processes:\n  service:\n    command: true\n");

    const result = run();

    expect(result.status, result.output).toBe(0);
    expect(readFileSync(argsFile, "utf8")).toBe([
      "up",
      "--config",
      join(realpathSync(repo), "process-compose.yml"),
      "",
    ].join("\n"));
  });

  it("starts only the app against the hosted connection saved in the worktree config", () => {
    env = {
      ...env,
      GANDER_SERVICE_URL: "https://caller.example.test",
      GANDER_TOKEN: "caller-token",
    };

    const result = run("--hosted", "-D");

    expect(result.status, result.output).toBe(0);
    expect(readFileSync(argsFile, "utf8")).toBe([
      "up",
      "--config",
      join(realpathSync(repo), "process-compose.yml"),
      "--disable-dotenv",
      "--no-deps",
      "-D",
      "app",
      "",
    ].join("\n"));
    expect(readFileSync(envFile, "utf8")).toBe([
      "GANDER_PORT=4321",
      "GANDER_SERVICE_URL=",
      "GANDER_TOKEN=",
      "GANDER_APP_SOCKET=/tmp/gander-app-gander-test.sock",
      "PC_SOCKET_PATH=/tmp/process-compose-gander-test.sock",
      "",
    ].join("\n"));
  });

  it("keeps ordinary startup on the generated worktree service connection", () => {
    env = {
      ...env,
      GANDER_SERVICE_URL: "https://caller.example.test",
      GANDER_TOKEN: "caller-token",
    };

    const result = run("-D");

    expect(result.status, result.output).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain([
      "GANDER_SERVICE_URL=http://127.0.0.1:4321",
      "GANDER_TOKEN=checkout-token",
    ].join("\n"));
  });

  it("loads the worktree environment and returns JSON status", () => {
    const result = run("status", "--json");

    expect(result.status, result.output).toBe(0);
    expect(JSON.parse(result.output)).toEqual([{ name: "service", status: "Running" }]);
    expect(readFileSync(argsFile, "utf8")).toBe("process\nlist\n--output\njson\n");
    expect(readFileSync(envFile, "utf8")).toBe([
      "GANDER_PORT=4321",
      "GANDER_SERVICE_URL=http://127.0.0.1:4321",
      "GANDER_TOKEN=checkout-token",
      "GANDER_APP_SOCKET=/tmp/gander-app-gander-test.sock",
      "PC_SOCKET_PATH=/tmp/process-compose-gander-test.sock",
      "",
    ].join("\n"));
  });

  it("returns the human-readable status by default", () => {
    const result = run("status");

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("123 service Running");
    expect(readFileSync(argsFile, "utf8")).toBe("process\nlist\n--output\nwide\n");
  });

  it("preserves process-compose connection errors", () => {
    env = { ...env, DEV_TEST_MODE: "error" };

    const result = run("status", "--json");

    expect(result.status).toBe(1);
    expect(result.output).toContain("dial unix: connection refused");
    expect(result.output).toContain("Dev environment is not running or could not be reached");
  });

  it("rejects an empty successful status response", () => {
    env = { ...env, DEV_TEST_MODE: "empty" };

    const result = run("status", "--json");

    expect(result.status).toBe(1);
    expect(result.output).toContain("process-compose returned no process status");
  });

  it("requires setup before contacting process-compose", () => {
    unlinkSync(join(repo, ".pc_env"));

    const result = run("status", "--json");

    expect(result.status).toBe(1);
    expect(result.output).toContain("Run bin/setup first");
  });

  it("refuses to use process-compose without a worktree socket", () => {
    writeFileSync(join(repo, ".pc_env"), "GANDER_PORT=4321\n");

    const result = run("status", "--json");

    expect(result.status).toBe(1);
    expect(result.output).toContain("PC_SOCKET_PATH is missing");
    expect(existsSync(argsFile)).toBe(false);
  });
});
