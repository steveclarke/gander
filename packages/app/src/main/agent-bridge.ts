import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fromJsonSchema, McpServer, type CallToolResult, type JsonSchemaType, type Tool } from "@modelcontextprotocol/server";
import WebSocket from "ws";

export const GANDER_MCP_PROTOCOL_VERSION = "2026-07-28";
export const LOCAL_AGENT_PROTOCOL_VERSIONS = [GANDER_MCP_PROTOCOL_VERSION, "2025-06-18"];
const WATCH_SECONDS = 30;
const MAX_WATCHES = 4;
const MAX_WAKE_RETRY_MS = 15_000;
const TOOL_NAMES = ["get_review_questions", "mark_question_addressed", "reply_to_question"] as const;

interface ReviewCursor {
  repo: string;
  prNumber: number;
  replyCursor: number;
}

export interface AgentBridgeOptions {
  serviceUrl: string;
  token: string;
  version: string;
  codexSessionFile?: string;
  codexSocket?: string;
  onError?: (error: Error) => void;
}

interface AgentBridge {
  server: McpServer;
  close(): Promise<void>;
}

function textOf(result: CallToolResult): string | null {
  const first = result.content[0];
  return first?.type === "text" ? first.text : null;
}

function cursorOf(result: CallToolResult): ReviewCursor | null {
  if (result.isError === true) return null;
  const text = textOf(result);
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<ReviewCursor>;
    if (typeof value.repo !== "string" || !Number.isInteger(value.prNumber) || !Number.isInteger(value.replyCursor)) return null;
    return value as ReviewCursor;
  } catch {
    return null;
  }
}

function waitKey(target: ReviewCursor): string {
  return `${target.repo}#${target.prNumber}`;
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref();
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function runCodexWake(
  socketPath: string,
  sessionFile: string,
  target: ReviewCursor,
  version: string,
  signal: AbortSignal,
): Promise<void> {
  const threadId = (await readFile(sessionFile, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(threadId)) {
    throw new Error("Codex session hook did not provide a valid thread id");
  }
  const prompt =
    `A reviewer replied in Gander on ${target.repo}#${target.prNumber}. ` +
    `Call get_review_questions for that pull request, read the new reviewer reply, and continue the review work. ` +
    `Use reply_to_question for conversation; do not mark a question addressed unless the work is complete.`;

  await new Promise<void>((resolve, reject) => {
    // Codex fixes the otherwise-irrelevant HTTP request target and host to
    // ws://localhost/rpc, then carries that WebSocket upgrade over the socket.
    const socket = new WebSocket("ws://localhost/rpc", {
      createConnection: () => createConnection({ path: socketPath }),
      perMessageDeflate: false,
    });
    let finished = false;
    let timeout: ReturnType<typeof setTimeout>;
    const abort = (): void => finish(new Error("Codex wake canceled"));

    const send = (message: object): void => {
      socket.send(JSON.stringify(message));
    };
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      socket.close();
      if (error === undefined) resolve();
      else reject(error);
    };
    timeout = setTimeout(() => finish(new Error("Codex wake timed out after 10 seconds")), 10_000);

    socket.on("message", (data) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        finish(new Error("Codex app server returned invalid JSON"));
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(new Error(`Codex app server initialization failed: ${JSON.stringify(message.error)}`));
          return;
        }
        send({ method: "initialized" });
        send({
          id: 2,
          method: "turn/start",
          params: {
            threadId,
            input: [{ type: "text", text: prompt }],
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
          },
        });
      } else if (message.id === 2) {
        if (message.error !== undefined) {
          finish(new Error(`Codex rejected the reviewer reply: ${JSON.stringify(message.error)}`));
          return;
        }
        const result = message.result as { turn?: { id?: unknown } } | undefined;
        if (typeof result?.turn?.id !== "string") finish(new Error("Codex turn/start returned no turn id"));
        else finish();
      } else if (message.id !== undefined && message.method !== undefined) {
        send({ id: message.id, error: { code: -32601, message: "Unsupported request" } });
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!finished) finish(new Error("Codex app-server connection closed before the wake turn completed"));
    });
    socket.once("open", () => {
      send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "gander", title: "Gander", version },
          capabilities: null,
        },
      });
    });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * A per-agent stdio MCP server. It proxies Gander's three tools to the hosted
 * service, then keeps the reply wait armed after the model's turn ends. Claude
 * receives its native channel notification; Codex receives a turn through the
 * same app-server connection that powers its terminal UI.
 */
