import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resolveServiceConnection, saveConfig } from "./config.js";

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

  describe("resolveServiceConnection", () => {
    const saved = { url: process.env.GANDER_SERVICE_URL, token: process.env.GANDER_TOKEN };
    afterEach(() => {
      if (saved.url === undefined) delete process.env.GANDER_SERVICE_URL; else process.env.GANDER_SERVICE_URL = saved.url;
      if (saved.token === undefined) delete process.env.GANDER_TOKEN; else process.env.GANDER_TOKEN = saved.token;
    });

    const fileCfg = { serviceUrl: "http://from-file:8390", serviceToken: "file-token", repos: [] };

    it("falls back to the config file when the env is unset", () => {
      delete process.env.GANDER_SERVICE_URL;
      delete process.env.GANDER_TOKEN;
      expect(resolveServiceConnection(fileCfg)).toEqual({ url: "http://from-file:8390", token: "file-token" });
    });

    it("prefers the env, which the dev stack allocates per worktree", () => {
      process.env.GANDER_SERVICE_URL = "http://127.0.0.1:24917";
      process.env.GANDER_TOKEN = "generated-by-bin-setup";
      expect(resolveServiceConnection(fileCfg)).toEqual({ url: "http://127.0.0.1:24917", token: "generated-by-bin-setup" });
    });

    it("leaves the config object alone, so saveConfig cannot persist a machine-specific port", () => {
      process.env.GANDER_SERVICE_URL = "http://127.0.0.1:24917";
      process.env.GANDER_TOKEN = "generated-by-bin-setup";
      const cfg = { ...fileCfg };
      resolveServiceConnection(cfg);
      saveConfig(cfg, cfgPath);
      const raw = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
      expect(raw["serviceUrl"]).toBe("http://from-file:8390");
      expect(raw["serviceToken"]).toBe("file-token");
    });
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
