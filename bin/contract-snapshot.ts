import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeContract, surfaceOf, type Contract } from "../packages/service/src/contract.js";

/**
 * Re-records the contract snapshot.
 *
 * Refuses when the surface has changed and SERVICE_VERSION has not: updating the snapshot
 * is the moment someone would otherwise sail past the version bump, so it is the moment to
 * stop them.
 */

const SNAPSHOT = join(import.meta.dirname, "..", "packages", "service", "contract.json");

const contract = await describeContract();
const before: Contract | null = existsSync(SNAPSHOT)
  ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Contract)
  : null;

if (before !== null) {
  const surfaceChanged = JSON.stringify(surfaceOf(before)) !== JSON.stringify(surfaceOf(contract));
  if (surfaceChanged && before.version === contract.version) {
    console.error(
      `The contract has changed and SERVICE_VERSION is still ${contract.version}.\n` +
      "Bump SERVICE_VERSION in packages/shared/src/index.ts, then run this again.\n" +
      "A version that does not move lets a stale service answer the version the app wanted.",
    );
    process.exit(1);
  }
  if (!surfaceChanged && before.version === contract.version) {
    console.log("The snapshot already matches.");
    process.exit(0);
  }
}

writeFileSync(SNAPSHOT, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`Recorded the contract at version ${contract.version}.`);
