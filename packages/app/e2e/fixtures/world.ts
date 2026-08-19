import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { TestInfo } from "@playwright/test";
import { SERVICE_VERSION } from "@gander/shared";
import type { AppSettings } from "../../src/settings.js";
import { DEFAULT_APP_SETTINGS } from "../../src/settings.js";
import { buildServer } from "../../../service/src/server.js";
import { openStorage, type Storage } from "../../../service/src/storage.js";
import type { FastifyInstance } from "fastify";
import { GanderApplication } from "./application.js";
import { GithubServer, type PullRequestFixture } from "./github-server.js";
import {
  createRepositoryFixture,
  removeRepositoryFixture,
  type RepositoryFixture,
} from "./repository.js";

const run = promisify(execFile);

type ListHook = (requestCount: number) => Promise<void> | void;

function stringEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export class GanderWorld {
  readonly root: string;
  readonly configPath: string;
  readonly userDataPath: string;
  readonly socketPath: string;
  readonly clonesPath: string;
  readonly github: GithubServer;
  readonly service: FastifyInstance;
  readonly serviceUrl: string;
  readonly serviceToken = "e2e-service-token";

  private readonly storage: Storage;
  private readonly testInfo: TestInfo;
  private readonly repositories: RepositoryFixture[] = [];
  private readonly applications: GanderApplication[] = [];
  private settings: AppSettings = DEFAULT_APP_SETTINGS;

  private constructor(options: {
    root: string;
    github: GithubServer;
    service: FastifyInstance;
    serviceUrl: string;
    storage: Storage;
    testInfo: TestInfo;
  }) {
    this.root = options.root;
    this.configPath = join(options.root, "config.json");
    this.userDataPath = join(options.root, "user-data");
    this.socketPath = join(options.root, "gander.sock");
    this.clonesPath = join(this.userDataPath, "clones");
    this.github = options.github;
    this.service = options.service;
    this.serviceUrl = options.serviceUrl;
    this.storage = options.storage;
    this.testInfo = options.testInfo;
  }

  static async create(testInfo: TestInfo): Promise<GanderWorld> {
    const root = await mkdtemp(join(tmpdir(), "gander-e2e-"));
    await mkdir(join(root, "user-data"), { recursive: true });
    await writeFile(join(root, "empty-gitconfig"), "", "utf8");
    const storage = openStorage(join(root, "service.db"));
    const service = buildServer({ storage, token: "e2e-service-token", version: SERVICE_VERSION });
    const serviceUrl = await service.listen({ host: "127.0.0.1", port: 0 });
    const github = await GithubServer.start();
    const world = new GanderWorld({ root, github, service, serviceUrl, storage, testInfo });
    await world.writeConfig();
    return world;
  }

  async addRepository(options: {
    repoId: string;
    title?: string;
    featureFiles?: Record<string, string | Uint8Array>;
    baseFiles?: Record<string, string | Uint8Array>;
    onList?: ListHook;
  }): Promise<RepositoryFixture> {
    const repository = await createRepositoryFixture(options);
    this.repositories.push(repository);
    await repository.checkout.git(["remote", "add", "origin", repository.url]);
    await repository.checkout.git(["update-ref", "refs/remotes/origin/main", repository.baseSha]);
    await repository.checkout.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const pullRequest: PullRequestFixture = {
      number: repository.number,
      title: repository.title,
      baseSha: repository.baseSha,
      headSha: repository.headSha,
    };
    this.github.register(repository.repoId, [pullRequest], options.onList);
    await this.writeConfig();
    await this.verifyGitRedirect(repository);
    return repository;
  }

  async addLocalRepository(options: { repoId: string; title?: string }): Promise<RepositoryFixture> {
    const repository = await this.addRepository(options);
    const worktreePath = join(this.root, "local-worktree");
    await repository.checkout.git(["worktree", "add", worktreePath, "feature"]);
    repository.worktreePath = worktreePath;
    const excludes = join(this.root, "git-excludes");
    await writeFile(excludes, "ignored.log\n", "utf8");
    await repository.checkout.git(["config", "core.excludesFile", excludes]);
    await writeFile(join(worktreePath, "a.rb"), "class A\n  def changed_locally; end\nend\n", "utf8");
    await unlink(join(worktreePath, "unchanged.txt"));
    await writeFile(join(worktreePath, "untracked.txt"), "new\n", "utf8");
    await writeFile(join(worktreePath, "ignored.log"), "ignore me\n", "utf8");
    return repository;
  }

  async launch(): Promise<GanderApplication> {
    const application = new GanderApplication(this.childEnvironment(), this.userDataPath, this.testInfo);
    this.applications.push(application);
    return application.launch();
  }

  async runCli(repository: RepositoryFixture): Promise<string> {
    const checkout = join(this.root, "cli-checkout");
    const bin = join(checkout, "bin");
    await mkdir(bin, { recursive: true });
    const realCli = resolve(import.meta.dirname, "../../../../bin/gander");
    await symlink(realCli, join(bin, "gander"));
    await writeFile(join(checkout, ".env"), `GANDER_APP_SOCKET=${this.socketPath}\n`, "utf8");
    const { stdout } = await run(join(bin, "gander"), [
      "--repo", repository.repoId,
      "--pr", String(repository.number),
    ], { cwd: checkout, env: stringEnvironment(process.env) });
    return stdout.trim();
  }

  async dispose(): Promise<void> {
    const failed = this.testInfo.status !== this.testInfo.expectedStatus;
    for (const application of [...this.applications].reverse()) await application.close(failed);
    await this.github.close();
    await this.service.close();
    this.storage.close();
    for (const repository of [...this.repositories].reverse()) {
      await removeRepositoryFixture(repository);
    }
    await rm(this.root, { recursive: true, force: true });
  }

  private childEnvironment(): Record<string, string> {
    const environment = stringEnvironment(process.env);
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ELECTRON_RENDERER_URL;
    Object.assign(environment, {
      GANDER_CONFIG: this.configPath,
      GANDER_SERVICE_URL: this.serviceUrl,
      GANDER_TOKEN: this.serviceToken,
      GANDER_GITHUB_API_URL: this.github.url,
      GANDER_GITHUB_TOKEN: this.github.token,
      GANDER_APP_SOCKET: this.socketPath,
      GIT_CONFIG_GLOBAL: join(this.root, "empty-gitconfig"),
      GIT_CONFIG_SYSTEM: join(this.root, "empty-gitconfig"),
      GIT_CONFIG_COUNT: String(this.repositories.length),
    });
    this.repositories.forEach((repository, index) => {
      environment[`GIT_CONFIG_KEY_${index}`] = `url.${pathToFileURL(repository.checkout.dir).href}.insteadOf`;
      environment[`GIT_CONFIG_VALUE_${index}`] = repository.url;
    });
    return environment;
  }

  private async writeConfig(): Promise<void> {
    await writeFile(this.configPath, JSON.stringify({
      serviceUrl: this.serviceUrl,
      serviceToken: this.serviceToken,
      settings: this.settings,
      repos: this.repositories.map((repository) => ({
        repoId: repository.repoId,
        url: repository.url,
        localPath: repository.checkout.dir,
      })),
    }, null, 2), { mode: 0o600 });
  }

  private async verifyGitRedirect(repository: RepositoryFixture): Promise<void> {
    const { stdout } = await run("git", ["ls-remote", repository.url, "refs/pull/1/head"], {
      env: this.childEnvironment(),
    });
    if (!stdout.includes(repository.headSha)) {
      throw new Error(`Git redirect did not expose ${repository.repoId}'s pull request ref`);
    }
  }
}
