import { expect, type Page } from "@playwright/test";

export class WorkbenchDriver {
  constructor(readonly page: Page) {}

  async openPullRequests(): Promise<void> {
    const button = this.page.getByRole("button", { name: "Pull Requests" });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(this.page.getByRole("complementary", { name: "Pull Requests" })).toBeVisible();
  }

  async selectWorktree(branch: string): Promise<void> {
    // Launch selects the registered checkout asynchronously. Wait for that first local
    // view before replacing it, or its late completion can win this interaction race.
    await expect(this.page.locator(".local-progress")).toBeVisible();
    const trigger = this.page.locator('button[aria-controls="target-picker"]');
    await trigger.click();
    await this.page.locator(".worktree-row").filter({ hasText: branch }).click();
    await expect(trigger).toContainText(branch);
    await expect(this.page.locator(".context-title span")).toHaveText(branch);
  }

  async selectRepository(repoId: string): Promise<void> {
    const trigger = this.page.locator('button[aria-controls="target-picker"]');
    await trigger.click();
    await this.page.locator(".picker-row").filter({ hasText: repoId }).click();
    await expect(trigger).toContainText(repoId.split("/").at(-1) ?? repoId);
  }
}
