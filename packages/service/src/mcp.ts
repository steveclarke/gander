import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Storage } from "./storage.js";

/**
 * The MCP contract is deliberately tiny: agents read the reviewer's questions and say
 * when they have acted on one. Nothing here reads diffs, lists files, touches checkoffs,
 * or resolves a question — resolution is the reviewer's act alone, made in the app by
 * re-checking the file. Agents already have git and gh for code; this carries only the
 * questions.
 */
export function buildMcpServer(storage: Storage, version: string): McpServer {
  const server = new McpServer({ name: "gander", version });

  /** Agents know their own repository and branch; the pull request number they usually don't. */
  function resolvePr(repo: string, prNumber?: number, branch?: string): number | string {
    if (prNumber !== undefined) return prNumber;
    if (branch === undefined) return "Pass either prNumber or branch.";
    const found = storage.findPrByHeadRef(repo, branch);
    if (found === null) {
      return `No review in Gander for branch ${branch} on ${repo}. The pull request has to be opened in Gander once before its questions can be read.`;
    }
    return found;
  }

  server.registerTool(
    "get_review_questions",
    {
      title: "Get review questions",
      description:
        "Questions the reviewer has left on a pull request, with the file and line each one is about. " +
        "Derive repo and branch from the working directory. Returns open questions by default — those are the ones still needing work. " +
        "The response names the branch, title, and stack position of the pull request the questions belong to: check it matches the checkout being worked in, " +
        "because a stacked pull request's sibling is a different branch with different questions.",
      inputSchema: {
        repo: z.string().describe('Repository as "owner/name", e.g. "acme/atlas".'),
        branch: z.string().optional().describe("The working branch. Use this when the pull request number is unknown."),
        prNumber: z.number().int().positive().optional().describe("Pull request number, if known."),
        includeAddressed: z.boolean().optional().describe("Also return questions already marked addressed. Defaults to false."),
      },
    },
    async ({ repo, branch, prNumber, includeAddressed }) => {
      const resolved = resolvePr(repo, prNumber, branch);
      if (typeof resolved === "string") return { content: [{ type: "text", text: resolved }], isError: true };

      const context = storage.getPrContext(repo, resolved);
      const wanted = includeAddressed === true ? ["open", "addressed"] : ["open"];
      const questions = storage
        .listQuestions(repo, resolved)
        .filter((q) => wanted.includes(q.state))
        .map((q) => ({
          id: q.id,
          file: q.path,
          line: q.line,
          text: q.text,
          state: q.state,
          capturedAtSha: q.headSha,
          // The branch may have moved since the reviewer read it, in which case the line
          // number is the one they saw, not necessarily the one there now.
          lineMayHaveMoved: q.headSha !== null && context !== null && q.headSha !== context.headSha,
        }));

      const payload = {
        repo,
        prNumber: resolved,
        // Everything an agent needs to say — and check — which pull request it is on.
        branch: context?.headRef ?? null,
        title: context?.title ?? null,
        headSha: context?.headSha ?? null,
        stack: context?.stackSize == null || context.stackPosition == null
          ? null
          : { position: context.stackPosition, size: context.stackSize },
        questions,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.registerTool(
    "mark_question_addressed",
    {
      title: "Mark a review question addressed",
      description:
        "Record that a question has been acted on. Use it only once the work is actually done and committed. " +
        "This does not resolve the question — the reviewer resolves it by re-reviewing the file.",
      inputSchema: {
        id: z.number().int().positive().describe("Question id from get_review_questions."),
        commitRef: z.string().optional().describe("Commit that addressed it."),
        note: z.string().optional().describe("One line on what changed."),
      },
    },
    async ({ id, commitRef, note }) => {
      const marked = storage.markQuestionAddressed(id, { commitRef: commitRef ?? null, note: note ?? null });
      if (marked === null) {
        return {
          content: [{ type: "text", text: `Question ${id} is not open — it does not exist, or it was already addressed or resolved.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Question ${id} marked addressed.` }] };
    },
  );

  return server;
}

/**
 * One transport per request, with no session id. Agents connect, ask, and disconnect;
 * nothing here is worth keeping between calls, and statelessness means a restarted
 * service never leaves an agent holding a session it cannot use.
 */
export async function handleMcpRequest(
  storage: Storage,
  version: string,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  body: unknown,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => void transport.close());
  const server = buildMcpServer(storage, version);
  await server.connect(transport);
  // Fastify has already read and parsed the body; handing it over here stops the
  // transport waiting forever on a stream that will never emit again.
  await transport.handleRequest(req, res, body);
}
