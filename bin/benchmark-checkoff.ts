import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_VERSION, type PutFileState } from "../packages/shared/src/index.js";
import { openStorage } from "../packages/service/src/storage.js";
import { buildServer } from "../packages/service/src/server.js";
import { createServiceClient } from "../packages/app/src/main/service-client.js";

// Same local HTTP service and content for both paths; single writes reproduce the
// previous folder-check algorithm. No GitHub or existing review database is involved.
const dir = mkdtempSync(join(tmpdir(), "gander-checkoff-benchmark-"));
const storage = openStorage(join(dir, "review.db"));
const server = buildServer({ storage, token: "benchmark", version: SERVICE_VERSION });
let writes = 0;
server.addHook("onRequest", async (req) => { if (req.method === "PUT") writes++; });
const inputs: PutFileState[] = Array.from({ length: 280 }, (_, i) => ({
  path: `folder/file-${i}.ts`, checked: true, baseHash: "base", headHash: "head",
  baseContent: "export const before = 1;\n".repeat(40), headContent: "export const after = 2;\n".repeat(40), machine: "benchmark",
}));
try {
  const url = await server.listen({ host: "127.0.0.1", port: 0 });
  const client = createServiceClient(() => ({ url, token: "benchmark" }));
  const results = [];
  for (const mode of ["single-file baseline", "bulk"] as const) {
    const samples = [];
    for (let iteration = 0; iteration < 6; iteration++) {
      const pr = iteration + (mode === "bulk" ? 11 : 1);
      await client.getReview("example/benchmark", pr);
      writes = 0;
      const start = performance.now();
      if (mode === "bulk") await client.putFileStates("example/benchmark", pr, inputs);
      else for (const file of inputs) await client.putFileState("example/benchmark", pr, file);
      const ms = performance.now() - start;
      const review = await client.getReview("example/benchmark", pr);
      if (review.files.length !== 280 || review.files.some((file) => !file.checked)) throw new Error("Checkoff read-back failed");
      if (iteration > 0) samples.push({ ms: Number(ms.toFixed(2)), writes, checkedReadBack: review.files.length });
    }
    const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
    results.push({ mode, medianMs: times[2], samples });
  }
  console.log(JSON.stringify({ contract: SERVICE_VERSION, files: 280, bodyBytes: Buffer.byteLength(JSON.stringify({ files: inputs })), environment: `${process.platform} ${process.arch}, Node ${process.version}, loopback HTTP, SQLite on local disk`, warmupsPerMode: 1, results }, null, 2));
} finally { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); }
