import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SERVICE_VERSION, type ClaimScope } from "@gander/shared";
import { openStorage } from "../../../service/src/storage.js";
import { buildServer } from "../../../service/src/server.js";
import { unconfigured, type GanderConfig, type ReviewServer } from "./config.js";
import { compareServiceVersion } from "./connection.js";
import { askClaim, decideServer, type ServerClaim } from "./repository-claims.js";
import { createRepositoryServers } from "./repository-servers.js";
import type { ServerChoiceRequest } from "./server-choice.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function service(id: string, claimScope?: ClaimScope, version = SERVICE_VERSION): Promise<ReviewServer> {
  const dir = mkdtempSync(join(tmpdir(), "gander-claims-"));
  const storage = openStorage(join(dir, "db"));
  const server = buildServer({ storage, token: "t", version, ...(claimScope ? { claimScope } : {}) });
  const url = await server.listen({ host: "127.0.0.1", port: 0 });
  cleanup.push(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  return { id, name: id[0]!.toUpperCase() + id.slice(1), url, token: "t" };
}

/** A real HTTP server with no claim route, as every service before 0.11 was. */
async function olderService(id: string): Promise<ReviewServer> {
  const server = await service(id);
  return { ...server, url: `${server.url}/older` };
}

const claim = (serverId: string, answer: ServerClaim["answer"]): ServerClaim => ({ serverId, name: serverId, answer });
const REMOTE = "git@github.com:acme/harbor.git";

describe("asking a server", () => {
  it("reads claimed, declined, older and unreachable answers from real servers", async () => {
    expect((await askClaim(await service("team", ["acme"]), REMOTE)).answer).toBe("claimed");
    expect((await askClaim(await service("personal", ["example"]), REMOTE)).answer).toBe("declined");
    expect((await askClaim(await olderService("old"), REMOTE)).answer).toBe("unsupported");
    const wrongToken = await askClaim({ ...(await service("locked")), token: "nope" }, REMOTE);
    expect(wrongToken).toMatchObject({ answer: "unavailable", detail: "Rejected the saved token" });
    const offline = await askClaim({ id: "gone", name: "Gone", url: "http://127.0.0.1:9", token: "t" }, REMOTE);
    expect(offline.answer).toBe("unavailable");
    expect(offline.detail).toMatch(/^Could not be reached/);
  });

  it("keeps 0.9 and 0.10 services connected so older servers still work", () => {
    expect(compareServiceVersion("0.9.0").state).toBe("connected");
    expect(compareServiceVersion("0.10.3").state).toBe("connected");
    expect(compareServiceVersion("0.12.0").state).toBe("incompatible");
  });
});

describe("deciding", () => {
  it("uses the only claimant without asking", () => {
    expect(decideServer([claim("team", "claimed"), claim("personal", "declined"), claim("old", "unsupported")]))
      .toEqual({ kind: "use", serverId: "team" });
  });

  it("asks when several claim, none claim, or a server could not be asked", () => {
    expect(decideServer([claim("team", "claimed"), claim("personal", "claimed")])).toEqual({ kind: "ask", reason: "several" });
    expect(decideServer([claim("team", "declined"), claim("old", "unsupported")])).toEqual({ kind: "ask", reason: "none" });
    expect(decideServer([claim("team", "claimed"), claim("personal", "unavailable")])).toEqual({ kind: "ask", reason: "unavailable" });
  });

  it("keeps a lone server that has not turned the repository down, as before claims", () => {
    expect(decideServer([claim("only", "unsupported")])).toEqual({ kind: "use", serverId: "only" });
    expect(decideServer([claim("only", "unavailable")])).toEqual({ kind: "use", serverId: "only" });
    expect(decideServer([claim("only", "declined")])).toEqual({ kind: "ask", reason: "none" });
  });
});

describe("routing a new repository", () => {
  async function setup(servers: ReviewServer[], answer: string | null = null) {
    const cfg: GanderConfig = { ...unconfigured(), servers };
    const asked: Array<Omit<ServerChoiceRequest, "requestId">> = [];
    const routing = createRepositoryServers(cfg, async (question) => { asked.push(question); return answer; });
    return { cfg, asked, routing };
  }

  it("assigns the claimant by claim, and asks then remembers when two claim", async () => {
    const team = await service("team", ["acme"]);
    const personal = await service("personal", ["example"]);
    const { routing, asked } = await setup([personal, team]);
    expect(await routing.assign("acme/harbor", REMOTE)).toEqual({ serverId: "team", serverSource: "claim" });
    expect(asked).toEqual([]);

    const everything = await service("home");
    const both = await setup([team, everything], "home");
    expect(await both.routing.assign("acme/harbor", REMOTE)).toEqual({ serverId: "home", serverSource: "choice" });
    expect(both.asked).toEqual([expect.objectContaining({ repoId: "acme/harbor", reason: "several" })]);
  });

  it("matches the full remote, so a fork goes to its own owner's server", async () => {
    const team = await service("team", ["acme"]);
    const personal = await service("personal", ["someone"]);
    const { routing } = await setup([team, personal]);
    expect(await routing.assign("someone/harbor", "https://github.com/someone/harbor.git")).toEqual({ serverId: "personal", serverSource: "claim" });
  });

  it("cancels registration when the reviewer cancels the question", async () => {
    const { routing } = await setup([await service("team", ["acme"]), await service("personal", ["acme"])]);
    await expect(routing.assign("acme/harbor", REMOTE)).rejects.toThrow(/cancelled/);
  });

  it("warns only when a claimed repository's server explicitly stops claiming it", async () => {
    const team = await service("team", ["other"]);
    const { cfg, routing } = await setup([team]);
    cfg.repos.push({ repoId: "acme/harbor", url: REMOTE, localPath: "/tmp/harbor", serverId: "team", serverSource: "claim" });
    expect(await routing.claimLost("acme/harbor")).toBe(true);
    cfg.repos[0]!.serverSource = "choice";
    expect(await routing.claimLost("acme/harbor")).toBe(false);
    cfg.repos[0]!.serverSource = "claim";
    cfg.servers[0] = { ...team, url: "http://127.0.0.1:9" };
    expect(await routing.claimLost("acme/harbor")).toBe(false);
  });
});
