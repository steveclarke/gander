import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { openStorage, type Storage } from "./storage.js";
import { buildServer } from "./server.js";

let dir: string; let storage: Storage; let server: FastifyInstance;
const AUTH = { authorization: "Bearer test-token" };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gander-api-"));
  storage = openStorage(join(dir, "t.db"));
  server = buildServer({ storage, token: "test-token", version: "0.1.0" });
  await server.ready();
});
afterEach(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe("service API", () => {
  it("healthz is open and reports version", async () => {
    const res = await server.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  it("rejects missing or wrong bearer token", async () => {
    const noAuth = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7" });
    expect(noAuth.statusCode).toBe(401);
    const badAuth = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7", headers: { authorization: "Bearer nope" } });
    expect(badAuth.statusCode).toBe(401);
  });

  it("GET returns an empty review; PUT round-trips a checkoff", async () => {
    const empty = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7", headers: AUTH });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ repoId: "acme/atlas", prNumber: 7, files: [] });

    const put = await server.inject({
      method: "PUT", url: "/api/reviews/acme%2Fatlas/7/files", headers: AUTH,
      payload: { checked: true, path: "a.rb", baseHash: "b1", headHash: "h1", baseContent: "o", headContent: "n", machine: "studio" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().checked).toBe(true);

    const after = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7", headers: AUTH });
    expect(after.json().files).toHaveLength(1);
  });

  it("rejects a malformed PUT body with 400 and the zod message", async () => {
    const res = await server.inject({
      method: "PUT", url: "/api/reviews/acme%2Fatlas/7/files", headers: AUTH,
      payload: { checked: true, path: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/path|machine|Hash/i);
  });

  it("rejects a non-numeric prNumber on GET with 400", async () => {
    const res = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/abc", headers: AUTH });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/prNumber/i);
  });

  it("rejects a non-positive prNumber on GET with 400", async () => {
    const res = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/0", headers: AUTH });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/prNumber/i);
  });

  it("rejects a non-numeric prNumber on PUT with 400", async () => {
    const res = await server.inject({
      method: "PUT", url: "/api/reviews/acme%2Fatlas/abc/files", headers: AUTH,
      payload: { checked: true, path: "a.rb", baseHash: "b1", headHash: "h1", baseContent: "o", headContent: "n", machine: "studio" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/prNumber/i);
  });

  it("handles a repoId containing a literal percent sign without a 500", async () => {
    // The router already URL-decodes params; a handler that decodeURIComponent's them again
    // throws URIError on a literal "%" that isn't part of a valid escape sequence, turning
    // what should be a normal (if odd) repoId into an unhandled 500.
    const res = await server.inject({ method: "GET", url: "/api/reviews/acme%252Fweird%25repo/7", headers: AUTH });
    expect(res.statusCode).toBeLessThan(500);
  });
});
