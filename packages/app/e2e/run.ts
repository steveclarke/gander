import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Launcher } from "@wdio/cli";
import { SERVICE_VERSION } from "@gander/shared";
import Fastify from "fastify";
import { buildServer } from "../../service/src/server.js";
import { openStorage } from "../../service/src/storage.js";
import { makeFixtureRepo, type FixtureRepo } from "../src/main/fixtures.js";
import { DEFAULT_APP_SETTINGS } from "../src/settings.js";

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

async function repoFixture(
  repoId: string,
  title: string,
  featureFiles: Record<string, string | Uint8Array> = {},
  baseFiles: Record<string, string | Uint8Array> = {},
): Promise<RepoFixture> {
  const fixture = await makeFixtureRepo(featureFiles, baseFiles);
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
  const baseImage = readFileSync(join(import.meta.dirname, "../resources/icon.png"));
  const headImage = readFileSync(join(import.meta.dirname, "../resources/icon-dev.png"));
  const [persistence, race, launcher, icons, scrollbar, images, localViewer] = await Promise.all([
    repoFixture("acme/persistence", "Persist reviewed files"),
    repoFixture("acme/race", "Open without corrupting the clone"),
    repoFixture("acme/launcher", "Open from the command line"),
    repoFixture("acme/icons", "Render file icons", {
      ".editorconfig": "root = true\n",
      "Gemfile": "source \"https://rubygems.org\"\n",
      "README.md": "# Icon fixture\n",
      "config/settings.json": "{}\n",
      "src/App.vue": "<template><main /></template>\n",
      "src/main.ts": "export const ready = true;\n",
      "types/index.d.ts": "export declare const ready: boolean;\n",
      "unknown/file.mystery": "unknown\n",
    }),
    repoFixture(
      "acme/scrollbar",
      "Scroll a long file tree",
      Object.fromEntries(Array.from({ length: 80 }, (_, index) => [
        `src/file-${String(index + 1).padStart(2, "0")}.ts`,
        `export const value${index + 1} = ${index + 1};\n`,
      ])),
    ),
    repoFixture(
      "acme/images",
      "Preview changed images",
      { "assets/logo.png": headImage },
      { "assets/logo.png": baseImage },
    ),
    repoFixture("acme/local-viewer", "Local viewer fixture", {}, { ".gitignore": "ignored.txt\n" }),
  ]);
  const fixtures = [persistence, race, launcher, icons, scrollbar, images, localViewer];
  const localWorktreePath = join(root, "local-viewer-worktree");
  await localViewer.fixture.git(["update-ref", "refs/remotes/origin/main", localViewer.baseSha]);
  await localViewer.fixture.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  await localViewer.fixture.git(["worktree", "add", localWorktreePath, "feature"]);
  writeFileSync(join(localWorktreePath, "a.rb"), "class A\n  def local; end\nend\n");
  writeFileSync(join(localWorktreePath, "untracked.ts"), "export const local = true;\n");
  writeFileSync(join(localWorktreePath, "ignored.txt"), "not part of the view\n");
  const storage = openStorage(databasePath);
  const service = buildServer({ storage, token: SERVICE_TOKEN, version: SERVICE_VERSION });
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

      const pullRequest = {
        number: 1,
        title: fixture.title,
        body: "End-to-end fixture",
        draft: false,
        base: { ref: "main", sha: fixture.baseSha },
        head: { ref: "feature", sha: fixture.headSha },
      };
      if (fixture !== persistence) return [pullRequest];

      return [
        { ...pullRequest, stack: { id: 7, size: 2, position: 2 } },
        {
          ...pullRequest,
          number: 3,
          title: "Independent cleanup",
          head: { ref: "cleanup", sha: fixture.headSha },
        },
        {
          ...pullRequest,
          number: 2,
          title: "Prepare review state",
          head: { ref: "review-state", sha: fixture.headSha },
          stack: { id: 7, size: 2, position: 1 },
        },
      ];
    },
  );

  try {
    const serviceUrl = await service.listen({ host: "127.0.0.1", port: 0 });
    const githubUrl = await github.listen({ host: "127.0.0.1", port: 0 });
    writeFileSync(configPath, JSON.stringify({
      serviceUrl,
      serviceToken: SERVICE_TOKEN,
      settings: DEFAULT_APP_SETTINGS,
      repos: [localViewer, ...fixtures.filter((fixture) => fixture !== localViewer)].map((fixture) => ({
        repoId: fixture.repoId,
        url: fixture.url,
        localPath: fixture === localViewer ? localWorktreePath : fixture.fixture.dir,
      })),
    }, null, 2));

    Object.assign(process.env, {
      GANDER_CONFIG: configPath,
      GANDER_SERVICE_URL: serviceUrl,
      GANDER_TOKEN: SERVICE_TOKEN,
      GANDER_GITHUB_API_URL: githubUrl,
      GANDER_GITHUB_TOKEN: GITHUB_TOKEN,
      GANDER_E2E_USER_DATA: userDataPath,
      GANDER_E2E_RACE_MARKER: raceMarkerPath,
      GANDER_E2E_LAUNCHER_REPO: launcher.repoId,
      GANDER_E2E_LOCAL_WORKTREE: localWorktreePath,
      // Where the app listens with no allocated socket in the environment: beside the
      // suite's own user data, so this run cannot reach a development app.
      GANDER_E2E_APP_SOCKET: join(userDataPath, "app.sock"),
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

    const wdio = new Launcher(join(import.meta.dirname, "wdio.conf.ts"), {});
    const exitCode = await wdio.run();
    if (exitCode !== 0) process.exitCode = exitCode ?? 1;
  } finally {
    await Promise.allSettled([service.close(), github.close()]);
    storage.close();
    await localViewer.fixture.git(["worktree", "remove", "--force", localWorktreePath]);
    for (const fixture of fixtures) rmSync(fixture.fixture.dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
