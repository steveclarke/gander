import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { NewQuestionSchema, PutFileStateSchema } from "@gander/shared";
import type { Storage } from "./storage.js";

function parsePrNumber(raw: string, reply: FastifyReply): number | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    reply.code(400).send({ error: `prNumber must be a positive integer, got ${JSON.stringify(raw)}` });
    return undefined;
  }
  return n;
}

export function buildServer(opts: { storage: Storage; token: string; version: string }): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({ ok: true, version: opts.version }));

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
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

  app.put<{ Params: { repoId: string; prNumber: string }; Body: { headRef?: unknown } }>(
    "/api/reviews/:repoId/:prNumber/head-ref",
    async (req, reply) => {
      const prNumber = parsePrNumber(req.params.prNumber, reply);
      if (prNumber === undefined) return;
      const headRef = req.body?.headRef;
      if (typeof headRef !== "string" || headRef.length === 0) {
        return reply.code(400).send({ error: "headRef must be a non-empty string" });
      }
      opts.storage.setHeadRef(req.params.repoId, prNumber, headRef);
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

  return app;
}
