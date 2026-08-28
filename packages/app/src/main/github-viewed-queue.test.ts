import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubViewedQueue, type GithubAccount, type GithubViewedSyncStatus } from "./github-viewed-queue.js";

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
});
