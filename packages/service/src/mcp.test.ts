import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openStorage, type Storage } from "./storage.js";
import { ReviewerReplyWaiters } from "./reply-waiters.js";
import { buildServer } from "./server.js";

// A real MCP client over a real HTTP listener: server.inject cannot drive the streaming
// transport, and the failure this catches — a request that hangs because Fastify already
// consumed the body — only happens over a real socket.

let dir: string;
let storage: Storage;
let server: FastifyInstance;
let baseUrl: string;
let replyWaiters: ReviewerReplyWaiters;

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
  replyWaiters = new ReviewerReplyWaiters();
  server = buildServer({ storage, token: "test-token", version: "0.1.0", replyWaiters });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const addr = server.addresses()[0]!;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

async function addReviewerReply(prNumber: number, questionId: number, text: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/reviews/acme%2Fatlas/${prNumber}/questions/${questionId}/replies`, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  expect(response.status).toBe(201);
}

async function restartWithWaiters(waiters: ReviewerReplyWaiters): Promise<void> {
  await server.close();
  replyWaiters = waiters;
  server = buildServer({ storage, token: "test-token", version: "0.1.0", replyWaiters });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const addr = server.addresses()[0]!;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}
afterEach(async () => {
  await server.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP endpoint", () => {
  it("offers the three question conversation tools", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_review_questions", "mark_question_addressed", "reply_to_question"]);
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
    const payload = JSON.parse(textOf(result as { content?: unknown })) as { prNumber: number; replyCursor: number; branch: string; title: string; stack: unknown; questions: Array<{ file: string; line: number; text: string }> };
    expect(payload.prNumber).toBe(7);
    expect(payload.replyCursor).toBe(0);
    // The agent must be able to tell which pull request — and which checkout — this is.
    expect(payload.branch).toBe("feat/thing");
    expect(payload.title).toBe("Feature");
    expect(payload.questions).toEqual([{
      id: expect.any(Number), file: "a.rb", line: 12, text: "Why the retry here?", state: "open",
      replies: [], capturedAtSha: null, lineMayHaveMoved: false,
    }]);
    await client.close();
  });

  it("returns immediately when a reviewer replied between the cursor call and the wait call", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const question = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 12, text: "Why?", headSha: "sha-1" });
    const client = await connect();
    const first = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions", arguments: { repo: "acme/atlas", prNumber: 7 },
    })) as { content?: unknown })) as { replyCursor: number };

    await addReviewerReply(7, question.id, "Because the caller can retry safely.");
    const next = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: first.replyCursor, waitSeconds: 30 },
    })) as { content?: unknown })) as {
      replyCursor: number;
      wait: { outcome: string };
      questions: Array<{ state: string; replies: Array<{ author: string; text: string }> }>;
    };

    expect(next.replyCursor).toBe(1);
    expect(next.wait.outcome).toBe("reply");
    expect(next.questions[0]).toMatchObject({
      state: "open",
      replies: [{ author: "reviewer", text: "Because the caller can retry safely." }],
    });
    await client.close();
  });

  it("holds a call until a reviewer replies on that pull request", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const question = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "Why?", headSha: null });
    const client = await connect();
    const waiting = client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing", afterReplyCursor: 0, waitSeconds: 30 },
    }, undefined, { timeout: 35_000 });
    await expect.poll(() => replyWaiters.activeCount).toBe(1);

    await addReviewerReply(7, question.id, "The requirement changed.");
    const payload = JSON.parse(textOf((await waiting) as { content?: unknown })) as { replyCursor: number; wait: { outcome: string } };
    expect(payload).toMatchObject({ replyCursor: 1, wait: { outcome: "reply" } });
    expect(replyWaiters.activeCount).toBe(0);
    await client.close();
  });

  it("wakes every waiter on the pull request, but not waiters on another pull request", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/one", title: "One", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    storage.setPrContext("acme/atlas", 8, { headRef: "feat/two", title: "Two", headSha: "sha-2", stackId: null, stackSize: null, stackPosition: null });
    const firstQuestion = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "One?", headSha: null });
    const secondQuestion = storage.addQuestion("acme/atlas", 8, { path: "b.rb", line: null, text: "Two?", headSha: null });
    const clients = await Promise.all([connect(), connect(), connect()]);
    const waits = clients.map((client, index) => client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: index < 2 ? 7 : 8, afterReplyCursor: 0, waitSeconds: 30 },
    }, undefined, { timeout: 35_000 }));
    await expect.poll(() => replyWaiters.activeCount).toBe(3);

    await addReviewerReply(7, firstQuestion.id, "For both agents on this pull request.");
    const sameReview = await Promise.all(waits.slice(0, 2));
    expect(sameReview.map((result) => JSON.parse(textOf(result as { content?: unknown })).wait.outcome)).toEqual(["reply", "reply"]);
    expect(replyWaiters.activeCount).toBe(1);

    await addReviewerReply(8, secondQuestion.id, "Only now should this waiter wake.");
    const otherReview = JSON.parse(textOf((await waits[2]!) as { content?: unknown })) as { wait: { outcome: string } };
    expect(otherReview.wait.outcome).toBe("reply");
    await Promise.all(clients.map((client) => client.close()));
  });

  it("returns a timeout outcome and the unchanged cursor", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const client = await connect();
    const result = await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 0, waitSeconds: 1 },
    }, undefined, { timeout: 5_000 });
    const payload = JSON.parse(textOf(result as { content?: unknown })) as { replyCursor: number; wait: { outcome: string; timeoutSeconds: number; message: string } };
    expect(payload).toMatchObject({ replyCursor: 0, wait: { outcome: "timeout", timeoutSeconds: 1 } });
    expect(payload.wait.message).toContain("afterReplyCursor: 0");
    expect(replyWaiters.activeCount).toBe(0);
    await client.close();
  });

  it("releases a held wait when its MCP connection closes", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const client = await connect();
    const waiting = client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 0, waitSeconds: 30 },
    }, undefined, { timeout: 35_000 });
    await expect.poll(() => replyWaiters.activeCount).toBe(1);

    await client.close();
    await expect(waiting).rejects.toThrow();
    await expect.poll(() => replyWaiters.activeCount).toBe(0);
  });

  it("releases held waits so the service can shut down", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const client = await connect();
    const waiting = client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 0, waitSeconds: 30 },
    }, undefined, { timeout: 35_000 });
    await expect.poll(() => replyWaiters.activeCount).toBe(1);

    await server.close();
    expect(replyWaiters.activeCount).toBe(0);
    const cancelled = await waiting;
    expect(cancelled.isError).toBe(true);
    expect(textOf(cancelled as { content?: unknown })).toContain("cancelled");
    await client.close();
  });

  it("rejects waits beyond the configured connection limits", async () => {
    await restartWithWaiters(new ReviewerReplyWaiters({ total: 2, perReview: 1 }));
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const clients = await Promise.all([connect(), connect()]);
    const first = clients[0]!.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 0, waitSeconds: 30 },
    }, undefined, { timeout: 35_000 });
    await expect.poll(() => replyWaiters.activeCount).toBe(1);

    const refused = await clients[1]!.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 0, waitSeconds: 30 },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused as { content?: unknown })).toContain("This pull request already has 1 reply waits open");

    await clients[0]!.close();
    await expect(first).rejects.toThrow();
    await clients[1]!.close();
  });

  it("caps the total waits across different pull requests", async () => {
    await restartWithWaiters(new ReviewerReplyWaiters({ total: 1, perReview: 2 }));
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/one", title: "One", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    storage.setPrContext("acme/atlas", 8, { headRef: "feat/two", title: "Two", headSha: "sha-2", stackId: null, stackSize: null, stackPosition: null });
    const clients = await Promise.all([connect(), connect()]);
    const first = clients[0]!.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 0, waitSeconds: 30 },
    }, undefined, { timeout: 35_000 });
    await expect.poll(() => replyWaiters.activeCount).toBe(1);

    const refused = await clients[1]!.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", prNumber: 8, afterReplyCursor: 0, waitSeconds: 30 },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused as { content?: unknown })).toContain("service already has 1 reply waits open");

    await clients[0]!.close();
    await expect(first).rejects.toThrow();
    await clients[1]!.close();
  });

  it("rejects invalid wait cursor combinations", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const client = await connect();
    const withoutCursor = await client.callTool({
      name: "get_review_questions", arguments: { repo: "acme/atlas", prNumber: 7, waitSeconds: 1 },
    });
    expect(withoutCursor.isError).toBe(true);
    expect(textOf(withoutCursor as { content?: unknown })).toContain("requires afterReplyCursor");

    const futureCursor = await client.callTool({
      name: "get_review_questions", arguments: { repo: "acme/atlas", prNumber: 7, afterReplyCursor: 1 },
    });
    expect(futureCursor.isError).toBe(true);
    expect(textOf(futureCursor as { content?: unknown })).toContain("ahead");
    await client.close();
  });

  it("lets an agent reply and returns the thread without changing question state", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const q = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 12, text: "Why?", headSha: "sha-1" });

    const client = await connect();
    const replied = await client.callTool({
      name: "reply_to_question",
      arguments: { id: q.id, text: "This belongs in the model because both callers need it." },
    });
    expect(textOf(replied as { content?: unknown })).toContain("state was not changed");

    const payload = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing" },
    })) as { content?: unknown })) as { replyCursor: number; questions: Array<{ state: string; replies: Array<{ author: string; text: string }> }> };
    expect(payload.replyCursor).toBe(0);
    expect(payload.questions[0]).toMatchObject({
      state: "open",
      replies: [{ author: "agent", text: "This belongs in the model because both callers need it." }],
    });
    expect(storage.listQuestions("acme/atlas", 7)[0]?.state).toBe("open");
    await client.close();
  });

  it("reports an unknown question when an agent tries to reply", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "reply_to_question", arguments: { id: 999, text: "Anyone there?" } });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content?: unknown })).toContain("does not exist");
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
    })) as { content?: unknown })) as {
      questionCounts: { open: number; addressed: number; resolved: number };
      questions: unknown[];
    };
    expect(openOnly.questions).toHaveLength(1);
    expect(openOnly.questionCounts).toEqual({ open: 1, addressed: 1, resolved: 0 });

    const both = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing", includeAddressed: true },
    })) as { content?: unknown })) as { questions: unknown[] };
    expect(both.questions).toHaveLength(2);
    await client.close();
  });

  it("explains when resolved questions are hidden and returns them when asked", async () => {
    storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
    const resolved = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "handled", headSha: null });
    storage.markQuestionAddressed(resolved.id, { commitRef: "abc1234", note: "Dropped the retry" });
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "a.rb", baseHash: "base", headHash: "head",
      baseContent: "before", headContent: "after", machine: "studio",
    });

    const client = await connect();
    const openOnly = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing" },
    })) as { content?: unknown })) as {
      questionCounts: { open: number; addressed: number; resolved: number };
      message: string;
      questions: unknown[];
    };
    expect(openOnly.questions).toEqual([]);
    expect(openOnly.questionCounts).toEqual({ open: 0, addressed: 0, resolved: 1 });
    expect(openOnly.message).toBe("No open questions returned. 1 resolved question is hidden; pass includeResolved: true to retrieve it.");

    const withResolved = JSON.parse(textOf((await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feat/thing", includeResolved: true },
    })) as { content?: unknown })) as { questions: Array<Record<string, unknown>> };
    expect(withResolved.questions).toEqual([{
      id: resolved.id, file: "a.rb", line: null, text: "handled", state: "resolved",
      replies: [], commitRef: "abc1234", note: "Dropped the retry", capturedAtSha: null, lineMayHaveMoved: false,
    }]);
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
