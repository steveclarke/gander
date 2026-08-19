import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SERVICE_VERSION } from "@gander/shared";
import { createServiceClient } from "./service-client.js";

const servers: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.allSettled(servers.map((s) => s.close()));
  servers.length = 0;
});

/**
 * A real server that passes the version handshake, so each test exercises the failure it
 * is about rather than the connection check in front of it.
 */
async function serve(routes: (app: FastifyInstance) => void): Promise<string> {
  const app = Fastify({ logger: false });
  servers.push(app);
  app.get("/healthz", async () => ({ ok: true, version: SERVICE_VERSION }));
  routes(app);
  return app.listen({ host: "127.0.0.1", port: 0 });
}

describe("a failed request", () => {
  it("reads a 404 as a service older than the app", async () => {
    // No route at all: what a service that predates one answers.
    const url = await serve(() => {});
    const client = createServiceClient(() => ({ url, token: "t" }));
    await expect(client.getReview("acme/atlas", 1)).rejects.toThrow(/does not have GET .*older than this app/s);
  });

  it("says where to fix a rejected token", async () => {
    const url = await serve((app) => {
      app.get("/api/reviews/:repoId/:prNumber", async (_req, reply) => reply.code(401).send({ error: "nope" }));
    });
    const client = createServiceClient(() => ({ url, token: "wrong" }));
    await expect(client.getReview("acme/atlas", 1)).rejects.toThrow(/rejected this app's token.*Settings/s);
  });

  it("keeps the server's own explanation, without the JSON around it", async () => {
    const url = await serve((app) => {
      app.get("/api/reviews/:repoId/:prNumber", async (_req, reply) => reply.code(500).send({ message: "disk is full" }));
    });
    const client = createServiceClient(() => ({ url, token: "t" }));
    const error = await client.getReview("acme/atlas", 1).catch((e: Error) => e.message);
    expect(error).toContain("disk is full");
    expect(error).not.toContain("{");
  });
});
