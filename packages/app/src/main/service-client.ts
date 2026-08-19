import { z } from "zod";
import { FileCheckoffSchema, QuestionReplySchema, QuestionSchema, ReviewStateSchema, type FileCheckoff, type NewQuestion, type PrContext, type PutFileState, type Question, type QuestionReply, type ReviewState } from "@gander/shared";
import { checkServiceStatus, type ServiceStatus } from "./connection.js";

export class ServiceConnectionError extends Error {}
export const STALE_SERVICE_DATA_WRITE_ERROR = "This review is showing cached service data. Refresh it after the service reconnects before making changes. This change was not saved and will not be retried.";

export interface ServiceClient {
  getReview(repoId: string, prNumber: number): Promise<ReviewState>;
  listReviews(repoId: string): Promise<ReviewState[]>;
  putFileState(repoId: string, prNumber: number, input: PutFileState): Promise<FileCheckoff>;
  listQuestions(repoId: string, prNumber: number): Promise<Question[]>;
  addQuestion(repoId: string, prNumber: number, input: NewQuestion): Promise<Question>;
  addReviewerReply(repoId: string, prNumber: number, id: number, text: string): Promise<QuestionReply>;
  deleteQuestion(repoId: string, prNumber: number, id: number): Promise<void>;
  setPrContext(repoId: string, prNumber: number, context: PrContext): Promise<void>;
  getSnapshot(repoId: string, prNumber: number, path: string): Promise<{ baseContent: string | null; headContent: string | null }>;
  /** Reachability and API compatibility. Never throws — connection failure is a status. */
  status(): Promise<ServiceStatus>;
}

const SnapshotSchema = z.object({
  baseContent: z.string().nullable(),
  headContent: z.string().nullable(),
});

/**
 * Where to reach the service, read on every request rather than captured once: the
 * reviewer can enter or change the connection in settings while the app is running, and
 * a client built at startup would go on talking to the old address until a restart.
 */
export type Connection = () => { url: string; token: string };

export function createServiceClient(connection: Connection): ServiceClient {
  let checkedConnection: { url: string; status: ServiceStatus } | null = null;
  let recoveryReadRequired = false;
  const reviewsReadSinceRecovery = new Set<string>();
  const reviewKey = (repoId: string, prNumber: number): string => `${repoId}#${prNumber}`;

  function requireRecoveryReads(): void {
    recoveryReadRequired = true;
    reviewsReadSinceRecovery.clear();
  }

  async function serviceStatus(): Promise<ServiceStatus> {
    const { url } = connection();
    const connectionChanged = checkedConnection !== null && checkedConnection.url !== url;
    const status = await checkServiceStatus(url);
    checkedConnection = { url, status };
    if (connectionChanged || status.state === "unreachable" || status.state === "incompatible") requireRecoveryReads();
    return status;
  }

  async function ensureCompatible(baseUrl: string): Promise<void> {
    const cached = checkedConnection?.url === baseUrl ? checkedConnection.status : null;
    // A later explicit action is a new connection attempt, not a retry of the failed
    // write. Re-probing here is what lets the app recover as soon as the service returns.
    const status = cached?.state === "connected" || cached?.state === "newer"
      ? cached
      : await serviceStatus();
    if (status.state === "unreachable") throw new ServiceConnectionError(status.reason);
    if (status.state === "incompatible") throw new ServiceConnectionError(status.reason);
  }

  const req = async (
    method: string,
    path: string,
    body?: unknown,
    options: { allowBeforeRecoveryRead?: boolean; reviewKey?: string } = {},
  ): Promise<unknown> => {
    const { url: baseUrl, token } = connection();
    if (baseUrl === "") throw new Error("No Gander service configured — set the service URL and token in Settings");
    try {
      await ensureCompatible(baseUrl);
    } catch (err) {
      if (err instanceof ServiceConnectionError && method !== "GET") {
        throw new ServiceConnectionError(`${err.message} This change was not saved and will not be retried.`);
      }
      throw err;
    }
    if (method !== "GET" && recoveryReadRequired && !options.allowBeforeRecoveryRead
      && (options.reviewKey === undefined || !reviewsReadSinceRecovery.has(options.reviewKey))) {
      throw new ServiceConnectionError(STALE_SERVICE_DATA_WRITE_ERROR);
    }
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      checkedConnection = { url: baseUrl, status: { state: "unreachable", reason: `Could not reach ${baseUrl}: ${(err as Error).message}` } };
      requireRecoveryReads();
      const consequence = method === "GET" ? "" : " This change was not saved and will not be retried.";
      throw new ServiceConnectionError(`Gander service unreachable at ${baseUrl}: ${(err as Error).message}.${consequence}`);
    }
    if (!res.ok) throw new Error(`Gander service ${res.status} on ${method} ${baseUrl}${path}: ${await res.text()}`);
    // 204 has no body — reading it as JSON would throw on a successful delete.
    if (res.status === 204) return undefined;
    return res.json();
  };
  // Cross-machine review state is the product's core promise: a version-skewed or
  // corrupted service response must fail loudly here, not get cast past the zod schemas
  // that already exist and flow into the hash comparison in review.ts as if it were valid.
  function validate<T>(schema: z.ZodType<T>, path: string, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const problem = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`Gander service at ${connection().url}${path} returned data that failed validation: ${problem}`);
    }
    return parsed.data;
  }
  const enc = encodeURIComponent;
  return {
    getReview: async (repoId, prNumber) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}`;
      const review = validate(ReviewStateSchema, path, await req("GET", path));
      reviewsReadSinceRecovery.add(reviewKey(repoId, prNumber));
      return review;
    },
    listReviews: async (repoId) => {
      const path = `/api/reviews/${enc(repoId)}`;
      return validate(ReviewStateSchema.array(), path, await req("GET", path));
    },
    putFileState: async (repoId, prNumber, input) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/files`;
      return validate(FileCheckoffSchema, path, await req("PUT", path, input, { reviewKey: reviewKey(repoId, prNumber) }));
    },
    listQuestions: async (repoId, prNumber) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/questions`;
      return validate(QuestionSchema.array(), path, await req("GET", path));
    },
    addQuestion: async (repoId, prNumber, input) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/questions`;
      return validate(QuestionSchema, path, await req("POST", path, input, { reviewKey: reviewKey(repoId, prNumber) }));
    },
    addReviewerReply: async (repoId, prNumber, id, text) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/questions/${id}/replies`;
      return validate(QuestionReplySchema, path, await req("POST", path, { text }, { reviewKey: reviewKey(repoId, prNumber) }));
    },
    deleteQuestion: async (repoId, prNumber, id) => {
      await req("DELETE", `/api/reviews/${enc(repoId)}/${prNumber}/questions/${id}`, undefined, { reviewKey: reviewKey(repoId, prNumber) });
    },
    status: serviceStatus,
    getSnapshot: async (repoId, prNumber, path) => {
      const url = `/api/reviews/${enc(repoId)}/${prNumber}/snapshot?path=${enc(path)}`;
      return validate(SnapshotSchema, url, await req("GET", url));
    },
    setPrContext: async (repoId, prNumber, context) => {
      // Refresh records derived GitHub context before reading authored review state. It
      // never copies cached authored data, so it is safe on the recovery path.
      await req("PUT", `/api/reviews/${enc(repoId)}/${prNumber}/context`, context, { allowBeforeRecoveryRead: true });
    },
  };
}
