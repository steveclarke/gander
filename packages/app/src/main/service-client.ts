import type { z } from "zod";
import { FileCheckoffSchema, ReviewStateSchema, type FileCheckoff, type PutFileState, type ReviewState } from "@gander/shared";

export interface ServiceClient {
  getReview(repoId: string, prNumber: number): Promise<ReviewState>;
  putFileState(repoId: string, prNumber: number, input: PutFileState): Promise<FileCheckoff>;
}

export function createServiceClient(baseUrl: string, token: string): ServiceClient {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const req = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new Error(`Gander service unreachable at ${baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(`Gander service ${res.status} on ${method} ${baseUrl}${path}: ${await res.text()}`);
    return res.json();
  };
  // Cross-machine review state is the product's core promise: a version-skewed or
  // corrupted service response must fail loudly here, not get cast past the zod schemas
  // that already exist and flow into the hash comparison in review.ts as if it were valid.
  function validate<T>(schema: z.ZodType<T>, path: string, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const problem = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`Gander service at ${baseUrl}${path} returned data that failed validation: ${problem}`);
    }
    return parsed.data;
  }
  const enc = encodeURIComponent;
  return {
    getReview: async (repoId, prNumber) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}`;
      return validate(ReviewStateSchema, path, await req("GET", path));
    },
    putFileState: async (repoId, prNumber, input) => {
      const path = `/api/reviews/${enc(repoId)}/${prNumber}/files`;
      return validate(FileCheckoffSchema, path, await req("PUT", path, input));
    },
  };
}
