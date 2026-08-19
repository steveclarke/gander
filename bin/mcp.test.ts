import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let configFile: string;
let env: NodeJS.ProcessEnv;

type CommandResult = { status: number | null; output: string };

function run(...args: string[]): CommandResult {
  const result = spawnSync(join(repo, "bin/mcp"), args, {
    cwd: join(repo, "nested/directory"), env, encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "gander-mcp-cli-test-"));
  repo = join(tmpRoot, "gander");
  fakeBin = join(tmpRoot, "bin");
  argsFile = join(tmpRoot, "args");
  envFile = join(tmpRoot, "inspector-env");
  configFile = join(tmpRoot, "inspector-config");

  mkdirSync(join(repo, "bin"), { recursive: true });
  mkdirSync(join(repo, "nested/directory"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(join(appRoot, "bin/mcp"), join(repo, "bin/mcp"));
  chmodSync(join(repo, "bin/mcp"), 0o755);

  writeFileSync(join(repo, ".env"), [
    "GANDER_SERVICE_URL=http://127.0.0.1:4321",
    "GANDER_TOKEN=test-token",
    "MCP_INSPECTOR_CLIENT_PORT=6101",
    "MCP_INSPECTOR_SANDBOX_PORT=6102",
    "",
  ].join("\n"));

  writeExecutable(join(fakeBin, "curl"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(fakeBin, "pnpm"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$MCP_TEST_ARGS_FILE"
prior=""
for arg in "$@"; do
  if [[ "$prior" == "--config" ]]; then
    cp "$arg" "$MCP_TEST_CONFIG_FILE"
    break
  fi
  prior="$arg"
done
printf 'CLIENT_PORT=%s\nMCP_SANDBOX_PORT=%s\nHOST=%s\n' \
  "\${CLIENT_PORT:-}" "\${MCP_SANDBOX_PORT:-}" "\${HOST:-}" > "$MCP_TEST_ENV_FILE"
if [[ " $* " == *" --format json "* ]]; then
  if [[ -n "\${MCP_TEST_TOOLS_RESPONSE:-}" ]]; then
    printf '%s\n' "$MCP_TEST_TOOLS_RESPONSE"
  else
    printf '%s\n' '{"result":{"tools":[{"name":"mark_question_addressed"},{"name":"get_review_questions"}]}}'
  fi
else
  printf '%s\n' '{"ok":true}'
fi
`);

  env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    MCP_TEST_ARGS_FILE: argsFile,
    MCP_TEST_ENV_FILE: envFile,
    MCP_TEST_CONFIG_FILE: configFile,
  };
});

afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe.skipIf(platform === "win32")("bin/mcp", () => {
  it("checks the worktree endpoint and required tool contract", () => {
    const result = run("check");

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("MCP OK");
    expect(result.output).toContain("get_review_questions, mark_question_addressed");
    expect(result.output).not.toContain("test-token");

    const args = readFileSync(argsFile, "utf8");
    expect(args).toMatch(/^exec\nmcp-inspector\n/);
    expect(args).toContain("--config");
    expect(args).not.toContain("test-token");
    expect(args).toContain("tools/list");
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual({
      mcpServers: {
        gander: {
          type: "streamable-http",
          url: "http://127.0.0.1:4321/mcp",
          headers: { Authorization: "Bearer test-token" },
          protocolEra: "modern",
        },
      },
    });
  });

  it("passes tool calls through the Inspector CLI", () => {
    const result = run("call", "get_review_questions", "repo=steveclarke/gander", "branch=feature/test");

    expect(result.status, result.output).toBe(0);
    const args = readFileSync(argsFile, "utf8");
    expect(args).toContain("tools/call");
    expect(args).toContain("get_review_questions");
    expect(args).toContain("repo=steveclarke/gander");
    expect(args).toContain("branch=feature/test");
  });

  it("fails when a core MCP tool is missing", () => {
    env = {
      ...env,
      MCP_TEST_TOOLS_RESPONSE: '{"result":{"tools":[{"name":"get_review_questions"}]}}',
    };

    const result = run("check");

    expect(result.status).toBe(1);
    expect(result.output).toContain("Missing core MCP tools: mark_question_addressed");
    expect(result.output).toContain("tool contract is invalid");
  });

  it("gives each web Inspector the worktree's allocated ports", () => {
    const result = run("inspect");

    expect(result.status, result.output).toBe(0);
    expect(readFileSync(argsFile, "utf8")).toContain("--web");
    expect(readFileSync(envFile, "utf8")).toBe([
      "CLIENT_PORT=6101",
      "MCP_SANDBOX_PORT=6102",
      "HOST=127.0.0.1",
      "",
    ].join("\n"));
  });

  it("fails plainly when the worktree has not been set up", () => {
    rmSync(join(repo, ".env"));
    const result = run("check");

    expect(result.status).toBe(1);
    expect(result.output).toContain("Run bin/setup first");
  });
});
