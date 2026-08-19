import { test, expect } from "./fixtures/test.js";
import { WorkbenchDriver } from "./drivers/workbench.js";

test("does not let a stale repository load replace the newer target", async ({ world }) => {
  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstFinished = false;
  const first = await world.addRepository({
    repoId: "acme/slow-repository",
    onList: async (requestCount) => {
      if (requestCount !== 1) return;
      await firstMayFinish;
      firstFinished = true;
    },
  });
  const second = await world.addRepository({ repoId: "acme/chosen-repository" });
  const app = await world.launch();
  const workbench = new WorkbenchDriver(app.page);

  try {
    await expect.poll(() => world.github.requestsFor(first.repoId)).toBe(1);
    await workbench.selectRepository(second.repoId);
    await expect(app.page.locator(".context-title strong")).toHaveText("chosen-repository");

    releaseFirst();
    await expect.poll(() => firstFinished).toBe(true);
    await expect(app.page.locator('button[aria-controls="target-picker"]')).toContainText("chosen-repository");
    await expect(app.page.locator(".context-title strong")).toHaveText("chosen-repository");
  } finally {
    releaseFirst();
  }
});
