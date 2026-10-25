import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SERVICE_VERSION, type PutFileState } from "@gander/shared";
import { openStorage } from "../../../service/src/storage.js";
import { buildServer } from "../../../service/src/server.js";
import { createServiceClient } from "./service-client.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(version = SERVICE_VERSION, failBulk = false) {
  const dir = mkdtempSync(join(tmpdir(), "gander-bulk-client-"));
  const storage = openStorage(join(dir, "db"));
  const server = buildServer({ storage, token: "test", version });
  const requests: string[] = [];
  server.addHook("onRequest", async (req, reply) => {
    if (req.method === "PUT") requests.push(req.url);
    if (failBulk && req.url.endsWith("/bulk")) await reply.code(500).send({ error: "failed" });
  });
  const url = await server.listen({ host: "127.0.0.1", port: 0 });
  cleanup.push(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  return { client: createServiceClient(() => ({ url, token: "test" })), storage, requests };
}
const files: PutFileState[] = Array.from({ length: 280 }, (_, i) => ({ path: `folder/${i}.ts`, checked: true, baseHash: null, headHash: "h", baseContent: null, headContent: "example\n", machine: "test" }));
it.each([SERVICE_VERSION, "0.9.0"])("uses the supported write path on service %s and reads back every file", async (version) => {
  const { client, storage, requests } = await setup(version);
  await client.getReview("acme/atlas", 1);
  const saved: string[] = [];
  const start = performance.now();
  const result = await client.putFileStates("acme/atlas", 1, files, (batch) => saved.push(...batch.map((file) => file.path)));
  const elapsed = performance.now() - start;
  expect(result).toHaveLength(280); expect(saved).toEqual(files.map((file) => file.path));
  expect(storage.getReview("acme/atlas", 1).files).toHaveLength(280);
  expect(requests).toHaveLength(version === "0.9.0" ? 280 : 1);
  expect(requests.every((path) => path.endsWith(version === "0.9.0" ? "/files" : "/files/bulk"))).toBe(true);
  console.info(`280 files, service ${version}: ${requests.length} write requests, ${elapsed.toFixed(1)} ms, 280 read back`);
});
it("never falls back after an authenticated server write fails and reports no success", async () => {
  const { client, storage, requests } = await setup(SERVICE_VERSION, true);
  await client.getReview("acme/atlas", 1);
  let successes = 0;
  await expect(client.putFileStates("acme/atlas", 1, files, () => { successes++; })).rejects.toThrow(/failed/);
  expect(successes).toBe(0); expect(requests).toHaveLength(1);
  expect(storage.getReview("acme/atlas", 1).files).toEqual([]);
});
it("splits 501 entries and invokes success only for committed batches", async () => {
  const { client, storage, requests } = await setup();
  await client.getReview("acme/atlas", 1);
  const inputs = Array.from({ length: 501 }, (_, i) => ({ ...files[0]!, path: `${i}.ts` }));
  const sizes: number[] = [];
  await client.putFileStates("acme/atlas", 1, inputs, (batch) => sizes.push(batch.length));
  expect(sizes).toEqual([500, 1]); expect(requests).toHaveLength(2);
  expect(storage.getReview("acme/atlas", 1).files).toHaveLength(501);
});
