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

  async openEditorCategory(): Promise<void> {
    await this.page.getByRole("button", { name: "Editor", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Editor", exact: true })).toBeVisible();
  }

  async openConnectionCategory(): Promise<void> {
    await this.page.getByRole("button", { name: "Connection", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Connection", exact: true })).toBeVisible();
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
