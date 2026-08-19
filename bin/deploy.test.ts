import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const command = join(dirname(fileURLToPath(import.meta.url)), "deploy");
let dir: string;
let remote: string;
let fakeBin: string;
let curlLog: string;
let dockerLog: string;

function executable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gander-deploy-"));
  remote = join(dir, "remote");
  fakeBin = join(dir, "bin");
  curlLog = join(dir, "curl.log");
  dockerLog = join(dir, "docker.log");
  execFileSync("mkdir", ["-p", join(remote, "packages/shared/src"), fakeBin]);
  writeFileSync(join(remote, "packages/shared/src/index.ts"), 'export const SERVICE_VERSION = "0.1.0";\n');
  execFileSync("git", ["init", "-q"], { cwd: remote });
  execFileSync("git", ["add", "."], { cwd: remote });
  execFileSync("git", ["-c", "user.name=Gander Test", "-c", "user.email=test@example.test", "commit", "-qm", "release"], { cwd: remote });
  execFileSync("git", ["tag", "v0.1.0"], { cwd: remote });

  executable(join(fakeBin, "ssh"), "#!/usr/bin/env bash\nset -euo pipefail\nshift\nexec \"$@\"\n");
  executable(join(fakeBin, "docker"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$1 $2" == "compose port" ]]; then printf '0.0.0.0:%s\\n' "$FAKE_PORT"; fi
`);
  executable(join(fakeBin, "curl"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\${@: -1}" >> "$FAKE_CURL_LOG"
printf '{"ok":true,"version":"%s"}\\n' "$FAKE_SERVICE_VERSION"
`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function deploy(): ReturnType<typeof spawnSync> {
  return spawnSync(command, ["--ref", "v0.1.0"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      GANDER_DEPLOY_HOST: "local-test",
      GANDER_DEPLOY_PATH: remote,
      FAKE_CURL_LOG: curlLog,
      FAKE_DOCKER_LOG: dockerLog,
      FAKE_PORT: "19420",
      FAKE_SERVICE_VERSION: "0.1.0",
    },
  });
}

describe("bin/deploy", () => {
  it("verifies a tag against its own version on its actual published port", () => {
    const result = deploy();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Serving contract version 0.1.0");
    expect(readFileSync(curlLog, "utf8")).toContain("http://127.0.0.1:19420/healthz");
  });

  it("refuses to build a remote checkout with local changes", () => {
    writeFileSync(join(remote, "packages/shared/src/index.ts"), 'export const SERVICE_VERSION = "changed";\n');

    const result = deploy();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to deploy from a checkout with local changes");
    expect(existsSync(dockerLog)).toBe(false);
  });
});
