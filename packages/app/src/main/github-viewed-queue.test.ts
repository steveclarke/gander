import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JOB_AGE_MS, createGithubViewedQueue, type GithubAccount, type GithubViewedSyncStatus } from "./github-viewed-queue.js";

const account: GithubAccount = { apiUrl: "https://api.github.com", login: "reviewer" };
let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gander-github-viewed-"));
  path = join(dir, "queue.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function queue(overrides: Partial<Parameters<typeof createGithubViewedQueue>[0]> = {}) {
  return createGithubViewedQueue({
    path,
    currentAccount: async () => account,
    send: async () => {},
    pullRequestOpen: async () => true,
    retryable: () => false,
    onStatus: () => {},
    retryDelay: () => 1,
    ...overrides,
  });
}

describe("GitHub Viewed queue", () => {
  it("does not resolve GitHub credentials when there is no work", async () => {
    const currentAccount = vi.fn(async () => account);
    const viewedQueue = queue({ currentAccount });
    viewedQueue.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(currentAccount).not.toHaveBeenCalled();
    viewedQueue.stop();
  });

  it("persists jobs and coalesces rapid toggles to the latest state", async () => {
    const first = queue();
    first.enqueue(account, "PR_1", ["a.ts"], true);
    first.enqueue(account, "PR_1", ["a.ts"], false);
    expect(first.status().pending).toBe(1);

    const calls: Array<{ path: string; viewed: boolean }> = [];
    const resumed = queue({ send: async (job) => { calls.push({ path: job.path, viewed: job.viewed }); } });
    resumed.start();

    await vi.waitFor(() => expect(calls).toEqual([{ path: "a.ts", viewed: false }]));
    await vi.waitFor(() => expect(resumed.status().pending).toBe(0));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, jobs: [] });
    resumed.stop();
  });

  it("does not discard a newer toggle when an older request finishes", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const calls: boolean[] = [];
    const viewedQueue = queue({
      send: async (job) => {
        calls.push(job.viewed);
        if (calls.length === 1) await blocked;
      },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();
    await vi.waitFor(() => expect(calls).toEqual([true]));

    viewedQueue.enqueue(account, "PR_1", ["a.ts"], false);
    release();

    await vi.waitFor(() => expect(calls).toEqual([true, false]));
    await vi.waitFor(() => expect(viewedQueue.status().pending).toBe(0));
    viewedQueue.stop();
  });

  it("retries transient failures until the mirror succeeds", async () => {
    let attempts = 0;
    const viewedQueue = queue({
      send: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary outage");
      },
      retryable: (error) => (error as Error).message === "temporary outage",
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();

    await vi.waitFor(() => expect(attempts).toBe(2));
    await vi.waitFor(() => expect(viewedQueue.status()).toEqual({ pending: 0, failed: 0, message: null }));
    viewedQueue.stop();
  });

  it("retains permanent failures and reports that the Gander review is saved", async () => {
    const statuses: GithubViewedSyncStatus[] = [];
    const viewedQueue = queue({
      send: async () => { throw new Error("Bad credentials"); },
      onStatus: (status) => { statuses.push(status); },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();

    await vi.waitFor(() => expect(viewedQueue.status().failed).toBe(1));
    expect(viewedQueue.status().message).toMatch(/a\.ts.*Bad credentials.*Gander review is saved/s);
    expect(statuses.at(-1)?.failed).toBe(1);
    viewedQueue.stop();
  });

  it("turns a permanent credential failure into visible failed work", async () => {
    const viewedQueue = queue({
      currentAccount: async () => { throw new Error("GitHub API 401: Bad credentials"); },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();

    await vi.waitFor(() => expect(viewedQueue.status().failed).toBe(1));
    expect(viewedQueue.status().message).toContain("Bad credentials");
    viewedQueue.stop();
  });

  it("only sends jobs for the currently authenticated account", async () => {
    const other = { ...account, login: "someone-else" };
    const calls: string[] = [];
    let current = other;
    const viewedQueue = queue({
      currentAccount: async () => current,
      send: async (job) => { calls.push(job.account.login); },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual([]);

    current = account;
    viewedQueue.retryFailed();
    await vi.waitFor(() => expect(calls).toEqual(["reviewer"]));
    viewedQueue.stop();
  });

  it("retries failed marks once when the app starts", async () => {
    const first = queue({ send: async () => { throw new Error("Bad credentials"); } });
    first.enqueue(account, "PR_1", ["a.ts"], true);
    first.start();
    await vi.waitFor(() => expect(first.status().failed).toBe(1));
    first.stop();

    const calls: string[] = [];
    const relaunched = queue({ send: async (job) => { calls.push(job.path); } });
    relaunched.start();
    await vi.waitFor(() => expect(calls).toEqual(["a.ts"]));
    await vi.waitFor(() => expect(relaunched.status()).toEqual({ pending: 0, failed: 0, message: null }));
    relaunched.stop();
  });

  it("drops a mark quietly when its pull request has closed or merged", async () => {
    const statuses: GithubViewedSyncStatus[] = [];
    const viewedQueue = queue({
      send: async () => { throw new Error("Something went wrong while executing your query"); },
      pullRequestOpen: async () => false,
      onStatus: (status) => { statuses.push(status); },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();

    await vi.waitFor(() => expect(viewedQueue.status()).toEqual({ pending: 0, failed: 0, message: null }));
    expect(statuses.some((status) => status.failed > 0)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, jobs: [] });
    viewedQueue.stop();
  });

  it("keeps a mark when GitHub cannot say whether its pull request is open", async () => {
    const viewedQueue = queue({
      send: async () => { throw new Error("Bad credentials"); },
      pullRequestOpen: async () => { throw new Error("Could not reach GitHub"); },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();

    await vi.waitFor(() => expect(viewedQueue.status().failed).toBe(1));
    viewedQueue.stop();
  });

  it("drops a mark still failing a week after it was queued", async () => {
    let clock = 1_000;
    let attempts = 0;
    const viewedQueue = queue({
      now: () => clock,
      send: async () => { attempts += 1; throw new Error("Something went wrong while executing your query"); },
      retryable: () => true,
      retryDelay: () => 0,
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();
    await vi.waitFor(() => expect(attempts).toBeGreaterThan(1));
    expect(viewedQueue.status().pending).toBe(1);

    clock += MAX_JOB_AGE_MS + 1;
    await vi.waitFor(() => expect(viewedQueue.status()).toEqual({ pending: 0, failed: 0, message: null }));
    viewedQueue.stop();
  });

  it("ages out a failure from a queue written before jobs carried their age", async () => {
    // The shape a stuck queue had on disk: two failed marks, queued long ago.
    const failed = (file: string, revision: number) => ({
      account, pullRequestId: "PR_1", path: file, viewed: true, revision,
      attempts: 1, nextAttemptAt: 1_000, state: "failed", error: "GitHub GraphQL: Something went wrong while executing your query",
    });
    writeFileSync(path, JSON.stringify({ version: 1, jobs: [failed("a.ts", 1), failed("b.ts", 2)] }));
    const calls: string[] = [];
    const viewedQueue = queue({
      now: () => 1_000 + MAX_JOB_AGE_MS + 1,
      send: async (job) => { calls.push(job.path); throw new Error("Something went wrong while executing your query"); },
    });
    viewedQueue.start();

    await vi.waitFor(() => expect(viewedQueue.status()).toEqual({ pending: 0, failed: 0, message: null }));
    expect(calls.sort()).toEqual(["a.ts", "b.ts"]);
    viewedQueue.stop();
  });

  it("dismisses failed marks and leaves pending ones", async () => {
    const statuses: GithubViewedSyncStatus[] = [];
    let fail = true;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const viewedQueue = queue({
      send: async (job) => {
        if (job.path === "a.ts" && fail) throw new Error("Bad credentials");
        await held;
      },
      onStatus: (status) => { statuses.push(status); },
    });
    viewedQueue.enqueue(account, "PR_1", ["a.ts"], true);
    viewedQueue.start();
    await vi.waitFor(() => expect(viewedQueue.status().failed).toBe(1));
    fail = false;
    viewedQueue.enqueue(account, "PR_1", ["b.ts"], true);

    viewedQueue.dismissFailed();
    expect(viewedQueue.status()).toEqual({ pending: 1, failed: 0, message: null });
    expect(statuses.at(-1)).toEqual({ pending: 1, failed: 0, message: null });
    release();
    await vi.waitFor(() => expect(viewedQueue.status().pending).toBe(0));
    viewedQueue.stop();
  });
});
