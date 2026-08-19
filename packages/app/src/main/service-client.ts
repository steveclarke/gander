import { z } from "zod";
import { FileCheckoffSchema, QuestionReplySchema, QuestionSchema, ReviewStateSchema, type FileCheckoff, type NewQuestion, type PrContext, type PutFileState, type Question, type QuestionReply, type ReviewState } from "@gander/shared";

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
  /** Whether the service answers at all. Never throws — unreachable is an answer, not a failure. */
  healthy(): Promise<boolean>;
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
  const req = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const { url: baseUrl, token } = connection();
    if (baseUrl === "") throw new Error("No Gander service configured — set the service URL and token in Settings");
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new Error(`Gander service unreachable at ${baseUrl}: ${(err as Error).message}`);
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
      return validate(ReviewStateSchema, path, await req("GET", path));
    },
    listReviews: async (repoId) => {
      const path = `/api/reviews/${enc(repoId)}`;
      return validate(ReviewStateSchema.array(), path, await req("GET", path));
    },
    putFileState: async (repoId, prNumber, input) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/files`;
      return validate(FileCheckoffSchema, path, await req("PUT", path, input));
    },
    listQuestions: async (repoId, prNumber) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/questions`;
      return validate(QuestionSchema.array(), path, await req("GET", path));
    },
    addQuestion: async (repoId, prNumber, input) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/questions`;
      return validate(QuestionSchema, path, await req("POST", path, input));
    },
    addReviewerReply: async (repoId, prNumber, id, text) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/questions/${id}/replies`;
      return validate(QuestionReplySchema, path, await req("POST", path, { text }));
    },
    deleteQuestion: async (repoId, prNumber, id) => {
      await req("DELETE", `/api/reviews/${enc(repoId)}/${prNumber}/questions/${id}`);
    },
    healthy: async () => {
      const { url } = connection();
      if (url === "") return false;
      try {
        const res = await fetch(`${url}/healthz`);
        return res.ok;
      } catch {
        return false;
      }
    },
    getSnapshot: async (repoId, prNumber, path) => {
      const url = `/api/reviews/${enc(repoId)}/${prNumber}/snapshot?path=${enc(path)}`;
      return validate(SnapshotSchema, url, await req("GET", url));
    },
    setPrContext: async (repoId, prNumber, context) => {
      await req("PUT", `/api/reviews/${enc(repoId)}/${prNumber}/context`, context);
    },
  };
}
