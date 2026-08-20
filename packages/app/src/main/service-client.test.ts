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

  it("keeps the explanation from a resource 404", async () => {
    const url = await serve((app) => {
      app.get("/api/reviews/:repoId/:prNumber", async (_req, reply) => {
        return reply.code(404).send({ error: "no review for that pull request" });
      });
    });
    const client = createServiceClient(() => ({ url, token: "t" }));
    const error = await client.getReview("acme/atlas", 1).catch((e: Error) => e.message);
    expect(error).toContain("no review for that pull request");
    expect(error).not.toContain("older than this app");
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

describe("a request with no body", () => {
  it("deletes without declaring a content type it is not sending", async () => {
    // The service's own tests drive DELETE through app.inject, which sends no
    // Content-Type — so the header the real client sets was never exercised, and every
    // delete from the app failed against a real listener.
    const seen: Array<string | undefined> = [];
    const url = await serve((app) => {
      app.delete("/api/reviews/:repoId/:prNumber/notes/:id", async (req, reply) => {
        seen.push(req.headers["content-type"]);
        return reply.code(204).send();
      });
    });
    const client = createServiceClient(() => ({ url, token: "t" }));
    await expect(client.deleteNote("acme/atlas", 1, 2)).resolves.toBeUndefined();
    expect(seen).toEqual([undefined]);
  });

  it("still declares it when there is a body", async () => {
    const seen: Array<string | undefined> = [];
    const url = await serve((app) => {
      app.post("/api/reviews/:repoId/:prNumber/notes", async (req, reply) => {
        seen.push(req.headers["content-type"]);
        return reply.code(201).send({
          id: 1, path: "a.rb", line: null, text: "why?", state: "open",
          headSha: null, commitRef: null, summary: null, createdAt: new Date().toISOString(),
        });
      });
    });
    const client = createServiceClient(() => ({ url, token: "t" }));
    await client.addNote("acme/atlas", 1, { path: "a.rb", line: null, text: "why?", headSha: null });
    expect(seen).toEqual(["application/json"]);
  });

  it("patches a note and validates the saved note", async () => {
    const url = await serve((app) => {
      app.patch("/api/reviews/:repoId/:prNumber/notes/:id", async (req) => ({
        id: 2, path: "a.rb", line: null, text: (req.body as { text: string }).text, state: "resolved",
        headSha: null, commitRef: null, summary: null, createdAt: new Date().toISOString(),
      }));
    });
    const client = createServiceClient(() => ({ url, token: "t" }));

    await expect(client.updateNote("acme/atlas", 1, 2, { text: "Updated", state: "resolved" }))
      .resolves.toMatchObject({ id: 2, text: "Updated", state: "resolved" });
  });
});
