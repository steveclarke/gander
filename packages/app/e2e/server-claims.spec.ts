import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TestInfo } from "@playwright/test";
import { SERVICE_VERSION, type ClaimScope } from "@gander/shared";
import { test, expect } from "./fixtures/test.js";
import type { GanderWorld } from "./fixtures/world.js";
import type { RepositoryFixture } from "./fixtures/repository.js";
import { buildServer } from "../../service/src/server.js";
import { openStorage } from "../../service/src/storage.js";
import { SettingsDriver, chooseServer } from "./drivers/settings.js";
import { ReviewDriver } from "./drivers/review.js";

const images = resolve(import.meta.dirname, "../../../docs/qa/server-claims");

/**
 * The world's own service plays the personal server, covering everything as an upgraded
 * home server does by default; a second real service plays a team server that covers only
 * the `acme` owner. Neither name nor owner is known to the app.
 */
async function twoServers(world: GanderWorld, homeScope?: ClaimScope) {
  const storage = openStorage(join(world.root, "team-service.db"));
  const team = buildServer({ storage, token: "team-token", version: SERVICE_VERSION, claimScope: ["acme"] });
  const teamUrl = await team.listen({ host: "127.0.0.1", port: 0 });
  if (homeScope) await world.restartService({ claimScope: homeScope });
  stops.push(async () => { await team.close(); storage.close(); });
  return { storage, teamUrl };
}
const stops: Array<() => Promise<unknown>> = [];
test.afterEach(async () => { for (const stop of stops.splice(0).reverse()) await stop(); });

async function writeServers(world: GanderWorld, teamUrl: string, repos: object[] = []): Promise<void> {
  const config = JSON.parse(await readFile(world.configPath, "utf8"));
  delete config.serviceUrl; delete config.serviceToken;
  config.servers = [
    { id: "home", name: "Home", url: world.serviceUrl, token: world.serviceToken },
    { id: "team", name: "Team", url: teamUrl, token: "team-token" },
  ];
  config.repos = repos;
  config.settings.workbench.colorTheme = "Gander Light";
  await writeFile(world.configPath, JSON.stringify(config), { mode: 0o600 });
}

async function savedRepo(world: GanderWorld, repoId: string) {
  return JSON.parse(await readFile(world.configPath, "utf8")).repos.find((repo: { repoId: string }) => repo.repoId === repoId);
}

async function capture(page: import("@playwright/test").Page, testInfo: TestInfo, name: string): Promise<void> {
  await mkdir(images, { recursive: true });
  await page.screenshot({ path: join(images, `${name}.png`) });
  await testInfo.attach(name, { path: join(images, `${name}.png`), contentType: "image/png" });
}

const fromCheckout = (world: GanderWorld, repository: RepositoryFixture) => world.runCli(repository, repository.checkout.dir);

test("a repository only one server claims opens there without a question", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/harbor", title: "Claimed example" });
  const { storage, teamUrl } = await twoServers(world, ["example"]);
  await writeServers(world, teamUrl);
  const app = await world.launch({ connectionFromEnvironment: false });

  await expect(fromCheckout(world, repository)).resolves.toBe(`Opened ${repository.repoId}#${repository.number}`);
  await expect(app.page.getByRole("dialog")).toHaveCount(0);
  await expect(app.page.locator(".status")).toContainText("Notes save to Team");
  await expect(app.page.getByRole("button", { name: `Change where ${repository.repoId} saves notes` })).toBeVisible();
  expect(await savedRepo(world, repository.repoId)).toMatchObject({ serverId: "team", serverSource: "claim" });
  await new ReviewDriver(app.page).checkFile("a.rb");
  expect(storage.getReview(repository.repoId, repository.number).files.map((file) => file.path)).toEqual(["a.rb"]);
  const home = await fetch(`${world.serviceUrl}/api/reviews/${encodeURIComponent(repository.repoId)}/${repository.number}`, { headers: { Authorization: `Bearer ${world.serviceToken}` } });
  expect((await home.json()).files).toEqual([]);
});

test("two claims ask once in the window, remember the answer, and Change asks again", async ({ world }, testInfo) => {
  const repository = await world.addRepository({ repoId: "acme/harbor", title: "Example covered by two servers" });
  const { teamUrl } = await twoServers(world);
  await writeServers(world, teamUrl);
  const app = await world.launch({ connectionFromEnvironment: false });
  await app.page.setViewportSize({ width: 1360, height: 860 });

  const opened = fromCheckout(world, repository);
  const dialog = app.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toHaveText("Where should acme/harbor save notes?");
  await expect(dialog).toContainText("Home and Team both cover this repository.");
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await capture(app.page, testInfo, "first-open-prompt");
  await chooseServer(app.page, "Home");
  await expect(opened).resolves.toBe(`Opened ${repository.repoId}#${repository.number}`);
  expect(await savedRepo(world, repository.repoId)).toMatchObject({ serverId: "home", serverSource: "choice" });
  await expect(app.page.locator(".status")).toContainText("Notes save to Home");

  // Remembered: opening it again does not ask.
  await expect(world.runCli(repository)).resolves.toBe(`Opened ${repository.repoId}#${repository.number}`);
  await expect(dialog).toHaveCount(0);
  await expect(app.page.locator(".context-toolbar")).toContainText(repository.title);
  await expect(app.page.locator(".status")).toContainText("fetched just now");

  const settings = new SettingsDriver(app.page);
  await settings.open(); await settings.openConnectionCategory();
  await expect(settings.repository(repository.repoId)).toContainText("Notes save to Home");
  await expect(app.page.getByText("Defaults by owner")).toHaveCount(0);
  await capture(app.page, testInfo, "settings-repositories");

  await app.page.getByRole("button", { name: `Change server for ${repository.repoId}` }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Change where acme/harbor saves notes");
  await expect(dialog.getByRole("radio", { name: /^Home · current/ })).toBeChecked();
  await capture(app.page, testInfo, "change-prompt");
  await chooseServer(app.page, "Team");
  await expect(settings.repository(repository.repoId)).toContainText("Notes save to Team");
  expect(await savedRepo(world, repository.repoId)).toMatchObject({ serverId: "team", serverSource: "choice" });
});

test("a server that stops claiming a repository is reported, and notes stay there", async ({ world }, testInfo) => {
  const repository = await world.addRepository({ repoId: "example/atlas", title: "Example whose claim moved" });
  const { teamUrl } = await twoServers(world, ["example"]);
  await writeServers(world, teamUrl, [{
    repoId: repository.repoId, url: repository.url, localPath: repository.checkout.dir, serverId: "team", serverSource: "claim",
  }]);
  const app = await world.launch({ connectionFromEnvironment: false });
  await app.page.setViewportSize({ width: 1360, height: 860 });

  await expect(world.runCli(repository)).resolves.toBe(`Opened ${repository.repoId}#${repository.number}`);
  await expect(app.page.locator(".status .service")).toHaveText("Team no longer covers this repository · notes still save there");
  await capture(app.page, testInfo, "claim-lost");
  expect(await savedRepo(world, repository.repoId)).toMatchObject({ serverId: "team", serverSource: "claim" });
});
