import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("shares one valid clone when the same pull request is opened twice", async ({ world }) => {
  let releaseSecondList!: () => void;
  const thirdListArrived = new Promise<void>((resolve) => { releaseSecondList = resolve; });
  const repository = await world.addRepository({
    repoId: "acme/concurrent-open",
    title: "Open me twice",
    // file:// forces Git's transport instead of local hardlinks, and an incompressible
    // object keeps both historical clone attempts in flight long enough to overlap.
    baseFiles: { "clone-padding.bin": randomBytes(16 * 1024 * 1024) },
    onList: async (requestCount) => {
      if (requestCount === 2) await thirdListArrived;
      if (requestCount === 3) releaseSecondList();
    },
  });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.workbench.openPullRequests();
  await review.pullRequest(repository.title).evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(app.page.locator(".context-toolbar").filter({ hasText: repository.title })).toBeVisible();
  expect(world.github.requestsFor(repository.repoId)).toBeGreaterThanOrEqual(3);
  expect(await readdir(world.clonesPath)).toEqual(["acme__concurrent-open.git"]);
  await repository.checkout.git(["-C", world.clonesPath + "/acme__concurrent-open.git", "fsck", "--no-progress"]);
});
