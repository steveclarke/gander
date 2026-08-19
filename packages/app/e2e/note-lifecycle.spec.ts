import { test, expect } from "./fixtures/test.js";
import { McpDriver } from "./drivers/mcp.js";
import { ReviewDriver } from "./drivers/review.js";

test("carries a reviewer note through MCP addressing and reviewer resolution", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/note-lifecycle" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  const agent = await new McpDriver(world.serviceUrl, world.serviceToken).connect();

  try {
    await review.open(repository.title);
    await review.selectFile("a.rb");
    await review.addNote("Explain why this branch is necessary");
    await review.openNotes();

    const note = app.page.getByRole("listitem").filter({ hasText: "Explain why this branch is necessary" });
    await expect(note.getByText("open", { exact: true })).toBeVisible();

    const pickedUp = await agent.notes(repository.repoId, "feature");
    expect(pickedUp.noteCounts).toEqual({ open: 1, addressed: 0, resolved: 0 });
    expect(pickedUp.notes).toHaveLength(1);
    await agent.markAddressed(pickedUp.notes[0]!.id, "abc1234", "Removed the unnecessary branch");

    await review.fetchOrigin();
    await expect(note.getByText("addressed", { exact: true })).toBeVisible();
    await expect(note.getByRole("region", { name: "Agent update" })).toContainText("Removed the unnecessary branch");
    await expect(note.getByRole("region", { name: "Agent update" })).toContainText("abc1234");

    await app.page.getByRole("button", { name: "Mark reviewed" }).click();
    await review.fetchOrigin();
    await expect(note.getByText("resolved", { exact: true })).toBeVisible();

    const completed = await agent.notes(repository.repoId, "feature");
    expect(completed.noteCounts).toEqual({ open: 0, addressed: 0, resolved: 1 });
  } finally {
    await agent.close();
  }
});
