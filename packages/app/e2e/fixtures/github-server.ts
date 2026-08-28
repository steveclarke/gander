import Fastify, { type FastifyInstance } from "fastify";

export interface PullRequestFixture {
  number: number;
  title: string;
  baseSha: string;
  headSha: string;
  baseRef?: string;
  headRef?: string;
}

type ListHook = (requestCount: number) => Promise<void> | void;

interface RepositoryResponse {
  pullRequests: PullRequestFixture[];
  viewedFiles: Set<string>;
  onList?: ListHook;
  requestCount: number;
}

/** A real HTTP boundary with only GitHub's open-pull-request response in scope. */
export class GithubServer {
  readonly token = "e2e-github-token";
  readonly server: FastifyInstance;
  url = "";
  private readonly repositories = new Map<string, RepositoryResponse>();
  private viewedMutationGate: Promise<void> | null = null;
  private releaseViewedMutation: (() => void) | null = null;
  private viewedMutationEntered: (() => void) | null = null;

  private constructor() {
    this.server = Fastify({ logger: false });
    this.server.post<{ Body: { query?: string; variables?: { input?: { pullRequestId?: string; path?: string } } } }>(
      "/graphql",
      async (request, reply) => {
        if (request.headers.authorization !== `Bearer ${this.token}`) {
          return reply.code(401).send({ message: "Bad credentials" });
        }
        const input = request.body.variables?.input;
        const match = [...this.repositories.entries()].find(([repoId, repository]) =>
          repository.pullRequests.some((pullRequest) => this.pullRequestId(repoId, pullRequest.number) === input?.pullRequestId));
        if (!match || !input?.path) return reply.code(200).send({ errors: [{ message: "Pull request or path not found" }] });
        const [, repository] = match;
        this.viewedMutationEntered?.();
        await this.viewedMutationGate;
        if (request.body.query?.includes("unmarkFileAsViewed")) repository.viewedFiles.delete(input.path);
        else if (request.body.query?.includes("markFileAsViewed")) repository.viewedFiles.add(input.path);
        else return reply.code(200).send({ errors: [{ message: "Unknown mutation" }] });
        return { data: { mirror: { clientMutationId: null } } };
      },
    );
  }

  static async start(): Promise<GithubServer> {
    const github = new GithubServer();
    github.server.get("/user", async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${github.token}`) {
        return reply.code(401).send({ message: "Bad credentials" });
      }
      return { login: "e2e-reviewer" };
    });
    github.server.get<{ Params: { owner: string; repo: string }; Querystring: { page?: string } }>(
      "/repos/:owner/:repo/pulls",
      async (request, reply) => {
        if (request.headers.authorization !== `Bearer ${github.token}`) {
          return reply.code(401).send({ message: "Bad credentials" });
        }
        const repoId = `${request.params.owner}/${request.params.repo}`;
        const repository = github.repositories.get(repoId);
        if (!repository) return reply.code(404).send({ message: "Not Found" });
        repository.requestCount += 1;
        await repository.onList?.(repository.requestCount);
        if (request.query.page && request.query.page !== "1") return [];
        return repository.pullRequests.map((pullRequest) => ({
          node_id: github.pullRequestId(repoId, pullRequest.number),
          number: pullRequest.number,
          title: pullRequest.title,
          body: "",
          draft: false,
          base: { ref: pullRequest.baseRef ?? "main", sha: pullRequest.baseSha },
          head: { ref: pullRequest.headRef ?? "feature", sha: pullRequest.headSha },
        }));
      },
    );
    github.url = await github.server.listen({ host: "127.0.0.1", port: 0 });
    return github;
  }

  register(repoId: string, pullRequests: PullRequestFixture[], onList?: ListHook): void {
    this.repositories.set(repoId, { pullRequests, viewedFiles: new Set(), onList, requestCount: 0 });
  }

  updatePullRequest(repoId: string, pullRequest: PullRequestFixture): void {
    const repository = this.repositories.get(repoId);
    if (!repository) throw new Error(`${repoId} is not registered with the GitHub fixture`);
    const index = repository.pullRequests.findIndex((candidate) => candidate.number === pullRequest.number);
    if (index < 0) throw new Error(`${repoId}#${pullRequest.number} is not registered with the GitHub fixture`);
    repository.pullRequests[index] = pullRequest;
  }

  requestsFor(repoId: string): number {
    return this.repositories.get(repoId)?.requestCount ?? 0;
  }

  isViewed(repoId: string, path: string): boolean {
    return this.repositories.get(repoId)?.viewedFiles.has(path) ?? false;
  }

  pauseViewedMutations(): { entered: Promise<void>; release(): void } {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    this.viewedMutationGate = new Promise<void>((resolve) => { release = resolve; });
    this.viewedMutationEntered = entered;
    this.releaseViewedMutation = release;
    return {
      entered: enteredPromise,
      release: () => {
        this.releaseViewedMutation?.();
        this.viewedMutationGate = null;
        this.releaseViewedMutation = null;
        this.viewedMutationEntered = null;
      },
    };
  }

  private pullRequestId(repoId: string, number: number): string {
    return `PR_${repoId.replaceAll("/", "_")}_${number}`;
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
