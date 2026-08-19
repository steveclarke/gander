import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { ReviewerReplyWaiters } from "../../../service/src/reply-waiters.js";
import { buildServer } from "../../../service/src/server.js";
import { openStorage, type Storage } from "../../../service/src/storage.js";

let dir: string;
let storage: Storage;
let service: ReturnType<typeof buildServer>;
let serviceUrl: string;
let client: Client;

function childEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete env.CODEX_THREAD_ID;
  delete env.GANDER_CODEX_SESSION_FILE;
  delete env.GANDER_CODEX_SOCKET;
  return { ...env, GANDER_SERVICE_URL: serviceUrl, GANDER_TOKEN: "test-token", ...extra };
}

async function connectBridge(extraEnv: Record<string, string> = {}): Promise<Client> {
  const bridgeClient = new Client({ name: "bridge-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["--silent", "--filter", "@gander/app", "exec", "tsx", resolve("packages/app/src/main/agent-bridge-main.ts")],
    cwd: resolve("."),
    env: childEnvironment(extraEnv),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  await bridgeClient.connect(transport);
  return bridgeClient;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gander-agent-bridge-"));
  storage = openStorage(join(dir, "service.db"));
  service = buildServer({
    storage,
    token: "test-token",
    version: "0.1.0",
    replyWaiters: new ReviewerReplyWaiters(),
  });
  await service.listen({ port: 0, host: "127.0.0.1" });
  const address = service.addresses()[0]!;
  serviceUrl = `http://127.0.0.1:${address.port}`;

  // Mirrors the current Codex and Claude Code stdio handshake. The bridge's
  // upstream client is separately pinned to modern MCP.
  client = await connectBridge();
});

afterEach(async () => {
  await client.close();
  await service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("local agent bridge", () => {
  it("proxies the three-tool contract and pushes reviewer replies as channel messages", async () => {
    storage.setPrContext("acme/atlas", 7, {
      headRef: "feature/bridge",
      title: "Bridge",
      headSha: "sha-1",
      stackId: null,
      stackSize: null,
      stackPosition: null,
    });
    const question = storage.addQuestion("acme/atlas", 7, {
      path: "src/bridge.ts",
      line: 12,
      text: "Can the agent receive my next reply?",
      headSha: "sha-1",
    });

    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      "get_review_questions",
      "mark_question_addressed",
      "reply_to_question",
    ]);

    let deliver!: (value: { content: string; meta: { repo: string; pr_number: string; reply_cursor: string } }) => void;
    const delivered = new Promise<{ content: string; meta: { repo: string; pr_number: string; reply_cursor: string } }>((resolvePromise) => {
      deliver = resolvePromise;
    });
    client.setNotificationHandler(
      "notifications/claude/channel",
      { params: z.object({
        content: z.string(),
        meta: z.object({ repo: z.string(), pr_number: z.string(), reply_cursor: z.string() }),
      }) },
      (params) => deliver(params),
    );

    await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feature/bridge" },
    });

    const response = await fetch(`${serviceUrl}/api/reviews/acme%2Fatlas/7/questions/${question.id}/replies`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Yes—wake up and use this correction." }),
    });
    expect(response.status).toBe(201);

    const notification = await Promise.race([
      delivered,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("channel notification timed out")), 5_000)),
    ]);
    expect(notification).toEqual({
      content: expect.stringContaining("reviewer replied in Gander"),
      meta: { repo: "acme/atlas", pr_number: "7", reply_cursor: "1" },
    });
    expect(storage.listQuestions("acme/atlas", 7)[0]).toMatchObject({
      state: "open",
      replies: [{ author: "reviewer", text: "Yes—wake up and use this correction." }],
    });
  });

  it("closes an in-flight Codex wake when the agent connection closes", async () => {
    await client.close();
    const sessionFile = join(dir, "cancelled-codex-session");
    const socketPath = join(dir, "cancelled-codex.sock");
    writeFileSync(sessionFile, "01a017c8-09fb-7a53-bef5-abd6e08046d6", { mode: 0o600 });

    const httpServer = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
      webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
    });
    await new Promise<void>((resolvePromise) => httpServer.listen(socketPath, resolvePromise));

    let connected!: () => void;
    const connection = new Promise<void>((resolvePromise) => {
      connected = resolvePromise;
    });
    let disconnected!: () => void;
    const disconnection = new Promise<void>((resolvePromise) => {
      disconnected = resolvePromise;
    });
    webSockets.on("connection", (webSocket) => {
      connected();
      webSocket.once("close", disconnected);
      // Leaving initialize unanswered keeps the wake in flight until the MCP
      // client closes and aborts the per-review controller.
    });

    try {
      client = await connectBridge({
        GANDER_CODEX_SESSION_FILE: sessionFile,
        GANDER_CODEX_SOCKET: socketPath,
      });
      storage.setPrContext("acme/atlas", 9, {
        headRef: "feature/cancel-bridge",
        title: "Cancel bridge",
        headSha: "sha-3",
        stackId: null,
        stackSize: null,
        stackPosition: null,
      });
      const question = storage.addQuestion("acme/atlas", 9, {
        path: "src/cancel.ts",
        line: 8,
        text: "Will the socket close?",
        headSha: "sha-3",
      });
      await client.callTool({
        name: "get_review_questions",
        arguments: { repo: "acme/atlas", prNumber: 9 },
      });
      const response = await fetch(`${serviceUrl}/api/reviews/acme%2Fatlas/9/questions/${question.id}/replies`, {
        method: "POST",
        headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Please continue." }),
      });
      expect(response.status).toBe(201);
      await connection;

      await client.close();
      await Promise.race([
        disconnection,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Codex socket did not close")), 5_000)),
      ]);
    } finally {
      webSockets.close();
      await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
    }
  }, 10_000);

  it("starts a turn on the Codex app-server socket when a reviewer replies", async () => {
    await client.close();
    const sessionFile = join(dir, "codex-session");
    const socketPath = join(dir, "codex.sock");
    const threadId = "01a017c8-09fb-7a53-bef5-abd6e08046d6";
    writeFileSync(sessionFile, threadId, { mode: 0o600 });

    const httpServer = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
      if (request.url !== "/rpc" || request.headers.host !== "localhost" || request.headers["sec-websocket-extensions"] !== undefined) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
    });
    await new Promise<void>((resolvePromise) => httpServer.listen(socketPath, resolvePromise));

    let receiveTurn!: (params: Record<string, unknown>) => void;
    let turnAttempts = 0;
    const turnReceived = new Promise<Record<string, unknown>>((resolvePromise) => {
      receiveTurn = resolvePromise;
    });
    webSockets.on("connection", (webSocket) => {
      webSocket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as { id?: number; method?: string; params?: Record<string, unknown> };
        if (message.id === 1) webSocket.send(JSON.stringify({ id: 1, result: {} }));
        if (message.id === 2 && message.method === "turn/start") {
          turnAttempts += 1;
          if (turnAttempts === 1) {
            webSocket.send(JSON.stringify({ id: 2, error: { code: -32600, message: "active turn cannot accept input" } }));
            return;
          }
          receiveTurn(message.params ?? {});
          webSocket.send(JSON.stringify({ id: 2, result: { turn: { id: "turn-1", status: "inProgress" } } }));
          webSocket.send(JSON.stringify({
            method: "turn/completed",
            params: { threadId, turn: { id: "turn-1", status: "completed" } },
          }));
        }
      });
    });

    try {
      client = await connectBridge({
        GANDER_CODEX_SESSION_FILE: sessionFile,
        GANDER_CODEX_SOCKET: socketPath,
      });
      storage.setPrContext("acme/atlas", 8, {
        headRef: "feature/codex-bridge",
        title: "Codex bridge",
        headSha: "sha-2",
        stackId: null,
        stackSize: null,
        stackPosition: null,
      });
      const question = storage.addQuestion("acme/atlas", 8, {
        path: "src/codex.ts",
        line: 4,
        text: "Will this wake Codex?",
        headSha: "sha-2",
      });
      await client.callTool({
        name: "get_review_questions",
        arguments: { repo: "acme/atlas", prNumber: 8 },
      });
      const response = await fetch(`${serviceUrl}/api/reviews/acme%2Fatlas/8/questions/${question.id}/replies`, {
        method: "POST",
        headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Please continue." }),
      });
      expect(response.status).toBe(201);

      const params = await Promise.race([
        turnReceived,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Codex turn timed out")), 5_000)),
      ]);
      expect(params).toMatchObject({
        threadId,
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        input: [{ type: "text", text: expect.stringContaining("A reviewer replied in Gander on acme/atlas#8") }],
      });
      expect(turnAttempts).toBe(2);
      expect(storage.listQuestions("acme/atlas", 8)[0]?.state).toBe("open");
    } finally {
      webSockets.close();
      await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
    }
  }, 10_000);
});
