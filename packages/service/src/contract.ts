import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
    const client = new Client({ name: "contract", version: "1.0.0" });
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

/**
 * JSON Schema has two spellings for "a string or null": `anyOf: [{type: "string"}, {type: "null"}]`
 * and `type: ["string", "null"]`. They accept the same values; Zod switched from the first to
 * the second between releases. Comparing the surface folds the first into the second, so a
 * library upgrade that only changes the spelling is not mistaken for a contract change.
 */
function foldNullableTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(foldNullableTypes);
  if (node === null || typeof node !== "object") return node;

  const folded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) folded[key] = foldNullableTypes(value);

  // The order of a type list carries no meaning, and Zod has emitted it both ways.
  if (Array.isArray(folded.type)) folded.type = [...folded.type].sort();

  const { anyOf, ...rest } = folded;
  if (!Array.isArray(anyOf)) return folded;
  const types: string[] = [];
  for (const branch of anyOf) {
    const keys = branch !== null && typeof branch === "object" ? Object.keys(branch) : [];
    const type = (branch as { type?: unknown }).type;
    if (keys.length !== 1 || typeof type !== "string") return folded;
    types.push(type);
  }
  if ("type" in rest) return folded;
  return { ...rest, type: types.sort() };
}

/** The surface without the version, which is what has to be identical between two releases. */
export function surfaceOf(contract: Contract): Omit<Contract, "version"> {
  const { version: _version, ...surface } = contract;
  return foldNullableTypes(surface) as Omit<Contract, "version">;
}
