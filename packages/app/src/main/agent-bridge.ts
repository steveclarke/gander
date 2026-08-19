import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fromJsonSchema, McpServer, type CallToolResult, type JsonSchemaType, type Tool } from "@modelcontextprotocol/server";

export const GANDER_MCP_PROTOCOL_VERSION = "2026-07-28";
export const LOCAL_AGENT_PROTOCOL_VERSIONS = [GANDER_MCP_PROTOCOL_VERSION, "2025-06-18"];
const TOOL_NAMES = ["get_review_questions", "mark_question_addressed", "reply_to_question"] as const;

export interface AgentBridgeOptions {
  serviceUrl: string;
  token: string;
  version: string;
}

interface AgentBridge {
  server: McpServer;
  close(): Promise<void>;
}

/**
 * A per-agent stdio MCP server that proxies Gander's three tools to the hosted
 * service. Agents wait for reviewer replies with the get_review_questions
 * long-poll arguments; nothing here pushes turns into an agent session.
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
      instructions:
        "Read the review thread with get_review_questions (its afterReplyCursor and waitSeconds arguments wait " +
        "for the next reviewer reply without polling), reply with reply_to_question, and leave question " +
        "resolution to the reviewer.",
    },
  );
  let closed = false;

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
      async (args) => await remote.callTool({
        name: registered.name,
        arguments: args as Record<string, unknown>,
      }) as CallToolResult,
    );
  }

  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      await remote.close();
    },
  };
}
