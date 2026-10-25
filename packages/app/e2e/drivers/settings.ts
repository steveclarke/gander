import { expect, type Page } from "@playwright/test";

export class SettingsDriver {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.getByRole("button", { name: "Editor settings" }).click();
    await expect(this.page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  }

  async chooseTheme(theme: string): Promise<void> {
    await this.page.locator('select[name="workbench.colorTheme"]').selectOption({ label: theme });
    await expect(this.page.locator('.settings-pane [role="status"]')).toHaveText("Saved automatically");
  }

  async openWorkbenchCategory(): Promise<void> {
    await this.page.getByRole("button", { name: "Workbench", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Workbench", exact: true })).toBeVisible();
  }

  async openEditorCategory(): Promise<void> {
    await this.page.getByRole("button", { name: "Editor", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Editor", exact: true })).toBeVisible();
  }

  async openConnectionCategory(): Promise<void> {
    await this.page.getByRole("button", { name: "Connection", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Review servers", exact: true })).toBeVisible();
  }

  repository(repoId: string) {
    return this.page.locator(".repository-row").filter({ has: this.page.getByText(repoId, { exact: true }) });
  }

  async changeServer(repoId: string, serverName: string): Promise<void> {
    await this.page.getByRole("button", { name: `Change server for ${repoId}`, exact: true }).click();
    await chooseServer(this.page, serverName);
  }

  async setEditorFont(family: string, size: number): Promise<void> {
    const familyInput = this.page.locator('input[name="editor.fontFamily"]');
    await familyInput.fill(family);
    await familyInput.press("Tab");
    const sizeInput = this.page.locator('input[name="editor.fontSize"]');
    await sizeInput.fill(String(size));
    await sizeInput.press("Tab");
    await expect(this.page.locator('.settings-pane [role="status"]')).toHaveText("Saved automatically");
  }

  async expectTheme(theme: string): Promise<void> {
    await expect(this.page.locator('select[name="workbench.colorTheme"]')).toHaveValue(theme);
  }

  async expectEditorFont(family: string, size: number): Promise<void> {
    await expect(this.page.locator('input[name="editor.fontFamily"]')).toHaveValue(family);
    await expect(this.page.locator('input[name="editor.fontSize"]')).toHaveValue(String(size));
    const preview = this.page.locator(".preview");
    await expect(preview).toHaveCSS("font-family", new RegExp(family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(preview).toHaveCSS("font-size", `${size}px`);
  }
}

/** Answers the in-window server question, wherever it was asked from. */
export async function chooseServer(page: Page, serverName: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: new RegExp(`^${serverName}\\b`) }).check();
  await dialog.getByRole("button", { name: `Use ${serverName}`, exact: true }).click();
  await expect(dialog).toBeHidden();
}
