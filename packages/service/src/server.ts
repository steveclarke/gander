import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { PutFileStateSchema } from "@gander/shared";
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
      return opts.storage.getReview(decodeURIComponent(req.params.repoId), prNumber);
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
      return opts.storage.putFileState(decodeURIComponent(req.params.repoId), prNumber, parsed.data);
    },
  );

  return app;
}
