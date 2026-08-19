export const DEFAULT_REPLY_WAIT_SECONDS = 30;
export const MAX_REPLY_WAIT_SECONDS = 30;
export const MAX_REPLY_WAITERS = 32;
export const MAX_REPLY_WAITERS_PER_REVIEW = 4;

export type ReplyWaitOutcome = "reply" | "timeout" | "cancelled";

interface Waiter {
  afterCursor: number;
  finish: (outcome: ReplyWaitOutcome) => void;
}

export class ReplyWaitLimitError extends Error {}

/**
 * In-memory wakeups are sufficient because every reviewer write and MCP request
 * goes through this service process. SQLite owns the durable cursor; this pool
 * only avoids repeatedly querying it while a request is held open.
 */
export class ReviewerReplyWaiters {
  readonly #byReview = new Map<string, Set<Waiter>>();
  #total = 0;

  constructor(
    private readonly limits = {
      total: MAX_REPLY_WAITERS,
      perReview: MAX_REPLY_WAITERS_PER_REVIEW,
    },
  ) {}

  get activeCount(): number {
    return this.#total;
  }

  wait(
    reviewKey: string,
    afterCursor: number,
    currentCursor: () => number,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<ReplyWaitOutcome> {
    // The cursor check and registration are synchronous in one event-loop turn.
    // A reply cannot land between them, which closes the usual long-poll race.
    if (currentCursor() > afterCursor) return Promise.resolve("reply");

    const existing = this.#byReview.get(reviewKey);
    if (this.#total >= this.limits.total) {
      throw new ReplyWaitLimitError(`The service already has ${this.limits.total} reply waits open. Try again after one finishes.`);
    }
    if ((existing?.size ?? 0) >= this.limits.perReview) {
      throw new ReplyWaitLimitError(`This pull request already has ${this.limits.perReview} reply waits open. Try again after one finishes.`);
    }

    return new Promise((resolve) => {
      const waiters = existing ?? new Set<Waiter>();
      if (existing === undefined) this.#byReview.set(reviewKey, waiters);

      let finished = false;
      let timer: NodeJS.Timeout;
      const waiter: Waiter = {
        afterCursor,
        finish: (outcome) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          waiters.delete(waiter);
          this.#total -= 1;
          if (waiters.size === 0) this.#byReview.delete(reviewKey);
          resolve(outcome);
        },
      };
      const onAbort = () => waiter.finish("cancelled");

      waiters.add(waiter);
      this.#total += 1;
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => waiter.finish("timeout"), timeoutMs);
      timer.unref();

      if (signal.aborted) onAbort();
    });
  }

  publish(reviewKey: string, cursor: number): void {
    const waiters = this.#byReview.get(reviewKey);
    if (waiters === undefined) return;
    for (const waiter of [...waiters]) {
      if (cursor > waiter.afterCursor) waiter.finish("reply");
    }
  }

  close(): void {
    for (const waiters of [...this.#byReview.values()]) {
      for (const waiter of [...waiters]) waiter.finish("cancelled");
    }
  }
}

export const reviewWaitKey = (repo: string, prNumber: number): string => `${repo}\0${prNumber}`;
