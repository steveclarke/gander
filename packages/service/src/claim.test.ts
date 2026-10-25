import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ClaimScope } from "@gander/shared";
import { openStorage, type Storage } from "./storage.js";
import { buildServer } from "./server.js";

const AUTH = { authorization: "Bearer test-token" };
let dir: string; let storage: Storage; let server: FastifyInstance;

async function start(claimScope?: ClaimScope): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "gander-claim-"));
  storage = openStorage(join(dir, "t.db"));
  server = buildServer({ storage, token: "test-token", version: "0.11.0", ...(claimScope ? { claimScope } : {}) });
  await server.ready();
}
afterEach(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });

const claim = async (remote: string, headers: Record<string, string> = AUTH) =>
  server.inject({ method: "GET", url: `/api/repositories/claim?remote=${encodeURIComponent(remote)}`, headers });

describe("repository claims", () => {
  it("covers every repository by default, as servers did before claims", async () => {
    await start();
    expect((await claim("https://github.com/example/atlas.git")).json()).toEqual({ claimed: true });
    expect((await claim("git@github.com:other/harbor.git")).json()).toEqual({ claimed: true });
  });

  it("claims only the listed owners, in any remote spelling and case", async () => {
    await start(["Example"]);
    expect((await claim("https://github.com/example/atlas")).json()).toEqual({ claimed: true });
    expect((await claim("git@github.com:EXAMPLE/atlas.git")).json()).toEqual({ claimed: true });
    expect((await claim("ssh://git@github.com/example/atlas.git")).json()).toEqual({ claimed: true });
    // A fork lives under its own owner, so it is not claimed by its upstream's server.
    expect((await claim("https://github.com/someone/atlas.git")).json()).toEqual({ claimed: false });
  });

  it("answers no for a remote it cannot read, and 400 without one", async () => {
    await start();
    expect((await claim("https://example.test/not/github")).json()).toEqual({ claimed: false });
    expect((await server.inject({ method: "GET", url: "/api/repositories/claim", headers: AUTH })).statusCode).toBe(400);
  });

  it("requires the bearer token", async () => {
    await start();
    expect((await claim("https://github.com/example/atlas", {})).statusCode).toBe(401);
  });
});
