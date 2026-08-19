import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { NewQuestionReplySchema, NewQuestionSchema, PrContextSchema, PutFileStateSchema } from "@gander/shared";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { buildMcpHandler } from "./mcp.js";
import { ReviewerReplyWaiters, reviewWaitKey } from "./reply-waiters.js";
import type { Storage } from "./storage.js";

function parsePrNumber(raw: string, reply: FastifyReply): number | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    reply.code(400).send({ error: `prNumber must be a positive integer, got ${JSON.stringify(raw)}` });
    return undefined;
  }
  return n;
}

export function buildServer(opts: { storage: Storage; token: string; version: string; replyWaiters?: ReviewerReplyWaiters }): FastifyInstance {
  // Held reply waits must not make shutdown wait for their timeout. Destroying
  // active sockets triggers the same cleanup path as a disconnected MCP client.
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const replyWaiters = opts.replyWaiters ?? new ReviewerReplyWaiters();
  const mcpHandler = buildMcpHandler(opts.storage, opts.version, replyWaiters);
  const handleMcpRequest = toNodeHandler(mcpHandler);
  app.addHook("preClose", async () => {
    replyWaiters.close();
    await mcpHandler.close();
  });

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
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      return opts.storage.getReview(req.params.repoId, prNumber);
    },
  );

  app.put<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/files",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const parsed = PutFileStateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
      return opts.storage.putFileState(req.params.repoId, prNumber, parsed.data);
    },
  );

  app.get<{ Params: { repoId: string; prNumber: string }; Querystring: { path?: string } }>(
    "/api/reviews/:repoId/:prNumber/snapshot",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
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
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const parsed = PrContextSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
      opts.storage.setPrContext(req.params.repoId, prNumber, parsed.data);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/questions",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      return opts.storage.listQuestions(req.params.repoId, prNumber);
    },
  );

  app.post<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/questions",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const parsed = NewQuestionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
      return reply.code(201).send(opts.storage.addQuestion(req.params.repoId, prNumber, parsed.data));
    },
  );

  app.delete<{ Params: { repoId: string; prNumber: string; id: string } }>(
    "/api/reviews/:repoId/:prNumber/questions/:id",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: `id must be a positive integer, got ${JSON.stringify(req.params.id)}` });
      }
      if (!opts.storage.deleteQuestion(req.params.repoId, prNumber, id)) {
        return reply.code(404).send({ error: `no question ${id} on ${req.params.repoId}#${prNumber}` });
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { repoId: string; prNumber: string; id: string } }>(
    "/api/reviews/:repoId/:prNumber/questions/:id/replies",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: `id must be a positive integer, got ${JSON.stringify(req.params.id)}` });
      }
      const parsed = NewQuestionReplySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
      const added = opts.storage.addReviewerReply(req.params.repoId, prNumber, id, parsed.data);
      if (added === null) {
        return reply.code(404).send({ error: `no question ${id} on ${req.params.repoId}#${prNumber}` });
      }
      replyWaiters.publish(
        reviewWaitKey(req.params.repoId, prNumber),
        opts.storage.getReviewerReplyCursor(req.params.repoId, prNumber),
      );
      return reply.code(201).send(added);
    },
  );

  // Agents reach the same questions the app writes, over MCP. Same bearer token as
  // /api — one credential per install, not two.
  app.all("/mcp", async (req, reply) => {
    await handleMcpRequest(req.raw, reply.raw, req.body);
    // The transport writes and ends the raw response itself; telling Fastify the reply
    // is already sent stops it appending a second one.
    reply.hijack();
  });

  return app;
}
