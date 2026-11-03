import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures/test.js";
import type { GanderWorld } from "./fixtures/world.js";
import type { RepositoryFixture } from "./fixtures/repository.js";

// Each run of bin/gander gets a checkout of its own: the helper links the CLI into it.
const open = (world: GanderWorld, repository: RepositoryFixture) =>
  world.runCli(repository, join(mkdtempSync(join(tmpdir(), "gander-cli-")), "checkout"));

test("an outside open never replaces the review in progress, and every review window comes back", async ({ world }) => {
  const first = await world.addRepository({ repoId: "acme/first-review", title: "First review" });
  const second = await world.addRepository({ repoId: "acme/second-review", title: "Second review" });
  const app = await world.launch();

  await expect(open(world, first)).resolves.toBe(`Opened ${first.repoId}#${first.number}`);
  await expect(app.page.locator(".context-toolbar").filter({ hasText: first.title })).toBeVisible();
  await expect.poll(() => app.windowTitles()).toEqual([`#${first.number} ${first.title}`]);

  // A second pull request opens in a window of its own; the first window keeps its review.
  await expect(open(world, second)).resolves.toBe(`Opened ${second.repoId}#${second.number}`);
  await expect.poll(async () => (await app.windowTitles()).length).toBe(2);
  await expect.poll(async () => (await app.windowTitles())[1]).toContain(second.title);
  await expect(app.page.locator(".context-toolbar").filter({ hasText: first.title })).toBeVisible();

  // Asking again for a review that is already open opens nothing new.
  await expect(open(world, first)).resolves.toBe(`Opened ${first.repoId}#${first.number}`);
  expect(await app.windowTitles()).toHaveLength(2);

  await app.restart();
  await expect.poll(async () => (await app.windowTitles()).map((title) => title.replace(/^● /, ""))).toEqual([
    `#${first.number} ${first.title}`,
    `#${second.number} ${second.title}`,
  ]);
});
