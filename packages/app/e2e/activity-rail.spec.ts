import { test, expect } from "./fixtures/test.js";

test("reorders workspace views by dragging and remembers the order", async ({ world }) => {
  await world.addLocalRepository({ repoId: "acme/activity-rail" });
  const app = await world.launch();
  const rail = app.page.getByRole("navigation", { name: "Workspace views" });
  const activityLabels = async (): Promise<string[]> => rail.locator(".rail-action").evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute("aria-label") ?? "")
  ));

  await expect.poll(activityLabels).toEqual(["Pull Requests", "Explorer", "Current Diff", "Editor settings"]);

  const pulls = rail.getByRole("button", { name: "Pull Requests" });
  const explorer = rail.getByRole("button", { name: "Explorer" });
  await pulls.dragTo(explorer, { targetPosition: { x: 24, y: 36 } });
  await expect.poll(activityLabels).toEqual(["Explorer", "Pull Requests", "Current Diff", "Editor settings"]);

  await app.restart();
  const restoredRail = app.page.getByRole("navigation", { name: "Workspace views" });
  const restoredLabels = async (): Promise<string[]> => restoredRail.locator(".rail-action").evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute("aria-label") ?? "")
  ));
  await expect.poll(restoredLabels).toEqual(["Explorer", "Pull Requests", "Current Diff", "Editor settings"]);

  const restoredPulls = restoredRail.getByRole("button", { name: "Pull Requests" });
  await restoredPulls.focus();
  await restoredPulls.press("Alt+ArrowDown");
  await expect.poll(restoredLabels).toEqual(["Explorer", "Current Diff", "Pull Requests", "Editor settings"]);
  await expect(restoredPulls).toBeFocused();
});
