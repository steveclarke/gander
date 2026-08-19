import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../packages/app/src/main/config.js";
import { DEFAULT_APP_SETTINGS } from "../packages/app/src/settings.js";

const command = join(dirname(fileURLToPath(import.meta.url)), "fix-config");
let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gander-fix-config-"));
  configPath = join(dir, "config.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(): ReturnType<typeof spawnSync> {
  return spawnSync(command, [configPath], { encoding: "utf8" });
}

describe("bin/fix-config", () => {
  it("removes stale keys and writes a config the app can load", () => {
    writeFileSync(configPath, JSON.stringify({
      serviceUrl: "http://localhost:8390",
      serviceToken: "token",
      settings: DEFAULT_APP_SETTINGS,
      repos: [],
      zoomLevel: 2,
    }));

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(loadConfig(configPath).serviceUrl).toBe("http://localhost:8390");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).not.toHaveProperty("zoomLevel");
    expect(existsSync(`${configPath}.bak`)).toBe(true);
  });

  it("does not replace the file when non-settings values remain invalid", () => {
    const original = JSON.stringify({
      serviceUrl: "not a URL",
      serviceToken: "token",
      settings: DEFAULT_APP_SETTINGS,
      repos: [{ repoId: "not-a-repo", url: "https://example.test" }],
    });
    writeFileSync(configPath, original);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/serviceUrl|repoId/);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(existsSync(`${configPath}.bak`)).toBe(false);
  });
});
