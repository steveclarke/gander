import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listGithubRepositories, listOpenPrs, resolveGithubToken } from "./github.js";

const ghPr = {
  number: 987, title: "Late-fee automation", body: "Adds calculator", draft: true,
  base: { ref: "main", sha: "aaa111" }, head: { sha: "bbb222" },
};

describe("listGithubRepositories", () => {
  it("lists every page by recent activity and excludes archived repositories", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      full_name: `acme/repo-${i}`,
      html_url: `https://github.com/acme/repo-${i}`,
      private: i % 2 === 0,
      archived: i === 3,
    }));
    const requestedUrls: string[] = [];
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify(requestedUrls.length === 1 ? fullPage : [{
        full_name: "steve/gander",
        html_url: "https://github.com/steve/gander",
        private: false,
        archived: false,
      }]), { status: 200 });
    }) as typeof fetch;

    const repos = await listGithubRepositories("tok", fakeFetch);

    expect(repos).toHaveLength(100);
    expect(repos).not.toContainEqual(expect.objectContaining({ repoId: "acme/repo-3" }));
    expect(repos.at(-1)).toEqual({ repoId: "steve/gander", url: "https://github.com/steve/gander", private: false });
    expect(requestedUrls).toEqual([
      "https://api.github.com/user/repos?visibility=all&affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&direction=desc&per_page=100&page=1",
      "https://api.github.com/user/repos?visibility=all&affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&direction=desc&per_page=100&page=2",
    ]);
  });

  it("surfaces repository-list errors with their response body", async () => {
    const fakeFetch = (async () => new Response("token lacks access", { status: 403 })) as typeof fetch;
    await expect(listGithubRepositories("tok", fakeFetch)).rejects.toThrow(/403.*token lacks access/s);
  });
});

describe("listOpenPrs", () => {
  const originalApiUrl = process.env.GANDER_GITHUB_API_URL;
  beforeEach(() => { delete process.env.GANDER_GITHUB_API_URL; });
  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.GANDER_GITHUB_API_URL;
    else process.env.GANDER_GITHUB_API_URL = originalApiUrl;
  });

  it("maps the GitHub REST shape to PrSummary", async () => {
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/repos/acme/atlas/pulls?state=open&per_page=100&page=1");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify([ghPr]), { status: 200 });
    }) as typeof fetch;

    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);
    expect(prs).toEqual([{ number: 987, title: "Late-fee automation", body: "Adds calculator", draft: true, baseRef: "main", baseSha: "aaa111", headSha: "bbb222", stack: null }]);
  });

  it("surfaces API errors loudly with status and body", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
    await expect(listOpenPrs("acme/atlas", "tok", fakeFetch)).rejects.toThrow(/403.*rate limited/s);
  });

  it("uses the configured API base for a local GitHub fake", async () => {
    process.env.GANDER_GITHUB_API_URL = "http://127.0.0.1:43123/";
    const fakeFetch = (async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("http://127.0.0.1:43123/repos/acme/atlas/pulls?state=open&per_page=100&page=1");
      return new Response(JSON.stringify([ghPr]), { status: 200 });
    }) as typeof fetch;
    await listOpenPrs("acme/atlas", "local-token", fakeFetch);
  });

  it("treats null body as empty string", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify([{ ...ghPr, body: null }]), { status: 200 })) as typeof fetch;
    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);
    expect(prs[0]?.body).toBe("");
  });

  it("pages through all open PRs when a repo has more than one page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...ghPr, number: i + 1 }));
    const shortPage = [{ ...ghPr, number: 101 }];
    const requestedUrls: string[] = [];
    const fakeFetch = (async (url: RequestInfo | URL) => {
      requestedUrls.push(String(url));
      const page = requestedUrls.length;
      return new Response(JSON.stringify(page === 1 ? fullPage : shortPage), { status: 200 });
    }) as typeof fetch;

    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);

    expect(prs).toHaveLength(101);
    expect(prs.map((p) => p.number)).toEqual([...fullPage.map((p) => p.number), 101]);
    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/acme/atlas/pulls?state=open&per_page=100&page=1",
      "https://api.github.com/repos/acme/atlas/pulls?state=open&per_page=100&page=2",
    ]);
  });

  it("issues exactly one request when the first page is already short", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify([ghPr]), { status: 200 });
    }) as typeof fetch;

    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);

    expect(prs).toHaveLength(1);
    expect(calls).toBe(1);
  });
});

describe("resolveGithubToken", () => {
  const originalToken = process.env.GANDER_GITHUB_TOKEN;
  beforeEach(() => { delete process.env.GANDER_GITHUB_TOKEN; });
  afterEach(() => {
    if (originalToken === undefined) delete process.env.GANDER_GITHUB_TOKEN;
    else process.env.GANDER_GITHUB_TOKEN = originalToken;
  });

  it("prefers the explicit environment token without consulting gh", async () => {
    process.env.GANDER_GITHUB_TOKEN = "env-tok";
    expect(await resolveGithubToken(undefined, async () => { throw new Error("gh must not run"); })).toBe("env-tok");
  });

  it("returns the trimmed output of `gh auth token` when it succeeds", async () => {
    const fakeExecFile = async (file: string, args: readonly string[]) => {
      expect(file).toBe("gh");
      expect(args).toEqual(["auth", "token"]);
      return { stdout: "gh-tok\n" };
    };
    expect(await resolveGithubToken(undefined, fakeExecFile)).toBe("gh-tok");
  });

  it("prefers a configured token over spawning gh", async () => {
    const fakeExecFile = async () => { throw new Error("gh must not run"); };
    expect(await resolveGithubToken("config-tok", fakeExecFile)).toBe("config-tok");
  });

  it("finds gh where a package manager put it when PATH does not have it", async () => {
    // What a GUI launch looks like: PATH is /usr/bin:/bin, so the bare name resolves to
    // nothing while the binary is sitting in Homebrew's directory.
    const tried: string[] = [];
    const fakeExecFile = async (file: string) => {
      tried.push(file);
      if (file !== "/opt/homebrew/bin/gh") throw new Error("command not found");
      return { stdout: "brew-tok\n" };
    };
    expect(await resolveGithubToken(undefined, fakeExecFile)).toBe("brew-tok");
    expect(tried).toEqual(["gh", "/opt/homebrew/bin/gh"]);
  });

  it("says where to put a token when there is none anywhere", async () => {
    const fakeExecFile = async () => { throw new Error("gh not found"); };
    await expect(resolveGithubToken(undefined, fakeExecFile)).rejects.toThrow(
      /Settings.*Connection.*gh auth login/s,
    );
  });
});
