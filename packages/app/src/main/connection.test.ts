import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { checkConnection } from "./connection.js";

let server: FastifyInstance | undefined;

afterEach(async () => { await server?.close(); server = undefined; });

/** A real service-shaped server, so the check meets the responses it will meet in life. */
async function serve(token: string): Promise<string> {
  server = Fastify({ logger: false });
  server.get("/healthz", async () => ({ ok: true, version: "1.2.3" }));
  server.get("/api/reviews/:repoId/:prNumber", async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ error: "no" });
    return { repoId: "x/y", prNumber: 1, files: [] };
  });
  return server.listen({ host: "127.0.0.1", port: 0 });
}

describe("checkConnection", () => {
  it("accepts a reachable service and the right token", async () => {
    const url = await serve("good-token");
    expect(await checkConnection(url, "good-token")).toEqual({ ok: true, version: "1.2.3" });
  });

  it("tolerates a trailing slash and surrounding whitespace", async () => {
    const url = await serve("good-token");
    expect(await checkConnection(`  ${url}/  `, " good-token ")).toEqual({ ok: true, version: "1.2.3" });
  });

  it("names the token when the service rejects it", async () => {
    const url = await serve("good-token");
    expect(await checkConnection(url, "wrong")).toEqual({ ok: false, reason: "The service rejected that token." });
  });

  it("reports an address that answers nothing", async () => {
    const result = await checkConnection("http://127.0.0.1:1", "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Could not reach");
  });

  it("reports a server that is not a Gander service", async () => {
    server = Fastify({ logger: false });
    server.get("/healthz", async (_req, reply) => reply.type("text/plain").send("hello"));
    const url = await server.listen({ host: "127.0.0.1", port: 0 });
    const result = await checkConnection(url, "t");
    expect(result).toEqual({ ok: false, reason: `${url} is not a Gander service` });
  });

  it("asks for the missing half rather than probing", async () => {
    expect(await checkConnection("", "t")).toEqual({ ok: false, reason: "Enter the service URL." });
    expect(await checkConnection("http://x", " ")).toEqual({ ok: false, reason: "Enter the service token." });
  });
});
