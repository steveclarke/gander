import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewerReplyWaiters } from "../../../service/src/reply-waiters.js";
import { buildServer } from "../../../service/src/server.js";
import { openStorage, type Storage } from "../../../service/src/storage.js";

let dir: string;
let storage: Storage;
let service: ReturnType<typeof buildServer>;
let serviceUrl: string;
let client: Client;

function childEnvironment(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { ...env, GANDER_SERVICE_URL: serviceUrl, GANDER_TOKEN: "test-token" };
}

async function connectBridge(): Promise<Client> {
  const bridgeClient = new Client({ name: "bridge-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["--silent", "--filter", "@gander/app", "exec", "tsx", resolve("packages/app/src/main/agent-bridge-main.ts")],
    cwd: resolve("."),
    env: childEnvironment(),
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
  it("proxies the three-tool contract to the hosted service", async () => {
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
      text: "Can the agent read this through the bridge?",
      headSha: "sha-1",
    });

    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      "get_review_questions",
      "mark_question_addressed",
      "reply_to_question",
    ]);

    const listed = await client.callTool({
      name: "get_review_questions",
      arguments: { repo: "acme/atlas", branch: "feature/bridge" },
    });
    const first = (listed.content as Array<{ type: string; text?: string }>)[0];
    expect(first?.type).toBe("text");
    expect(first?.text).toContain("Can the agent read this through the bridge?");

    const replied = await client.callTool({
      name: "reply_to_question",
      arguments: { id: question.id, text: "Yes, through the proxied tools." },
    });
    expect(replied.isError).not.toBe(true);
    expect(storage.listQuestions("acme/atlas", 7)[0]).toMatchObject({
      state: "open",
      replies: [{ author: "agent", text: "Yes, through the proxied tools." }],
    });
  });
});
