import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export interface GithubAccount {
  apiUrl: string;
  login: string;
}

export interface GithubViewedSyncStatus {
  pending: number;
  failed: number;
  message: string | null;
}

const AccountSchema = z.object({ apiUrl: z.string().url(), login: z.string().min(1) }).strict();
const JobSchema = z.object({
  account: AccountSchema,
  pullRequestId: z.string().min(1),
  path: z.string().min(1),
  viewed: z.boolean(),
  revision: z.number().int().positive(),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative(),
  state: z.enum(["pending", "failed"]),
  error: z.string().nullable(),
}).strict();
const QueueFileSchema = z.object({ version: z.literal(1), jobs: z.array(JobSchema) }).strict();
type Job = z.infer<typeof JobSchema>;

export interface GithubViewedQueue {
  enqueue(account: GithubAccount, pullRequestId: string, paths: string[], viewed: boolean): void;
  start(): void;
  stop(): void;
  retryFailed(): void;
  status(): GithubViewedSyncStatus;
}

interface QueueDeps {
  path: string;
  currentAccount(): Promise<GithubAccount>;
  send(job: Pick<Job, "account" | "pullRequestId" | "path" | "viewed">): Promise<void>;
  retryable(error: unknown): boolean;
  onStatus(status: GithubViewedSyncStatus): void;
  now?: () => number;
  retryDelay?: (attempts: number) => number;
}

const sameAccount = (left: GithubAccount, right: GithubAccount): boolean =>
  left.apiUrl === right.apiUrl && left.login === right.login;
const sameTarget = (left: Job, account: GithubAccount, pullRequestId: string, path: string): boolean =>
  sameAccount(left.account, account) && left.pullRequestId === pullRequestId && left.path === path;

function loadJobs(path: string): Job[] {
  if (!existsSync(path)) return [];
  const parsed = QueueFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "queue"}: ${issue.message}`).join(", ");
    throw new Error(`Invalid GitHub Viewed queue at ${path}: ${detail}`);
  }
  return parsed.data.jobs;
}

function saveJobs(path: string, jobs: Job[]): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, jobs }, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function createGithubViewedQueue(deps: QueueDeps): GithubViewedQueue {
  const now = deps.now ?? Date.now;
  const retryDelay = deps.retryDelay ?? ((attempts: number) => Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 300_000));
  let jobs = loadJobs(deps.path);
  let revision = jobs.reduce((largest, job) => Math.max(largest, job.revision), 0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = true;
  let workerError: string | null = null;

  function status(): GithubViewedSyncStatus {
    const pending = jobs.filter((job) => job.state === "pending").length;
    const failures = jobs.filter((job) => job.state === "failed");
    const first = failures[0];
    return {
      pending,
      failed: failures.length,
      message: first
        ? `GitHub Viewed sync failed for ${first.path}: ${first.error ?? "Unknown error"}. The Gander review is saved.`
        : workerError,
    };
  }

  function publish(): void {
    deps.onStatus(status());
  }

  function persist(): void {
    saveJobs(deps.path, jobs);
    publish();
  }

  function schedule(delay = 0): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  async function drain(): Promise<void> {
    if (stopped || running) return;
    running = true;
    let scheduleAfter: number | null = null;
    try {
      if (!jobs.some((job) => job.state === "pending")) {
        publish();
        return;
      }
      let account: GithubAccount;
      try {
        account = await deps.currentAccount();
        workerError = null;
      } catch (error) {
        const detail = (error as Error).message;
        if (deps.retryable(error)) {
          workerError = `GitHub Viewed sync is waiting: ${detail}`;
          publish();
          scheduleAfter = retryDelay(1);
        } else {
          workerError = null;
          for (const job of jobs) {
            if (job.state !== "pending") continue;
            job.state = "failed";
            job.error = detail;
          }
          persist();
        }
        return;
      }

      const candidates = jobs
        .filter((job) => job.state === "pending" && sameAccount(job.account, account))
        .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt);
      const job = candidates[0];
      if (!job) {
        publish();
        return;
      }
      const wait = job.nextAttemptAt - now();
      if (wait > 0) {
        scheduleAfter = wait;
        return;
      }

      const snapshot = { ...job, account: { ...job.account } };
      try {
        await deps.send(snapshot);
        jobs = jobs.filter((candidate) => !(sameTarget(candidate, snapshot.account, snapshot.pullRequestId, snapshot.path)
          && candidate.revision === snapshot.revision));
        persist();
        scheduleAfter = 0;
      } catch (error) {
        const current = jobs.find((candidate) => sameTarget(candidate, snapshot.account, snapshot.pullRequestId, snapshot.path));
        if (!current || current.revision !== snapshot.revision) {
          scheduleAfter = 0;
          return;
        }
        current.attempts += 1;
        current.error = (error as Error).message;
        if (deps.retryable(error)) {
          current.nextAttemptAt = now() + retryDelay(current.attempts);
          scheduleAfter = retryDelay(current.attempts);
        } else {
          current.state = "failed";
          scheduleAfter = 0;
        }
        persist();
      }
    } finally {
      running = false;
      if (scheduleAfter !== null) schedule(scheduleAfter);
    }
  }

  return {
    enqueue(account, pullRequestId, paths, viewed) {
      for (const path of paths) {
        jobs = jobs.filter((job) => !sameTarget(job, account, pullRequestId, path));
        jobs.push({
          account: { ...account }, pullRequestId, path, viewed,
          revision: ++revision, attempts: 0, nextAttemptAt: now(), state: "pending", error: null,
        });
      }
      persist();
      schedule();
    },
    start() {
      stopped = false;
      publish();
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    retryFailed() {
      for (const job of jobs) {
        if (job.state !== "failed") continue;
        job.state = "pending";
        job.attempts = 0;
        job.nextAttemptAt = now();
        job.error = null;
      }
      persist();
      schedule();
    },
    status,
  };
}
