import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resolveServiceConnection, saveConfig, defaultServerForRepo, unconfigured } from "./config.js";
import { DEFAULT_APP_SETTINGS, DEFAULT_EDITOR_FONT_FAMILY } from "../settings.js";

let dir: string; let cfgPath: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gander-cfg-")); cfgPath = join(dir, "config.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config", () => {
  it("rejects a half-written config", () => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://x" }));
    expect(() => loadConfig(cfgPath)).toThrow(/Invalid config/);
  });
  it("round-trips repos through save/load", () => {
    saveConfig({ servers: [{ id: "default", name: "Review", url: "http://h:8390", token: "t" }], ownerServers: [], settings: DEFAULT_APP_SETTINGS, repos: [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas", localPath: "/tmp/atlas" }] }, cfgPath);
    const cfg = loadConfig(cfgPath);
    expect(cfg.repos[0]?.repoId).toBe("acme/atlas");
    expect(cfg.repos[0]?.localPath).toBe("/tmp/atlas");
  });

  it("rejects a config without current settings", () => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://h:8390", serviceToken: "t", repos: [] }));
    expect(() => loadConfig(cfgPath)).toThrow(/settings/);
  });

  it("persists editor settings across save and load", () => {
    saveConfig({
      servers: [{ id: "default", name: "Review", url: "http://h:8390", token: "t" }], ownerServers: [], repos: [],
      settings: {
        editor: { fontFamily: "'Fira Code', monospace", fontSize: 18.5 },
        window: { zoomLevel: 0.5 },
        workbench: {
          colorTheme: "Gander Dark",
          iconTheme: "catppuccin-mocha",
          tree: { fontFamily: "system-ui", fontSize: 14, inheritEditorTypography: false },
        },
      },
    }, cfgPath);
    expect(loadConfig(cfgPath).settings.editor).toEqual({ fontFamily: "'Fira Code', monospace", fontSize: 18.5 });
    expect(loadConfig(cfgPath).settings.window.zoomLevel).toBe(0.5);
    expect(loadConfig(cfgPath).settings.workbench.colorTheme).toBe("Gander Dark");
    expect(loadConfig(cfgPath).settings.workbench.tree).toEqual({
      fontFamily: "system-ui",
      fontSize: 14,
      inheritEditorTypography: false,
    });
  });

  it("rejects settings without the current workbench fields", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t", repos: [],
      settings: { editor: { fontFamily: "Consolas, monospace", fontSize: 19 } },
    }));
    expect(() => loadConfig(cfgPath)).toThrow(/workbench/);
  });

  it.each([
    { editor: { fontFamily: "", fontSize: 16 } },
    { editor: { fontFamily: DEFAULT_EDITOR_FONT_FAMILY, fontSize: 1000 } },
    { editor: { fontFamily: DEFAULT_EDITOR_FONT_FAMILY } },
    { editor: { fontFamily: DEFAULT_EDITOR_FONT_FAMILY, fontSize: 16 }, workbench: { colorTheme: "Missing Theme" } },
  ])("rejects invalid persisted settings", (settings) => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://h:8390", serviceToken: "t", repos: [], settings }));
    expect(() => loadConfig(cfgPath)).toThrow(/settings/);
  });

  it("rejects a repoId that isn't owner/repo shaped", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t",
      settings: DEFAULT_APP_SETTINGS,
      repos: [{ repoId: "../../etc/passwd", url: "https://github.com/acme/atlas", localPath: "/tmp/atlas" }],
    }));
    expect(() => loadConfig(cfgPath)).toThrow(/repoId|owner\/repo/i);
  });

  it("rejects a URL-only repository registration", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t", settings: DEFAULT_APP_SETTINGS,
      repos: [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas" }],
    }));
    expect(() => loadConfig(cfgPath)).toThrow(/localPath/);
  });

  it("rejects a relative local checkout path", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t", settings: DEFAULT_APP_SETTINGS,
      repos: [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas", localPath: "../atlas" }],
    }));
    expect(() => loadConfig(cfgPath)).toThrow(/localPath|absolute/i);
  });

  // chmod bits aren't meaningful on Windows.
  (platform === "win32" ? it.skip : it)("writes the config file and its directory with owner-only permissions", () => {
    saveConfig({ servers: [{ id: "default", name: "Review", url: "http://h:8390", token: "t" }], ownerServers: [], settings: DEFAULT_APP_SETTINGS, repos: [] }, cfgPath);
    expect(statSync(cfgPath).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  (platform === "win32" ? it.skip : it)("repairs permissions on a config file that already existed world-readable", () => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://h:8390", serviceToken: "t", settings: DEFAULT_APP_SETTINGS, repos: [] }), { mode: 0o644 });
    saveConfig(loadConfig(cfgPath), cfgPath);
    expect(statSync(cfgPath).mode & 0o777).toBe(0o600);
  });

  describe("resolveServiceConnection", () => {
    const saved = { url: process.env.GANDER_SERVICE_URL, token: process.env.GANDER_TOKEN };
    afterEach(() => {
      if (saved.url === undefined) delete process.env.GANDER_SERVICE_URL; else process.env.GANDER_SERVICE_URL = saved.url;
      if (saved.token === undefined) delete process.env.GANDER_TOKEN; else process.env.GANDER_TOKEN = saved.token;
    });

    const fileCfg = { servers: [{ id: "default", name: "Review", url: "http://from-file:8390", token: "file-token" }], ownerServers: [], settings: DEFAULT_APP_SETTINGS, repos: [] };

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
      expect(raw["servers"]).toEqual(fileCfg.servers);
      expect(raw).not.toHaveProperty("serviceUrl");
    });
  });

  it("rejects unknown config keys", () => {
    writeFileSync(cfgPath, JSON.stringify({
      serviceUrl: "http://h:8390", serviceToken: "t", settings: DEFAULT_APP_SETTINGS, repos: [],
      futureFeatureFlag: "on-by-default-in-a-later-version",
    }));
    expect(() => loadConfig(cfgPath)).toThrow(/futureFeatureFlag/);
  });

  it("starts unconfigured when there is no file, and that config survives a save", () => {
    const path = join(dir, "absent", "config.json");
    const first = loadConfig(path);
    expect(first.servers).toEqual([]);
    expect(first.repos).toEqual([]);

    // The app writes the config on ordinary actions — a zoom change, opening a pull
    // request. An unconfigured one has to come back, not fail the next launch.
    first.settings = { ...first.settings, window: { zoomLevel: 1 } };
    saveConfig(first, path);
    const second = loadConfig(path);
    expect(second.settings.window.zoomLevel).toBe(1);
    expect(second.servers).toEqual([]);
  });

  it("still rejects a file that exists and is wrong", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, JSON.stringify({ serviceUrl: "not a url", serviceToken: "t", settings: DEFAULT_APP_SETTINGS, repos: [] }));
    expect(() => loadConfig(path)).toThrow(/Invalid config/);
  });
});

