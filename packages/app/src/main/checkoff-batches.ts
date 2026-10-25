import type { PutFileState } from "@gander/shared";

export const CHECKOFF_BODY_LIMIT = 16 * 1024 * 1024;

/** Byte counts include JSON escaping, UTF-8, the envelope and comma separators. */
export function checkoffBatches(inputs: PutFileState[]): PutFileState[][] {
  const batches: PutFileState[][] = [];
  let batch: PutFileState[] = [];
  const envelope = Buffer.byteLength('{"files":[]}');
  let bytes = envelope;
  for (const input of inputs) {
    const size = Buffer.byteLength(JSON.stringify(input));
    if (size + envelope > CHECKOFF_BODY_LIMIT) throw new Error(`${input.path} exceeds the 16 MiB review limit. No files in this action were saved.`);
    if (batch.length === 500 || bytes + size + (batch.length ? 1 : 0) > CHECKOFF_BODY_LIMIT) {
      batches.push(batch); batch = []; bytes = envelope;
    }
    bytes += size + (batch.length ? 1 : 0);
    batch.push(input);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
