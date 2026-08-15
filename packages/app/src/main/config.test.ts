import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
