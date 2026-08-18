import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openStorage, type Storage } from "./storage.js";
import { buildServer } from "./server.js";

// A real MCP client over a real HTTP listener: server.inject cannot drive the streaming
// transport, and the failure this catches — a request that hangs because Fastify already
// consumed the body — only happens over a real socket.

let dir: string;
let storage: Storage;
let server: FastifyInstance;
let baseUrl: string;

async function connect(token = "test-token"): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

// The SDK's CallToolResult content is a wide union; every assertion here is about the
// text block a tool returns, so narrow once instead of at each call site.
const textOf = (result: { content?: unknown }): string => {
  const [first] = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return first?.text ?? "";
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gander-mcp-"));
  storage = openStorage(join(dir, "t.db"));
  server = buildServer({ storage, token: "test-token", version: "0.1.0" });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const addr = server.addresses()[0]!;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await server.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP endpoint", () => {
  it("offers exactly the two tools the contract defines", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_review_questions", "mark_question_addressed"]);
    await client.close();
  });

  it("returns the reviewer's open questions for a branch", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 12, text: "Why the retry here?", headSha: null });

    const client = await connect();
    const result = await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing" },
    });
    const payload = JSON.parse(textOf(result as { content?: unknown })) as { prNumber: number; branch: string; title: string; stack: unknown; questions: Array<{ file: string; line: number; text: string }> };
    expect(payload.prNumber).toBe(7);
    // The agent must be able to tell which pull request — and which checkout — this is.
    expect(payload.branch).toBe("feat/thing");
    expect(payload.title).toBe("Feature");
    expect(payload.questions).toEqual([{
      id: expect.any(Number), file: "a.rb", line: 12, text: "Why the retry here?", state: "open",
      capturedAtSha: null, lineMayHaveMoved: false,
    }]);
    await client.close();
  });

  it("hides addressed questions unless they are asked for", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const done = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "handled", headSha: null });
    storage.addQuestion("acme/atlas", 7, { path: "b.rb", line: null, text: "still open", headSha: null });
    storage.markQuestionAddressed(done.id, { commitRef: "abc", note: null });

    const client = await connect();
    const openOnly = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing" },
    })) as { content?: unknown })) as { questions: unknown[] };
    expect(openOnly.questions).toHaveLength(1);

    const both = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing", includeAddressed: true },
    })) as { content?: unknown })) as { questions: unknown[] };
    expect(both.questions).toHaveLength(2);
    await client.close();
  });

  it("marks a question addressed, and the state is really in storage", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const q = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "Why?", headSha: null });

    const client = await connect();
    await client.callTool({
      name: "mark_question_addressed",
      arguments: { id: q.id, commitRef: "abc1234", note: "Dropped the retry" },
    });
    expect(storage.listQuestions("acme/atlas", 7)[0]).toMatchObject({
      state: "addressed", commitRef: "abc1234", note: "Dropped the retry",
    });
    await client.close();
  });

  it("refuses to mark a question that is not open", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "mark_question_addressed", arguments: { id: 999 } });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content?: unknown })).toContain("not open");
    await client.close();
  });

  it("says so plainly when the branch was never reviewed in Gander", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "never-opened" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content?: unknown })).toContain("has to be opened in Gander once");
    await client.close();
  });

  it("cannot be reached without the bearer token", async () => {
    await expect(connect("wrong-token")).rejects.toThrow();
  });

  it("reports the stack position so an agent knows a sibling exists", async () => {
    storage.setPrContext("acme/atlas", 7, {
      headRef: "feat/backend", title: "Feature backend", headSha: "sha-1",
      stackId: 99, stackSize: 2, stackPosition: 1,
    });
    const client = await connect();
    const payload = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7 },
    })) as { content?: unknown })) as { stack: { position: number; size: number; members: unknown[] } };
    expect(payload.stack).toMatchObject({ position: 1, size: 2 });
    await client.close();
  });

  it("names the sibling holding the questions when the agent's own branch has none", async () => {
    // The reviewer read the backend branch and left a question there; the agent is
    // standing on the frontend branch of the same stack.
    storage.setPrContext("acme/atlas", 7, {
      headRef: "feat/backend", title: "Backend", headSha: "sha-1", stackId: 99, stackSize: 2, stackPosition: 1,
    });
    storage.setPrContext("acme/atlas", 8, {
      headRef: "feat/frontend", title: "Frontend", headSha: "sha-2", stackId: 99, stackSize: 2, stackPosition: 2,
    });
    storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 12, text: "Why?", headSha: "sha-1" });

    const client = await connect();
    const text = textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/frontend" },
    })) as { content?: unknown });

    // It must not have to guess pull request numbers to find them.
    expect(text).toContain("#7");
    expect(text).toContain("feat/backend");
    expect(text).toContain("1 open");
    await client.close();
  });

  it("stays quiet about siblings when the branch has its own questions", async () => {
    storage.setPrContext("acme/atlas", 7, {
      headRef: "feat/backend", title: "Backend", headSha: "sha-1", stackId: 99, stackSize: 2, stackPosition: 1,
    });
    storage.setPrContext("acme/atlas", 8, {
      headRef: "feat/frontend", title: "Frontend", headSha: "sha-2", stackId: 99, stackSize: 2, stackPosition: 2,
    });
    storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 1, text: "on backend", headSha: null });
    storage.addQuestion("acme/atlas", 8, { path: "b.ts", line: 1, text: "on frontend", headSha: null });

    const client = await connect();
    const text = textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/frontend" },
    })) as { content?: unknown });
    expect(text).toContain("on frontend");
    expect(text).not.toContain("Call this tool again");
    await client.close();
  });

  it("flags a question whose line predates the commits now on the branch", async () => {
    storage.setPrContext("acme/atlas", 7, {
      headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null,
    });
    storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 12, text: "captured at sha-1", headSha: "sha-1" });

    const client = await connect();
    const stillCurrent = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions", arguments: { repo: "acme/atlas", prNumber: 7 },
    })) as { content?: unknown })) as { questions: Array<{ lineMayHaveMoved: boolean }> };
    expect(stillCurrent.questions[0]!.lineMayHaveMoved).toBe(false);

    // The branch moves: the reviewer's line number is now only where it used to be.
    storage.setPrContext("acme/atlas", 7, {
      headRef: "feat/thing", title: "Feature", headSha: "sha-2", stackId: null, stackSize: null, stackPosition: null,
    });
    const moved = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions", arguments: { repo: "acme/atlas", prNumber: 7 },
    })) as { content?: unknown })) as { headSha: string; questions: Array<{ capturedAtSha: string; lineMayHaveMoved: boolean }> };
    expect(moved.headSha).toBe("sha-2");
    expect(moved.questions[0]).toMatchObject({ capturedAtSha: "sha-1", lineMayHaveMoved: true });
    await client.close();
  });
});