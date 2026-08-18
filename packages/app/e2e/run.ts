import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Launcher } from "@wdio/cli";
import Fastify from "fastify";
import { buildServer } from "../../service/src/server.js";
import { openStorage } from "../../service/src/storage.js";
import { makeFixtureRepo, type FixtureRepo } from "../src/main/fixtures.js";

const run = promisify(execFile);
const SERVICE_TOKEN = "e2e-service-token";
const GITHUB_TOKEN = "e2e-github-token";

interface RepoFixture {
  repoId: string;
  url: string;
  title: string;
  fixture: FixtureRepo;
  baseSha: string;
  headSha: string;
}

async function repoFixture(repoId: string, title: string): Promise<RepoFixture> {
  const fixture = await makeFixtureRepo();
  return {
    repoId,
    url: `https://github.com/${repoId}`,
    title,
    fixture,
    baseSha: await fixture.git(["rev-parse", "refs/heads/main"]),
    headSha: await fixture.git(["rev-parse", "refs/pull/1/head"]),
  };
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "gander-e2e-"));
  const configPath = join(root, "config.json");
  const databasePath = join(root, "gander.db");
  const userDataPath = join(root, "user-data");
  const raceMarkerPath = join(root, "concurrent-race-requests");
  const [persistence, race] = await Promise.all([
    repoFixture("acme/persistence", "Persist reviewed files"),
    repoFixture("acme/race", "Open without corrupting the clone"),
  ]);
  const fixtures = [persistence, race];
  const storage = openStorage(databasePath);
  const service = buildServer({ storage, token: SERVICE_TOKEN, version: "e2e" });
  const github = Fastify({ logger: false });

  let releaseRaceRequests: (() => void) | undefined;
  const raceRequestsReady = new Promise<void>((resolve) => { releaseRaceRequests = resolve; });
  let raceRequestCount = 0;

  github.get<{ Params: { owner: string; repo: string }; Querystring: { page?: string } }>(
    "/repos/:owner/:repo/pulls",
    async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${GITHUB_TOKEN}`) {
        return reply.code(401).send({ message: "wrong test token" });
      }
      const repoId = `${request.params.owner}/${request.params.repo}`;
      const fixture = fixtures.find((candidate) => candidate.repoId === repoId);
      if (!fixture) return reply.code(404).send({ message: "unknown fixture repository" });
      if (request.query.page && request.query.page !== "1") return [];

      if (fixture === race) {
        raceRequestCount += 1;
        // Request 1 selects the repository. Requests 2 and 3 are the two quick opens;
        // release them together so both reach ensureClone before a tiny local clone ends.
        if (raceRequestCount === 2) {
          const timeout = setTimeout(() => releaseRaceRequests?.(), 10_000);
          await raceRequestsReady;
          clearTimeout(timeout);
        } else if (raceRequestCount === 3) {
          writeFileSync(raceMarkerPath, "both open requests reached the fake\n");
          releaseRaceRequests?.();
        }
      }

      return [{
        number: 1,
        title: fixture.title,
        body: "End-to-end fixture",
        draft: false,
        base: { ref: "main", sha: fixture.baseSha },
        head: { ref: "feature", sha: fixture.headSha },
      }];
    },
  );

  try {
    const serviceUrl = await service.listen({ host: "127.0.0.1", port: 0 });
    const githubUrl = await github.listen({ host: "127.0.0.1", port: 0 });
    writeFileSync(configPath, JSON.stringify({ serviceUrl, serviceToken: SERVICE_TOKEN, repos: [] }, null, 2));

    Object.assign(process.env, {
      GANDER_CONFIG: configPath,
      GANDER_SERVICE_URL: serviceUrl,
      GANDER_TOKEN: SERVICE_TOKEN,
      GANDER_GITHUB_API_URL: githubUrl,
      GANDER_GITHUB_TOKEN: GITHUB_TOKEN,
      GANDER_E2E_USER_DATA: userDataPath,
      GANDER_E2E_PERSISTENCE_URL: persistence.url,
      GANDER_E2E_RACE_URL: race.url,
      GANDER_E2E_RACE_MARKER: raceMarkerPath,
      GIT_CONFIG_COUNT: String(fixtures.length),
    });
    fixtures.forEach((fixture, index) => {
      process.env[`GIT_CONFIG_KEY_${index}`] = `url.${fixture.fixture.dir}.insteadOf`;
      process.env[`GIT_CONFIG_VALUE_${index}`] = fixture.url;
    });

    // Prove the redirects are process-local and effective before Electron starts. This
    // also fails early with a direct Git error instead of a vague empty renderer state.
    for (const fixture of fixtures) {
      const { stdout } = await run("git", ["ls-remote", fixture.url, "refs/pull/1/head"], { env: process.env });
      if (!stdout.includes(fixture.headSha)) throw new Error(`Git URL redirect failed for ${fixture.repoId}`);
    }

    const launcher = new Launcher(join(import.meta.dirname, "wdio.conf.ts"), {});
    const exitCode = await launcher.run();
    if (exitCode !== 0) process.exitCode = exitCode ?? 1;
  } finally {
    await Promise.allSettled([service.close(), github.close()]);
    storage.close();
    for (const fixture of fixtures) rmSync(fixture.fixture.dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
