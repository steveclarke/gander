import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SERVICE_VERSION } from "@gander/shared";
import { checkConnection, checkServiceStatus, compareServiceVersion } from "./connection.js";
import { createServiceClient } from "./service-client.js";

let server: FastifyInstance | undefined;

afterEach(async () => { await server?.close(); server = undefined; });

/** A real service-shaped server, so the check meets the responses it will meet in life. */
async function serve(token: string, version = SERVICE_VERSION): Promise<string> {
  server = Fastify({ logger: false });
  server.get("/healthz", async () => ({ ok: true, version }));
  server.get("/api/reviews/:repoId/:prNumber", async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: "no" });
    return { repoId: "x/y", prNumber: 1, files: [] };
  });
  server.put("/api/reviews/:repoId/:prNumber/files", async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: "no" });
    const body = req.body as { path: string; checked: boolean };
    return { path: body.path, checked: body.checked, baseHash: null, headHash: null, checkedAt: null, machine: null };
  });
  return server.listen({ host: "127.0.0.1", port: 0 });
}

describe("checkConnection", () => {
  it("accepts a reachable service and the right token", async () => {
    const url = await serve("good-token");
    expect(await checkConnection(url, "good-token")).toEqual({ ok: true, version: SERVICE_VERSION, compatibility: "compatible" });
  });

  it("tolerates a trailing slash and surrounding whitespace", async () => {
    const url = await serve("good-token");
    expect(await checkConnection(`  ${url}/  `, " good-token ")).toEqual({ ok: true, version: SERVICE_VERSION, compatibility: "compatible" });
  });

  it("names the token when the service rejects it", async () => {
    const url = await serve("good-token");
    expect(await checkConnection(url, "wrong")).toEqual({ ok: false, reason: "The service rejected that token." });
  });

  it("includes the system cause when the service cannot be reached", async () => {
    const url = await serve("good-token");
    await server!.close();
    server = undefined;

    const result = await checkConnection(url, "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Could not reach .+: fetch failed \(.+\)/);
  });

  it("reports a server that is not a Gander service", async () => {
    server = Fastify({ logger: false });
    server.get("/healthz", async (_req, reply) => reply.type("text/plain").send("hello"));
    const url = await server.listen({ host: "127.0.0.1", port: 0 });
    const result = await checkConnection(url, "t");
    expect(result).toEqual({ ok: false, reason: `${url} is not a Gander service` });
  });

  it("rejects a service without the current version handshake", async () => {
    server = Fastify({ logger: false });
    server.get("/healthz", async () => ({ ok: true }));
    const url = await server.listen({ host: "127.0.0.1", port: 0 });
    expect(await checkConnection(url, "t"))
      .toEqual({ ok: false, reason: `${url} is not a Gander service` });
  });

  it("asks for the missing half rather than probing", async () => {
    expect(await checkConnection("", "t")).toEqual({ ok: false, reason: "Enter the service URL." });
    expect(await checkConnection("http://x", " ")).toEqual({ ok: false, reason: "Enter the service token." });
  });

  it("blocks an older service and tells the reviewer which version to install", async () => {
    const url = await serve("good-token", "0.0.9");
    await expect(checkConnection(url, "good-token")).resolves.toEqual({
      ok: false,
      reason: `Gander service 0.0.9 is too old for this app. Update the service to ${SERVICE_VERSION}.`,
    });

    const client = createServiceClient(() => ({ url, token: "good-token" }));
    await expect(client.getReview("acme/atlas", 1)).rejects.toThrow(/service 0\.0\.9 is too old/i);
    await expect(client.putFileState("acme/atlas", 1, { checked: false, path: "a.rb" })).rejects.toThrow(
      /not saved and will not be retried/i,
    );
  });

  it("allows a service ahead by a patch with an explicit warning state", async () => {
    // Derived rather than written down: the contract version moves whenever the contract
    // does, and a literal here would fail the next time it did.
    const [major, minor, patch] = SERVICE_VERSION.split(".");
    const newer = `${major}.${minor}.${Number(patch) + 1}`;
    const url = await serve("good-token", newer);
    await expect(checkConnection(url, "good-token")).resolves.toEqual({
      ok: true,
      version: newer,
      compatibility: "newer",
    });
    await expect(checkServiceStatus(url)).resolves.toMatchObject({ state: "newer", serviceVersion: newer });
  });

  it("blocks a service whose contract has moved ahead of this app", async () => {
    // The service dropping a field this app's schemas still require would otherwise pass
    // the version check and fail as a zod error on the first note read.
    const [major, minor] = SERVICE_VERSION.split(".");
    for (const ahead of [`${major}.${Number(minor) + 1}.0`, `${Number(major) + 1}.0.0`]) {
      const url = await serve("good-token", ahead);
      await expect(checkConnection(url, "good-token")).resolves.toEqual({
        ok: false,
        reason: `Gander service ${ahead} is newer than this app understands. Update the app to a build that supports ${ahead}.`,
      });
      await expect(checkServiceStatus(url)).resolves.toMatchObject({ state: "incompatible", serviceVersion: ahead });
    }
  });

  it("rejects a version that cannot participate in the compatibility policy", () => {
    expect(compareServiceVersion("development")).toMatchObject({
      state: "incompatible",
      reason: expect.stringContaining("not a supported version"),
    });
  });

  it("requires an authoritative review read after the health check observes an outage", async () => {
    let url = await serve("good-token");
    const client = createServiceClient(() => ({ url, token: "good-token" }));
    await client.getReview("acme/atlas", 1);

    await server!.close();
    await expect(client.status()).resolves.toMatchObject({ state: "unreachable" });
    url = await serve("good-token");

    await expect(client.putFileState("acme/atlas", 1, { checked: false, path: "a.rb" })).rejects.toThrow(
      /refresh it after the service reconnects/i,
    );
    await client.getReview("acme/atlas", 1);
    await expect(client.putFileState("acme/atlas", 1, { checked: false, path: "a.rb" })).resolves.toMatchObject({
      path: "a.rb",
      checked: false,
    });
  });

  it("does not carry cached review state across a service URL change", async () => {
    let url = await serve("good-token");
    const client = createServiceClient(() => ({ url, token: "good-token" }));
    await client.getReview("acme/atlas", 1);

    await server!.close();
    url = await serve("good-token");

    await expect(client.putFileState("acme/atlas", 1, { checked: false, path: "a.rb" })).rejects.toThrow(
      /refresh it after the service reconnects/i,
    );
  });
});
