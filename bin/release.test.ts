import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gander-cask-test-"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "packaging/homebrew"), { recursive: true });
  copyFileSync(join(sourceRoot, "bin/render-homebrew-cask"), join(root, "bin/render-homebrew-cask"));
  copyFileSync(join(sourceRoot, "packaging/homebrew/gander.rb.template"), join(root, "packaging/homebrew/gander.rb.template"));
  chmodSync(join(root, "bin/render-homebrew-cask"), 0o755);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Homebrew cask release handoff", () => {
  it("pins the versioned release DMG and its checksum", () => {
    const dmg = join(root, "Gander-1.2.3-arm64.dmg");
    const output = join(root, "dist/gander.rb");
    writeFileSync(dmg, "signed release bytes");

    const result = spawnSync(join(root, "bin/render-homebrew-cask"), ["1.2.3", dmg, output], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const cask = readFileSync(output, "utf8");
    expect(cask).toContain('version "1.2.3"');
    expect(cask).toContain('sha256 "3ba84e1d362618f0e9f45064634a1594485bca3298b8182b5a7eaa3fded4688f"');
    expect(cask).toContain("Gander-#{version}-arm64.dmg");
    expect(cask).not.toContain("__VERSION__");
    expect(cask).not.toContain("__SHA256__");
  });

  it("refuses an artifact name that cannot match the cask URL", () => {
    const dmg = join(root, "some-build.dmg");
    writeFileSync(dmg, "release bytes");

    const result = spawnSync(join(root, "bin/render-homebrew-cask"), ["1.2.3", dmg, join(root, "gander.rb")], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected the release DMG to be named Gander-1.2.3-arm64.dmg");
  });
});
