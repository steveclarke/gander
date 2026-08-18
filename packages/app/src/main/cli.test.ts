import { describe, expect, it } from "vitest";
import { parseOpenTarget } from "./cli.js";

describe("parseOpenTarget", () => {
  it("returns null when no target is named", () => {
    expect(parseOpenTarget([])).toBeNull();
  });

  it("ignores the switches Chromium adds to argv", () => {
    expect(parseOpenTarget(["--user-data-dir=/tmp/x", "--no-sandbox"])).toBeNull();
    expect(parseOpenTarget(["--user-data-dir=/tmp/x", "--repo", "acme/atlas"])).toEqual({
      repoId: "acme/atlas", prNumber: null,
    });
  });

  it("reads a repository on its own", () => {
    expect(parseOpenTarget(["--repo", "acme/atlas"])).toEqual({ repoId: "acme/atlas", prNumber: null });
    expect(parseOpenTarget(["--repo=acme/atlas"])).toEqual({ repoId: "acme/atlas", prNumber: null });
  });

  it("reads a repository and pull request number", () => {
    expect(parseOpenTarget(["--repo", "acme/atlas", "--pr", "42"])).toEqual({ repoId: "acme/atlas", prNumber: 42 });
    expect(parseOpenTarget(["--repo=acme/atlas", "--pr=42"])).toEqual({ repoId: "acme/atlas", prNumber: 42 });
  });

  it("takes the repository from a pull request URL", () => {
    expect(parseOpenTarget(["--pr", "https://github.com/acme/atlas/pull/42"])).toEqual({
      repoId: "acme/atlas", prNumber: 42,
    });
  });

  it("takes the repository from owner/name#number", () => {
    expect(parseOpenTarget(["--pr", "acme/atlas#42"])).toEqual({ repoId: "acme/atlas", prNumber: 42 });
  });

  it("lets --pr override the repository it names", () => {
    expect(parseOpenTarget(["--repo", "acme/other", "--pr", "https://github.com/acme/atlas/pull/7"])).toEqual({
      repoId: "acme/atlas", prNumber: 7,
    });
  });

  it("rejects a pull request number with no repository", () => {
    expect(() => parseOpenTarget(["--pr", "42"])).toThrow(/needs a repository/);
  });

  it("rejects a malformed repository", () => {
    expect(() => parseOpenTarget(["--repo", "atlas"])).toThrow(/owner\/name/);
    expect(() => parseOpenTarget(["--repo"])).toThrow(/owner\/name/);
  });

  it("rejects a malformed pull request", () => {
    expect(() => parseOpenTarget(["--repo", "acme/atlas", "--pr", "main"])).toThrow(/--pr expects/);
    expect(() => parseOpenTarget(["--repo", "acme/atlas", "--pr", "0"])).toThrow(/positive/);
  });
});
