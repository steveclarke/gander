import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GanderApi } from "../src/api.js";
import { SERVICE_VERSION } from "@gander/shared";
import { test, expect } from "./fixtures/test.js";
import { buildServer } from "../../service/src/server.js";
import { openStorage } from "../../service/src/storage.js";
import { SettingsDriver } from "./drivers/settings.js";
import { ReviewDriver } from "./drivers/review.js";

test("two repositories keep separate servers through reviews, settings and restart", async ({ world }, testInfo) => {
  const personal = await world.addRepository({ repoId: "example/atlas", title: "Personal example" });
  const team = await world.addRepository({ repoId: "acme/harbor", title: "Team example" });
  const storage = openStorage(join(world.root, "second-service.db"));
  const service = buildServer({ storage, token: "second-token", version: SERVICE_VERSION });
  const secondUrl = await service.listen({ host: "127.0.0.1", port: 0 });
  try {
    const config = JSON.parse(await readFile(world.configPath, "utf8"));
    delete config.serviceUrl; delete config.serviceToken;
    config.servers = [
      { id: "personal", name: "Personal", url: world.serviceUrl, token: world.serviceToken },
      { id: "team", name: "Team", url: secondUrl, token: "second-token" },
    ];
    config.repos[0].serverId = "personal"; config.repos[1].serverId = "team";
    config.settings.workbench.colorTheme = "Gander Light";
    await writeFile(world.configPath, JSON.stringify(config), { mode: 0o600 });
    const app = await world.launch({ connectionFromEnvironment: false });
    let review = new ReviewDriver(app.page);
    await review.workbench.selectRepository(personal.repoId);
    await expect(app.page.getByRole("button", { name: "Refresh local changes", exact: true })).toBeEnabled();
    await review.open(personal.title); await review.checkFile("a.rb");
    await review.workbench.selectRepository(team.repoId);
    await expect(app.page.getByRole("button", { name: "Refresh local changes", exact: true })).toBeEnabled();
    await review.open(team.title); await review.expectProgress(0, 2);
    await review.checkFile("b.rb");
    await review.addNote("QA example: check this change.");
    expect(storage.getReview(team.repoId, 1).files.map((file) => file.path)).toEqual(["b.rb"]);
    expect(storage.getReview(personal.repoId, 1).files).toEqual([]);
    const response = await fetch(`${world.serviceUrl}/api/reviews/${encodeURIComponent(team.repoId)}/1`, { headers: { Authorization: `Bearer ${world.serviceToken}` } });
    expect((await response.json()).files).toEqual([]);
    await review.openNotes();
    const images = resolve(import.meta.dirname, "../../../docs/qa/server-per-repository");
    await mkdir(images, { recursive: true });
    await app.page.screenshot({ path: join(images, "team-review.png") });
    await testInfo.attach("team-review", { path: join(images, "team-review.png"), contentType: "image/png" });
    const settings = new SettingsDriver(app.page);
    await settings.open(); await settings.openConnectionCategory();
    await expect(app.page.locator(".connection-status")).toHaveText(["Connected", "Connected"]);
    await expect(settings.repository(personal.repoId)).toContainText("Notes save to Personal");
    await expect(settings.repository(team.repoId)).toContainText("Notes save to Team");
    await app.page.setViewportSize({ width: 1360, height: 1000 });
    await app.page.screenshot({ path: join(images, "servers.png") });
    await testInfo.attach("servers", { path: join(images, "servers.png"), contentType: "image/png" });
    await app.restart();
    review = new ReviewDriver(app.page);
    await review.workbench.selectRepository(personal.repoId);
    await expect(app.page.getByRole("button", { name: "Refresh local changes", exact: true })).toBeEnabled();
    await review.open(personal.title); await review.expectProgress(1, 2);
    await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    await review.workbench.selectRepository(team.repoId);
    await expect(app.page.getByRole("button", { name: "Refresh local changes", exact: true })).toBeEnabled();
    await review.open(team.title); await review.expectProgress(1, 2);
    await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await review.openNotes(); await expect(app.page.locator(".note-item")).toContainText("QA example");
    const oldView = await app.page.evaluate(async (repoId) => (window as unknown as { gander: GanderApi }).gander.openPr(repoId, 1), team.repoId);
    const originalNote = storage.listNotes(team.repoId, 1)[0]!;
    const created = await fetch(`${world.serviceUrl}/api/reviews/${encodeURIComponent(team.repoId)}/1/notes`, {
      method: "POST", headers: { Authorization: `Bearer ${world.serviceToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "a.rb", line: null, text: "QA note on the other server", headSha: null, sourceContext: null }),
    });
    expect(created.status).toBe(201);
    const otherNote = await created.json();
    expect(otherNote.id).toBe(originalNote.id);
    const changedSettings = new SettingsDriver(app.page);
    await changedSettings.open(); await changedSettings.openConnectionCategory();
    await changedSettings.changeServer(team.repoId, "Personal");
    await expect(app.page.locator(".notice")).toContainText("Server changed");
    await app.page.getByRole("button", { name: "Close settings", exact: true }).click();
    await review.openNotes();
    await expect(app.page.locator(".note-item")).toContainText("QA note on the other server");
    const refusal = await app.page.evaluate(async (args) => {
      try {
        await (window as unknown as { gander: GanderApi }).gander.updateNote(args.repoId, 1, args.id, { text: "Stale edit" }, args.sessionId);
        return "accepted";
      } catch (error) { return String(error); }
    }, { repoId: team.repoId, id: originalNote.id, sessionId: oldView.reviewSessionId });
    expect(refusal).toContain("review server changed");
    const readBack = await fetch(`${world.serviceUrl}/api/reviews/${encodeURIComponent(team.repoId)}/1/notes`, { headers: { Authorization: `Bearer ${world.serviceToken}` } });
    expect((await readBack.json())[0].text).toBe("QA note on the other server");
  } finally { await service.close(); storage.close(); }
});

test("adds a tested server while existing repositories keep their migrated server", async ({ world }) => {
  const repo = await world.addRepository({ repoId: "acme/atlas" });
  const app = await world.launch({ connectionFromEnvironment: false });
  const settings = new SettingsDriver(app.page);
  await settings.open(); await settings.openConnectionCategory();
  await app.page.getByRole("button", { name: "Add server", exact: true }).click();
  await app.page.getByLabel("Name", { exact: true }).fill("Second server");
  await app.page.getByLabel("Service URL", { exact: true }).fill(world.serviceUrl);
  await app.page.locator("#connection-token").fill("wrong-token");
  await app.page.getByRole("button", { name: "Save server", exact: true }).click();
  await expect(app.page.locator(".server-form").getByRole("status")).toContainText("rejected that token");
  await app.page.locator("#connection-token").fill(world.serviceToken);
  await app.page.getByRole("button", { name: "Save server", exact: true }).click();
  await expect(app.page.locator(".server-row")).toHaveCount(2);
  await expect(settings.repository(repo.repoId)).toContainText("Notes save to Review server");
  await expect(app.page.getByText("Defaults by owner")).toHaveCount(0);
  await app.restart();
  const restarted = new SettingsDriver(app.page);
  await restarted.open(); await restarted.openConnectionCategory();
  await expect(app.page.locator(".server-row")).toHaveCount(2);
  await expect(restarted.repository(repo.repoId)).toContainText("Notes save to Review server");
});
