import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { afterEach, expect, it } from "vitest";
import { SERVICE_VERSION } from "@gander/shared";
import { openStorage } from "../../../service/src/storage.js";
import { buildServer } from "../../../service/src/server.js";
import { unconfigured, type GanderConfig } from "./config.js";
import { registerServersIpc } from "./servers-ipc.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gander-servers-"));
  const storage = openStorage(join(dir, "db"));
  const server = buildServer({ storage, token: "test", version: SERVICE_VERSION });
  const url = await server.listen({ host: "127.0.0.1", port: 0 });
  cleanup.push(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  const cfg = unconfigured(); const writes: GanderConfig[] = [];
  let failPersistence = false;
  const handlers = new Map<string, (...args: any[]) => any>();
  registerServersIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } } as Pick<IpcMain, "handle">, cfg, (next) => { if (failPersistence) throw new Error("disk full"); writes.push(structuredClone(next)); });
  const call = (name: string, ...args: unknown[]) => handlers.get(`gander:${name}`)!({}, ...args);
  return { cfg, writes, url, call, failWrites: () => { failPersistence = true; } };
}
it("saves only authenticated servers, assigns pre-connection repositories once and keeps tokens out of settings", async () => {
  const { cfg, writes, url, call } = await setup();
  cfg.repos.push({ repoId: "acme/atlas", url: "url", localPath: "/tmp/atlas" });
  expect((await call("saveServer", { id: "new", name: "Personal", url, token: "wrong" })).ok).toBe(false);
  expect(writes).toEqual([]); expect(cfg.servers).toEqual([]);
  await call("saveServer", { id: "new", name: "Personal", url, token: "test" });
  const first = cfg.servers[0]!.id;
  expect(cfg.repos[0]!.serverId).toBe(first);
  await call("saveServer", { id: "new", name: "Team", url, token: "test" });
  expect(cfg.servers).toHaveLength(2); expect(cfg.repos[0]!.serverId).toBe(first);
  expect(cfg.settings).not.toHaveProperty("servers");
  await expect(call("removeServer", first)).rejects.toThrow(/still save notes/);
  await expect(call("setRepoServer", "acme/atlas", "missing")).rejects.toThrow(/unknown server/);
  await call("setRepoServer", "acme/atlas", cfg.servers[1]!.id);
  expect(cfg.repos[0]).toMatchObject({ serverId: cfg.servers[1]!.id, serverSource: "choice" });
  await call("removeServer", first); expect(cfg.servers).toHaveLength(1);
});
it("keeps both disk and running state unchanged when a server save fails to persist", async () => {
  const { cfg, writes, url, call, failWrites } = await setup();
  failWrites();
  await expect(call("saveServer", { id: "new", name: "Personal", url, token: "test" })).rejects.toThrow(/disk full/);
  expect(cfg.servers).toEqual([]); expect(writes).toEqual([]);
});
