import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface NotePayload {
  noteCounts: { open: number; addressed: number; resolved: number };
  notes: Array<{ id: number; file: string | null; line: number | null; text: string; state: string }>;
}

function textOf(result: { content?: unknown }): string {
  const [first] = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return first?.text ?? "";
}

export class McpDriver {
  private readonly client = new Client({ name: "gander-e2e-agent", version: "1.0.0" });

  constructor(private readonly serviceUrl: string, private readonly token: string) {}

  async connect(): Promise<this> {
    await this.client.connect(new StreamableHTTPClientTransport(new URL(`${this.serviceUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    }));
    return this;
  }

  async notes(repo: string, branch: string): Promise<NotePayload> {
    const result = await this.client.callTool({
      name: "get_review_notes",
      arguments: { repo, branch, includeAddressed: true, includeResolved: true },
    });
    return JSON.parse(textOf(result as { content?: unknown })) as NotePayload;
  }

  async markAddressed(id: number, commitRef: string, summary: string): Promise<void> {
    await this.client.callTool({
      name: "mark_note_addressed",
      arguments: { id, commitRef, summary },
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
