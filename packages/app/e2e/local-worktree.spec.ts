import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "./fixtures/test.js";
import { LocalViewerDriver } from "./drivers/local-viewer.js";

test("shows live local changes without pull-request review controls", async ({ world }) => {
  const repository = await world.addLocalRepository({ repoId: "acme/local-view" });
  const app = await world.launch();
  const local = new LocalViewerDriver(app.page);

  await local.openWorktree("feature", 4);
  await local.expectReadOnlyReviewSurface();
  await writeFile(join(repository.worktreePath!, "later.txt"), "arrived later\n", "utf8");
  await local.expectChanges(5);
});