it("silently migrates every repository, preserves credentials and settings, and writes the new shape once", () => {
  const old = {
    serviceUrl: "https://review.example.test/gander", serviceToken: "personal-token", githubToken: "github-token",
    lastReview: { repoId: "acme/atlas", prNumber: 1 }, settings: DEFAULT_APP_SETTINGS,
    repos: ["acme/atlas", "other/atlas"].map((repoId) => ({ repoId, url: `https://github.com/${repoId}`, localPath: "/tmp/atlas" })),
  };
  writeFileSync(cfgPath, JSON.stringify(old));
  const cfg = loadConfig(cfgPath);
  expect(cfg.servers).toEqual([{ id: "default", name: "Review server", url: old.serviceUrl, token: old.serviceToken }]);
  expect(cfg.repos.map((repo) => repo.serverId)).toEqual(["default", "default"]);
  expect(cfg.lastReview).toEqual(old.lastReview);
  expect(cfg.githubToken).toBe(old.githubToken);
  expect(cfg.settings).toEqual(old.settings);
  expect(JSON.parse(readFileSync(cfgPath, "utf8"))).toEqual(cfg);
  expect(loadConfig(cfgPath)).toEqual(cfg);
  expect(statSync(cfgPath).mode & 0o777).toBe(0o600);
});

it("matches owner defaults case-insensitively without changing existing assignments", () => {
  const cfg = { ...unconfigured(), servers: [
    { id: "one", name: "One", url: "https://one.example.test", token: "one" },
    { id: "two", name: "Two", url: "https://two.example.test", token: "two" },
  ], ownerServers: [{ owner: "ACME", serverId: "two" }], repos: [{ repoId: "acme/atlas", url: "url", localPath: "/tmp/atlas", serverId: "one" }] };
  expect(defaultServerForRepo(cfg, "acme/new")).toBe("two");
  expect(defaultServerForRepo(cfg, "acme-extra/new")).toBeUndefined();
  expect(resolveServiceConnection(cfg, "acme/atlas").url).toBe("https://one.example.test");
  cfg.repos[0]!.serverId = "missing";
  expect(resolveServiceConnection(cfg, "acme/atlas").url).toBe("");
  saveConfig(cfg, cfgPath);
  expect(() => loadConfig(cfgPath)).toThrow(/unknown server/);
});
