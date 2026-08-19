import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import * as shared from "@gander/shared";
import { buildServer } from "./server.js";
import { openStorage } from "./storage.js";

/**
 * Everything the app and an agent are promised, in a form a test can compare.
 *
 * `SERVICE_VERSION` only protects anyone if it moves when this surface moves, and nothing
 * re-reads that rule while writing a route. Describing the surface makes forgetting it a
 * failing test rather than a 404 in the middle of a review.
 *
 * Read from a running server rather than from a list kept by hand, because a list kept by
 * hand is the same promise this exists to stop relying on.
 */

export interface Contract {
  version: string;
  /** Every HTTP route, as "METHOD /path". */
  routes: string[];
  /** Each exported payload schema as JSON Schema, so a field added or a rule loosened shows up. */
  schemas: Record<string, unknown>;
  /** The agent-facing tools: name, description, and accepted input. */
  mcpTools: Array<{ name: string; description: string; inputSchema: unknown }>;
}

function schemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(shared)) {
    if (!name.endsWith("Schema")) continue;
    // Everything exported under that suffix is a Zod schema; a future export that is not
    // should fail here loudly rather than be skipped quietly.
    out[name] = z.toJSONSchema(value as z.ZodType, { io: "input", unrepresentable: "any" });
  }
  return out;
}

export async function describeContract(): Promise<Contract> {
  const dir = mkdtempSync(join(tmpdir(), "gander-contract-"));
  const storage = openStorage(join(dir, "contract.db"));
  const routes: string[] = [];
  const server = buildServer({
    storage,
    token: "contract",
    version: shared.SERVICE_VERSION,
    onRoute: (method, path) => routes.push(`${method} ${path}`),
  });

  try {
    const baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    // The public endpoint is modern-only MCP; pin the same revision the service serves.
    const client = new Client(
      { name: "contract", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer contract" } },
      }),
    );
    const { tools } = await client.listTools();
    await client.close();

    return {
      version: shared.SERVICE_VERSION,
      routes: [...routes].sort(),
      schemas: schemas(),
      mcpTools: tools
        .map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally {
    await server.close();
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The surface without the version, which is what has to be identical between two releases. */
export function surfaceOf(contract: Contract): Omit<Contract, "version"> {
  const { version: _version, ...surface } = contract;
  return surface;
}
