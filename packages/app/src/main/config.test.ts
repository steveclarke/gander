import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "./config.js";

let dir: string; let cfgPath: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gander-cfg-")); cfgPath = join(dir, "config.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config", () => {
  it("throws a descriptive error when the file is missing", () => {
    expect(() => loadConfig(cfgPath)).toThrow(/config file not found/i);
  });
  it("throws when required keys are absent", () => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://x" }));
    expect(() => loadConfig(cfgPath)).toThrow(/serviceToken/);
  });
  it("round-trips repos through save/load", () => {
    saveConfig({ serviceUrl: "http://h:8390", serviceToken: "t", repos: [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas" }] }, cfgPath);
    const cfg = loadConfig(cfgPath);
    expect(cfg.repos[0]?.repoId).toBe("acme/atlas");
  });

  it("rejects a repoId that isn't owner/repo shaped", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t",
      repos: [{ repoId: "../../etc/passwd", url: "https://github.com/acme/atlas" }],
    }));
    expect(() => loadConfig(cfgPath)).toThrow(/repoId|owner\/repo/i);
  });

  // chmod bits aren't meaningful on Windows.
  (platform === "win32" ? it.skip : it)("writes the config file and its directory with owner-only permissions", () => {
    saveConfig({ serviceUrl: "http://h:8390", serviceToken: "t", repos: [] }, cfgPath);
    expect(statSync(cfgPath).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  (platform === "win32" ? it.skip : it)("repairs permissions on a config file that already existed world-readable", () => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://h:8390", serviceToken: "t", repos: [] }), { mode: 0o644 });
    saveConfig(loadConfig(cfgPath), cfgPath);
    expect(statSync(cfgPath).mode & 0o777).toBe(0o600);
  });

  it("preserves unknown keys across a load -> save round trip", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t", repos: [],
      futureFeatureFlag: "on-by-default-in-a-later-version",
    }));
    const cfg = loadConfig(cfgPath);
    saveConfig(cfg, cfgPath);
    const raw = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    expect(raw["futureFeatureFlag"]).toBe("on-by-default-in-a-later-version");
  });
});
