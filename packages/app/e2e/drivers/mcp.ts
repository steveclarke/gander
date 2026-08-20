import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface NotePayload {
  lastNoteId: number | null;
  noteCounts: { open: number; in_progress: number; addressed: number; resolved: number };
  notes: Array<{
    id: number;
    file: string | null;
    line: number | null;
    text: string;
    state: string;
    sourceContext: { startLine: number; lines: string[] } | null;
  }>;
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

  async notes(repo: string, branch: string, since?: number): Promise<NotePayload> {
    const result = await this.client.callTool({
      name: "get_review_notes",
      arguments: { repo, branch, includeAddressed: true, includeResolved: true, ...(since === undefined ? {} : { since }) },
    });
    return JSON.parse(textOf(result as { content?: unknown })) as NotePayload;
  }

  async markInProgress(id: number, note?: string): Promise<void> {
    await this.client.callTool({
      name: "mark_note_in_progress",
      arguments: { id, ...(note === undefined ? {} : { note }) },
    });
  }

  async markAddressed(id: number, summary: string, commitRef?: string): Promise<void> {
    await this.client.callTool({
      name: "mark_note_addressed",
      arguments: { id, summary, ...(commitRef === undefined ? {} : { commitRef }) },
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
