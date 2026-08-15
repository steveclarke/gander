import { describe, expect, it } from "vitest";
import { listOpenPrs, resolveGithubToken } from "./github.js";

const ghPr = {
  number: 987, title: "Late-fee automation", body: "Adds calculator", draft: true,
  base: { ref: "main", sha: "aaa111" }, head: { sha: "bbb222" },
};

describe("listOpenPrs", () => {
  it("maps the GitHub REST shape to PrSummary", async () => {
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/repos/acme/atlas/pulls?state=open&per_page=50");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify([ghPr]), { status: 200 });
    }) as typeof fetch;

    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);
    expect(prs).toEqual([{ number: 987, title: "Late-fee automation", body: "Adds calculator", draft: true, baseRef: "main", baseSha: "aaa111", headSha: "bbb222" }]);
  });

  it("surfaces API errors loudly with status and body", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
    await expect(listOpenPrs("acme/atlas", "tok", fakeFetch)).rejects.toThrow(/403.*rate limited/s);
  });

  it("treats null body as empty string", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify([{ ...ghPr, body: null }]), { status: 200 })) as typeof fetch;
    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);
    expect(prs[0]?.body).toBe("");
  });
});

describe("resolveGithubToken", () => {
  it("falls back to env when gh is unavailable", async () => {
    const origPath = process.env.PATH;
    process.env.GANDER_GITHUB_TOKEN = "env-tok";
    process.env.PATH = "/nonexistent"; // makes `gh` unfindable for this test
    try {
      expect(await resolveGithubToken()).toBe("env-tok");
    } finally { delete process.env.GANDER_GITHUB_TOKEN; process.env.PATH = origPath; }
  });
});
