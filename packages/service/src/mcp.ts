import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  DEFAULT_REPLY_WAIT_SECONDS,
  MAX_REPLY_WAIT_SECONDS,
  ReplyWaitLimitError,
  ReviewerReplyWaiters,
  reviewWaitKey,
} from "./reply-waiters.js";
import type { Storage } from "./storage.js";

export const GANDER_MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * The MCP contract is deliberately tiny: agents read the reviewer's questions, reply,
 * and say when they have acted on one. Nothing here reads diffs, lists files, touches
 * checkoffs, or resolves a question — resolution is the reviewer's act alone, made in
 * the app by re-checking the file. Agents already have git and gh for code; this carries
 * only the conversation.
 */
export function buildMcpServer(storage: Storage, version: string, replyWaiters: ReviewerReplyWaiters): McpServer {
  const server = new McpServer(
    { name: "gander", version },
    { supportedProtocolVersions: [GANDER_MCP_PROTOCOL_VERSION] },
  );

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
        "The response always counts open, addressed, and resolved questions so hidden states are visible. " +
        "To wait without polling, pass a previous response's replyCursor as afterReplyCursor; after a timeout, repeat with the latest returned cursor. " +
        "The response names the branch, title, and stack position of the pull request the questions belong to: check it matches the checkout being worked in, " +
        "because a stacked pull request's sibling is a different branch with different questions.",
      inputSchema: {
        repo: z.string().describe('Repository as "owner/name", e.g. "acme/atlas".'),
        branch: z.string().optional().describe("The working branch. Use this when the pull request number is unknown."),
        prNumber: z.number().int().positive().optional().describe("Pull request number, if known."),
        includeAddressed: z.boolean().optional().describe("Also return questions already marked addressed. Defaults to false."),
        includeResolved: z.boolean().optional().describe("Also return questions the reviewer has resolved. Defaults to false."),
        afterReplyCursor: z.number().int().nonnegative().optional().describe(
          `Wait for a reviewer reply newer than this tool's previous replyCursor. The wait is scoped to the resolved pull request and lasts at most ${DEFAULT_REPLY_WAIT_SECONDS} seconds by default.`,
        ),
        waitSeconds: z.number().int().min(1).max(MAX_REPLY_WAIT_SECONDS).optional().describe(
          `How long to wait when afterReplyCursor is present. Defaults to ${DEFAULT_REPLY_WAIT_SECONDS}; maximum ${MAX_REPLY_WAIT_SECONDS}.`,
        ),
      },
    },
    async ({ repo, branch, prNumber, includeAddressed, includeResolved, afterReplyCursor, waitSeconds }, { mcpReq }) => {
      const resolved = resolvePr(repo, prNumber, branch);
      if (typeof resolved === "string") return { content: [{ type: "text", text: resolved }], isError: true };

      if (waitSeconds !== undefined && afterReplyCursor === undefined) {
        return { content: [{ type: "text", text: "waitSeconds requires afterReplyCursor from an earlier response." }], isError: true };
      }
      const cursorBeforeWait = storage.getReviewerReplyCursor(repo, resolved);
      if (afterReplyCursor !== undefined && afterReplyCursor > cursorBeforeWait) {
        return {
          content: [{ type: "text", text: `afterReplyCursor ${afterReplyCursor} is ahead of this pull request's current replyCursor ${cursorBeforeWait}. Start again without afterReplyCursor.` }],
          isError: true,
        };
      }

      const effectiveWaitSeconds = waitSeconds ?? DEFAULT_REPLY_WAIT_SECONDS;
      let waitOutcome: "reply" | "timeout" | undefined;
      if (afterReplyCursor !== undefined) {
        try {
          const outcome = await replyWaiters.wait(
            reviewWaitKey(repo, resolved),
            afterReplyCursor,
            () => storage.getReviewerReplyCursor(repo, resolved),
            effectiveWaitSeconds * 1_000,
            mcpReq.signal,
          );
          if (outcome === "cancelled") {
            return { content: [{ type: "text", text: "Reply wait cancelled." }], isError: true };
          }
          waitOutcome = outcome;
        } catch (error) {
          if (error instanceof ReplyWaitLimitError) {
            return { content: [{ type: "text", text: error.message }], isError: true };
          }
          throw error;
        }
      }

      const context = storage.getPrContext(repo, resolved);
      const members = context?.stackId == null ? [] : storage.listStackMembers(repo, context.stackId);
      const wanted = new Set(["open"]);
      if (includeAddressed === true) wanted.add("addressed");
      if (includeResolved === true) wanted.add("resolved");
      const allQuestions = storage.listQuestions(repo, resolved);
      const questionCounts: Record<"open" | "addressed" | "resolved", number> = { open: 0, addressed: 0, resolved: 0 };
      for (const question of allQuestions) questionCounts[question.state] += 1;
      const questions = allQuestions
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
          ...(q.state === "open" ? {} : { commitRef: q.commitRef, note: q.note }),
          capturedAtSha: q.headSha,
          // The branch may have moved since the reviewer read it, in which case the line
          // number is the one they saw, not necessarily the one there now.
          lineMayHaveMoved: q.headSha !== null && context !== null && q.headSha !== context.headSha,
        }));

      const hiddenStates = (["addressed", "resolved"] as const)
        .filter((state) => !wanted.has(state) && questionCounts[state] > 0);
      let message: string;
      if (questions.length === 0 && hiddenStates.length > 0) {
        const includeFlag = { addressed: "includeAddressed", resolved: "includeResolved" } as const;
        const hiddenCount = hiddenStates.reduce((total, state) => total + questionCounts[state], 0);
        const hidden = hiddenStates
          .map((state) => `${questionCounts[state]} ${state} question${questionCounts[state] === 1 ? "" : "s"}`)
          .join(" and ");
        const flags = hiddenStates.map((state) => `${includeFlag[state]}: true`).join(" and ");
        message = `No ${[...wanted].join(" or ")} questions returned. ${hidden} ${hiddenCount === 1 ? "is" : "are"} hidden; pass ${flags} to retrieve ${hiddenCount === 1 ? "it" : "them"}.`;
      } else if (questions.length === 0 && allQuestions.length === 0) {
        message = "No questions exist for this pull request.";
      } else {
        message = `Returned ${questions.length} of ${allQuestions.length} question${allQuestions.length === 1 ? "" : "s"} on this pull request.`;
      }

      const replyCursor = storage.getReviewerReplyCursor(repo, resolved);
      const payload = {
        repo,
        prNumber: resolved,
        // Per-review and monotonic: pass this exact value as afterReplyCursor on
        // the next call so a reply between calls returns immediately, not after a timeout.
        replyCursor,
        ...(waitOutcome === undefined ? {} : {
          wait: {
            outcome: waitOutcome,
            afterReplyCursor,
            timeoutSeconds: effectiveWaitSeconds,
            message: waitOutcome === "timeout"
              ? `No reviewer reply arrived. To keep waiting, call this tool again with afterReplyCursor: ${replyCursor}.`
              : "A reviewer reply arrived; the question threads in this response are current.",
          },
        }),
        // Everything an agent needs to say — and check — which pull request it is on.
        branch: context?.headRef ?? null,
        title: context?.title ?? null,
        headSha: context?.headSha ?? null,
        questionCounts,
        message,
        stack: context?.stackSize == null || context.stackPosition == null
          ? null
          : {
              position: context.stackPosition,
              size: context.stackSize,
              // Named so an agent that asked about its own branch can see where the rest
              // of the reviewer's questions are, instead of guessing pull request numbers.
              members: members.map((m) => ({
                prNumber: m.prNumber, branch: m.headRef, title: m.title,
                position: m.position, openQuestions: m.openQuestions,
              })),
            },
        questions,
      };

      // A stacked pull request splits one piece of work across branches, and the reviewer
      // reads whichever branch holds the code. Saying nothing here is what sent an agent
      // hunting through pull request numbers by hand.
      const elsewhere = members.filter((m) => m.prNumber !== resolved && m.openQuestions > 0);
      const hint = questions.length === 0 && elsewhere.length > 0
        ? `\n\nNo open questions on this pull request, but this stack has some on: ${
            elsewhere.map((m) => `#${m.prNumber} (${m.headRef ?? "unknown branch"}, ${m.openQuestions} open)`).join(", ")
          }. Call this tool again with that prNumber to read them.`
        : "";

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) + hint }] };
    },
  );

  server.registerTool(
    "reply_to_question",
    {
      title: "Reply to a review question",
      description:
        "Add an agent reply to a review question. Use this for clarification, reasoning, or a response that should remain with the review. " +
        "Replying does not address or resolve the question and does not change its lifecycle state.",
      inputSchema: {
        id: z.number().int().positive().describe("Question id from get_review_questions."),
        text: z.string().trim().min(1).describe("The reply to add to the question thread."),
      },
    },
    async ({ id, text }) => {
      const added = storage.addAgentReply(id, { text });
      if (added === null) {
        return {
          content: [{ type: "text", text: `Question ${id} does not exist.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Reply added to question ${id}. Its state was not changed.` }] };
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

/** Modern MCP is stateless per request, while the handler owns shared stream cleanup. */
export function buildMcpHandler(
  storage: Storage,
  version: string,
  replyWaiters: ReviewerReplyWaiters,
): McpHttpHandler {
  return createMcpHandler(
    () => buildMcpServer(storage, version, replyWaiters),
    {
      // Gander is a new single-user service. Fail loudly rather than preserving
      // protocol behavior that predates the app.
      legacy: "reject",
      maxSubscriptions: 32,
    },
  );
}
