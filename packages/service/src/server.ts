import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { ZodError } from "zod";
import { NewNoteSchema, PrContextSchema, PutFileStateSchema } from "@gander/shared";
import { handleMcpRequest } from "./mcp.js";
import type { Storage } from "./storage.js";

/** Sends a 400 and returns undefined when the segment is not a positive integer. */
function positiveInt(name: string, raw: string, reply: FastifyReply): number | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    reply.code(400).send({ error: `${name} must be a positive integer, got ${JSON.stringify(raw)}` });
    return undefined;
  }
  return n;
}

/** Reports every failing field, so a rejected body says which parts were wrong. */
function badRequest(reply: FastifyReply, error: ZodError): FastifyReply {
  return reply.code(400).send({ error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
}

export function buildServer(opts: {
  storage: Storage;
  token: string;
  version: string;
  /** Called for each route as it is registered. The contract snapshot reads the route table this way. */
  onRoute?: (method: string, path: string) => void;
}): FastifyInstance {
  const app = Fastify({ logger: false });

  // Added before any route, because the hook only sees registrations that follow it.
  if (opts.onRoute) {
    const report = opts.onRoute;
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      // HEAD is generated for every GET; it is not a separate promise to anyone.
      for (const method of methods) if (method !== "HEAD") report(method, route.path);
    });
  }

  app.get("/healthz", async () => ({ ok: true, version: opts.version }));

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") && !req.url.startsWith("/mcp")) return;
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      await reply.code(401).send({ error: "missing or invalid bearer token" });
    }
  });

  app.get<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      return opts.storage.getReview(req.params.repoId, prNumber);
    },
  );

  app.get<{ Params: { repoId: string } }>(
    "/api/reviews/:repoId",
    async (req) => opts.storage.listReviews(req.params.repoId),
  );

  app.put<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/files",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const parsed = PutFileStateSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      return opts.storage.putFileState(req.params.repoId, prNumber, parsed.data);
    },
  );

  app.get<{ Params: { repoId: string; prNumber: string }; Querystring: { path?: string } }>(
    "/api/reviews/:repoId/:prNumber/snapshot",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const path = req.query.path;
      // A path is a query parameter, not a route segment: file paths contain slashes.
      if (typeof path !== "string" || path.length === 0) {
        return reply.code(400).send({ error: "path query parameter is required" });
      }
      const snapshot = opts.storage.getSnapshot(req.params.repoId, prNumber, path);
      // Null means the file was never reviewed — an ordinary state, not an error.
      return snapshot ?? { baseContent: null, headContent: null };
    },
  );

  app.put<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/context",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const parsed = PrContextSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      opts.storage.setPrContext(req.params.repoId, prNumber, parsed.data);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/notes",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      return opts.storage.listNotes(req.params.repoId, prNumber);
    },
  );

  app.post<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/notes",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const parsed = NewNoteSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      return reply.code(201).send(opts.storage.addNote(req.params.repoId, prNumber, parsed.data));
    },
  );

  app.delete<{ Params: { repoId: string; prNumber: string; id: string } }>(
    "/api/reviews/:repoId/:prNumber/notes/:id",
    async (req, reply) => {
      const prNumber = positiveInt("prNumber", req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const id = positiveInt("id", req.params.id, reply);
      if (id === undefined) return;
      if (!opts.storage.deleteNote(req.params.repoId, prNumber, id)) {
        return reply.code(404).send({ error: `no note ${id} on ${req.params.repoId}#${prNumber}` });
      }
      return reply.code(204).send();
    },
  );

  // Agents reach the same notes the app writes, over MCP. Same bearer token as
  // /api — one credential per install, not two.
  app.all("/mcp", async (req, reply) => {
    await handleMcpRequest(opts.storage, opts.version, req.raw, reply.raw, req.body);
    // The transport writes and ends the raw response itself; telling Fastify the reply
    // is already sent stops it appending a second one.
    reply.hijack();
  });

  return app;
}
