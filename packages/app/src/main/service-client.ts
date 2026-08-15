import type { FileCheckoff, PutFileState, ReviewState } from "@gander/shared";

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
    if (!res.ok) throw new Error(`Gander service ${res.status} on ${method} ${path}: ${await res.text()}`);
    return res.json();
  };
  const enc = encodeURIComponent;
  return {
    getReview: (repoId, prNumber) => req("GET", `/api/reviews/${enc(repoId)}/${prNumber}`) as Promise<ReviewState>,
    putFileState: (repoId, prNumber, input) => req("PUT", `/api/reviews/${enc(repoId)}/${prNumber}/files`, input) as Promise<FileCheckoff>,
  };
}
