import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Storage } from "./storage.js";

/**
 * The MCP contract is deliberately tiny: agents read the reviewer's notes, reply,
 * and say when they have acted on one. Nothing here reads diffs, lists files, touches
 * checkoffs, or resolves a note — resolution is the reviewer's act alone, made in
 * the app by re-checking the file. Agents already have git and gh for code; this carries
 * only the conversation.
 */
export function buildMcpServer(storage: Storage, version: string): McpServer {
  const server = new McpServer({ name: "gander", version });

  /** Agents know their own repository and branch; the pull request number they usually don't. */
  function resolvePr(repo: string, prNumber?: number, branch?: string): number | string {
    if (prNumber !== undefined) return prNumber;
    if (branch === undefined) return "Pass either prNumber or branch.";
    const found = storage.findPrByHeadRef(repo, branch);
    if (found === null) {
      return `No review in Gander for branch ${branch} on ${repo}. The pull request has to be opened in Gander once before its notes can be read.`;
    }
    return found;
  }

  server.registerTool(
    "get_review_notes",
    {
      title: "Get review notes",
      description:
        "Notes the reviewer has left on a pull request, with the file and line each one is about. " +
        "Derive repo and branch from the working directory. Returns open notes by default — those are the ones still needing work. " +
        "The response always counts open, addressed, and resolved notes so hidden states are visible. " +
        "The response names the branch, title, and stack position of the pull request the notes belong to: check it matches the checkout being worked in, " +
        "because a stacked pull request's sibling is a different branch with different notes.",
      inputSchema: {
        repo: z.string().describe('Repository as "owner/name", e.g. "acme/atlas".'),
        branch: z.string().optional().describe("The working branch. Use this when the pull request number is unknown."),
        prNumber: z.number().int().positive().optional().describe("Pull request number, if known."),
        includeAddressed: z.boolean().optional().describe("Also return notes already marked addressed. Defaults to false."),
        includeResolved: z.boolean().optional().describe("Also return notes the reviewer has resolved. Defaults to false."),
      },
    },
    async ({ repo, branch, prNumber, includeAddressed, includeResolved }) => {
      const resolved = resolvePr(repo, prNumber, branch);
      if (typeof resolved === "string") return { content: [{ type: "text", text: resolved }], isError: true };

      const context = storage.getPrContext(repo, resolved);
      const members = context?.stackId == null ? [] : storage.listStackMembers(repo, context.stackId);
      const wanted = new Set(["open"]);
      if (includeAddressed === true) wanted.add("addressed");
      if (includeResolved === true) wanted.add("resolved");
      const allNotes = storage.listNotes(repo, resolved);
      const noteCounts: Record<"open" | "addressed" | "resolved", number> = { open: 0, addressed: 0, resolved: 0 };
      for (const note of allNotes) noteCounts[note.state] += 1;
      const notes = allNotes
        .filter((q) => wanted.has(q.state))
        .map((q) => ({
          id: q.id,
          file: q.path,
          line: q.line,
          text: q.text,
          state: q.state,
          replies: q.replies.map((reply) => ({
            id: reply.id,
            author: reply.author,
            text: reply.text,
            createdAt: reply.createdAt,
          })),
          ...(q.state === "open" ? {} : { commitRef: q.commitRef, summary: q.summary }),
          capturedAtSha: q.headSha,
          // The branch may have moved since the reviewer read it, in which case the line
          // number is the one they saw, not necessarily the one there now.
          lineMayHaveMoved: q.headSha !== null && context !== null && q.headSha !== context.headSha,
        }));

      const hiddenStates = (["addressed", "resolved"] as const)
        .filter((state) => !wanted.has(state) && noteCounts[state] > 0);
      let message: string;
      if (notes.length === 0 && hiddenStates.length > 0) {
        const includeFlag = { addressed: "includeAddressed", resolved: "includeResolved" } as const;
        const hiddenCount = hiddenStates.reduce((total, state) => total + noteCounts[state], 0);
        const hidden = hiddenStates
          .map((state) => `${noteCounts[state]} ${state} note${noteCounts[state] === 1 ? "" : "s"}`)
          .join(" and ");
        const flags = hiddenStates.map((state) => `${includeFlag[state]}: true`).join(" and ");
        message = `No ${[...wanted].join(" or ")} notes returned. ${hidden} ${hiddenCount === 1 ? "is" : "are"} hidden; pass ${flags} to retrieve ${hiddenCount === 1 ? "it" : "them"}.`;
      } else if (notes.length === 0 && allNotes.length === 0) {
        message = "No notes exist for this pull request.";
      } else {
        message = `Returned ${notes.length} of ${allNotes.length} note${allNotes.length === 1 ? "" : "s"} on this pull request.`;
      }

      const payload = {
        repo,
        prNumber: resolved,
        // Everything an agent needs to say — and check — which pull request it is on.
        branch: context?.headRef ?? null,
        title: context?.title ?? null,
        headSha: context?.headSha ?? null,
        noteCounts,
        message,
        stack: context?.stackSize == null || context.stackPosition == null
          ? null
          : {
              position: context.stackPosition,
              size: context.stackSize,
              // Named so an agent that asked about its own branch can see where the rest
              // of the reviewer's notes are, instead of guessing pull request numbers.
              members: members.map((m) => ({
                prNumber: m.prNumber, branch: m.headRef, title: m.title,
                position: m.position, openNotes: m.openNotes,
              })),
            },
        notes,
      };

      // A stacked pull request splits one piece of work across branches, and the reviewer
      // reads whichever branch holds the code. Saying nothing here is what sent an agent
      // hunting through pull request numbers by hand.
      const elsewhere = members.filter((m) => m.prNumber !== resolved && m.openNotes > 0);
      const hint = notes.length === 0 && elsewhere.length > 0
        ? `\n\nNo open notes on this pull request, but this stack has some on: ${
            elsewhere.map((m) => `#${m.prNumber} (${m.headRef ?? "unknown branch"}, ${m.openNotes} open)`).join(", ")
          }. Call this tool again with that prNumber to read them.`
        : "";

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) + hint }] };
    },
  );

  server.registerTool(
    "reply_to_note",
    {
      title: "Reply to a review note",
      description:
        "Add an agent reply to a review note. Use this for clarification, reasoning, or a response that should remain with the review. " +
        "Replying does not address or resolve the note and does not change its lifecycle state.",
      inputSchema: {
        id: z.number().int().positive().describe("Note id from get_review_notes."),
        text: z.string().trim().min(1).describe("The reply to add to the note thread."),
      },
    },
    async ({ id, text }) => {
      const added = storage.addAgentReply(id, { text });
      if (added === null) {
        return {
          content: [{ type: "text", text: `Note ${id} does not exist.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Reply added to note ${id}. Its state was not changed.` }] };
    },
  );

  server.registerTool(
    "mark_note_addressed",
    {
      title: "Mark a review note addressed",
      description:
        "Record that a note has been acted on. Use it only once the work is actually done and committed. " +
        "This does not resolve the note — the reviewer resolves it by re-reviewing the file.",
      inputSchema: {
        id: z.number().int().positive().describe("Note id from get_review_notes."),
        commitRef: z.string().optional().describe("Commit that addressed it."),
        summary: z.string().optional().describe("One line on what changed."),
      },
    },
    async ({ id, commitRef, summary }) => {
      const marked = storage.markNoteAddressed(id, { commitRef: commitRef ?? null, summary: summary ?? null });
      if (marked === null) {
        return {
          content: [{ type: "text", text: `Note ${id} is not open — it does not exist, or it was already addressed or resolved.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Note ${id} marked addressed.` }] };
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
