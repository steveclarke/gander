import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenTarget } from "@gander/shared";
import { startOpenServer } from "./open-socket.js";
import { assertRepositoryRegistered } from "./repository-registration.js";

let dir: string;
let socketPath: string;
let stop: () => void;
let delivered: OpenTarget[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gander-sock-"));
  socketPath = join(dir, "app.sock");
  delivered = [];
  stop = await startOpenServer({
    socketPath,
    onTarget: (target) => {
      assertRepositoryRegistered([{ repoId: "acme/atlas", url: "u", localPath: "/tmp/atlas" }], target.repoId);
      delivered.push(target);
    },
  });
});
afterEach(() => { stop(); rmSync(dir, { recursive: true, force: true }); });

/** A real client over the real socket — the same round trip bin/gander makes. */
function send(argv: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => socket.write(`${JSON.stringify({ argv })}\n`));
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { out += chunk; });
    socket.on("end", () => resolve(JSON.parse(out)));
    socket.on("error", reject);
  });
}

describe("open server", () => {
  it("delivers a repository and pull request", async () => {
    const reply = await send(["--repo", "acme/atlas", "--pr", "42"]);
    expect(reply).toEqual({ ok: true, target: { repoId: "acme/atlas", prNumber: 42 } });
    expect(delivered).toEqual([{ repoId: "acme/atlas", prNumber: 42 }]);
  });

  it("delivers a repository on its own", async () => {
    await send(["--repo", "acme/atlas"]);
    expect(delivered).toEqual([{ repoId: "acme/atlas", prNumber: null }]);
  });

  it("answers with the reason when the arguments name nothing", async () => {
    expect(await send([])).toEqual({ error: "no repository named: pass --repo owner/name" });
    expect(delivered).toEqual([]);
  });

  it("answers with the reason when the arguments are malformed", async () => {
    expect(await send(["--repo", "atlas"])).toMatchObject({ error: expect.stringContaining("owner/name") });
    expect(delivered).toEqual([]);
  });

  it("refuses a repository that has not been opened from disk", async () => {
    expect(await send(["--repo", "acme/unknown"])).toEqual({
      error: "acme/unknown is not registered. Open one of its checkout folders first.",
    });
    expect(delivered).toEqual([]);
  });

  it("answers with the reason when the request is not a request", async () => {
    const reply = await new Promise((resolve, reject) => {
      const socket = connect(socketPath, () => socket.write("not json\n"));
      let out = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => { out += chunk; });
      socket.on("end", () => resolve(JSON.parse(out)));
      socket.on("error", reject);
    });
    expect(reply).toHaveProperty("error");
    expect(delivered).toEqual([]);
  });

  it("takes over a socket file a crashed run left behind", async () => {
    const second = await startOpenServer({ socketPath, onTarget: (t) => delivered.push(t) });
    await send(["--repo", "acme/atlas"]);
    expect(delivered).toHaveLength(1);
    second();
  });
});
