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
  onList?: ListHook;
  requestCount: number;
}

/** A real HTTP boundary with only GitHub's open-pull-request response in scope. */
export class GithubServer {
  readonly token = "e2e-github-token";
  readonly server: FastifyInstance;
  url = "";
  private readonly repositories = new Map<string, RepositoryResponse>();

  private constructor() {
    this.server = Fastify({ logger: false });
  }

  static async start(): Promise<GithubServer> {
    const github = new GithubServer();
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
    this.repositories.set(repoId, { pullRequests, onList, requestCount: 0 });
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

  async close(): Promise<void> {
    await this.server.close();
  }
}
