import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_VERSION } from "@gander/shared";
import { describeContract, surfaceOf, type Contract } from "./contract.js";

const SNAPSHOT = join(import.meta.dirname, "..", "contract.json");
const recorded = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Contract;

const WHAT_TO_DO = `
The app-to-service contract has changed. That is fine — it just has to be declared:

  1. Bump SERVICE_VERSION in packages/shared/src/index.ts
  2. Run bin/contract-snapshot

A version that does not move is worse than no version at all: a service without the
change answers exactly the version the app expects, the connection check passes, and
the mismatch turns up later as a 404 in the middle of a review.
`;

describe("the app-to-service contract", () => {
  it("matches the recorded snapshot", async () => {
    const current = await describeContract();
    expect(surfaceOf(current), WHAT_TO_DO).toEqual(surfaceOf(recorded));
  });

  it("is recorded at the version the code claims", () => {
    expect(recorded.version, WHAT_TO_DO).toBe(SERVICE_VERSION);
  });
});