export async function createAgentBridge(options: AgentBridgeOptions): Promise<AgentBridge> {
  const remote = new Client(
    { name: "gander-agent-bridge", version: options.version },
    { versionNegotiation: { mode: { pin: GANDER_MCP_PROTOCOL_VERSION } } },
  );
  await remote.connect(new StreamableHTTPClientTransport(new URL(`${options.serviceUrl.replace(/\/+$/, "")}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
  }));

  const listed = await remote.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(toolNames) !== JSON.stringify([...TOOL_NAMES].sort())) {
    await remote.close();
    throw new Error(`Gander service returned an unexpected MCP contract: ${toolNames.join(", ")}`);
  }
  const server = new McpServer(
    { name: "gander", version: options.version },
    {
      // Current Codex and Claude Code still open local stdio servers with the
      // 2025 handshake. This adapter translates that local connection to the
      // modern-only HTTP service; the public endpoint has no legacy path.
      supportedProtocolVersions: LOCAL_AGENT_PROTOCOL_VERSIONS,
      capabilities: { experimental: { "claude/channel": {} } },
      instructions:
        "Reviewer replies arrive as channel messages. Read the current thread with get_review_questions, " +
        "reply with reply_to_question, and leave question resolution to the reviewer.",
    },
  );
  const controllers = new Map<string, AbortController>();
  let closed = false;

  const report = (error: unknown): void => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  async function wake(target: ReviewCursor, signal: AbortSignal): Promise<void> {
    if (options.codexSessionFile !== undefined && options.codexSocket !== undefined) {
      await runCodexWake(
        options.codexSocket,
        options.codexSessionFile,
        target,
        options.version,
        signal,
      );
      return;
    }
    await server.server.notification({
      method: "notifications/claude/channel",
      params: {
        content:
          `A reviewer replied in Gander on ${target.repo}#${target.prNumber}. ` +
          "Call get_review_questions now, read the new reply, and continue the review work.",
        meta: {
          repo: target.repo,
          pr_number: String(target.prNumber),
          reply_cursor: String(target.replyCursor),
        },
      },
    });
  }

  function watch(initial: ReviewCursor): void {
    const key = waitKey(initial);
    controllers.get(key)?.abort();
    if (!controllers.has(key) && controllers.size >= MAX_WATCHES) {
      report(new Error(`Gander agent bridge already watches ${MAX_WATCHES} pull requests`));
      return;
    }
    const controller = new AbortController();
    controllers.set(key, controller);

    void (async () => {
      let cursor = initial.replyCursor;
      try {
        while (!closed && !controller.signal.aborted) {
          const result = await remote.callTool({
            name: "get_review_questions",
            arguments: {
              repo: initial.repo,
              prNumber: initial.prNumber,
              includeAddressed: true,
              afterReplyCursor: cursor,
              waitSeconds: WATCH_SECONDS,
            },
          }, { timeout: (WATCH_SECONDS + 5) * 1_000, signal: controller.signal }) as CallToolResult;
          const next = cursorOf(result);
          if (next === null) throw new Error(textOf(result) ?? "Gander reply wait returned no cursor");
          if (next.replyCursor > cursor) {
            let retryMs = 1_000;
            while (!closed && !controller.signal.aborted) {
              try {
                await wake(next, controller.signal);
                cursor = next.replyCursor;
                break;
              } catch (error) {
                if (closed || controller.signal.aborted) break;
                report(error);
                await waitForRetry(retryMs, controller.signal);
                retryMs = Math.min(retryMs * 2, MAX_WAKE_RETRY_MS);
              }
            }
          }
        }
      } catch (error) {
        if (!closed && !controller.signal.aborted) report(error);
      } finally {
        if (controllers.get(key) === controller) controllers.delete(key);
      }
    })();
  }

  for (const tool of listed.tools) {
    const registered = tool as Tool;
    server.registerTool(
      registered.name,
      {
        title: registered.title,
        description: registered.description,
        inputSchema: fromJsonSchema(registered.inputSchema as JsonSchemaType),
        annotations: registered.annotations,
      },
      async (args) => {
        const result = await remote.callTool({
          name: registered.name,
          arguments: args as Record<string, unknown>,
        }) as CallToolResult;
        if (registered.name === "get_review_questions") {
          const target = cursorOf(result);
          if (target !== null) watch(target);
        }
        return result;
      },
    );
  }

  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      await remote.close();
    },
  };
}
