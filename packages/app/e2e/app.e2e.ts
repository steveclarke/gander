import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { $, browser, expect } from "@wdio/globals";

const run = promisify(execFile);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; run the suite through pnpm test:e2e`);
  return value;
}

async function registerAndSelect(url: string, repoName: string): Promise<void> {
  await $(".seg-repo").click();
  await $("//div[@role='button'][.//span[contains(normalize-space(.), 'Add repository')]]").click();
  const input = await $("input[placeholder='https://github.com/owner/repo']");
  await input.setValue(url);
  await browser.keys("Enter");
  const option = await $(`//div[@role='option'][.//span[contains(@class, 'nm') and normalize-space()='${repoName}']]`);
  await option.waitForDisplayed();
  await option.click();
}

async function openPullRequest(title: string, twice = false): Promise<void> {
  await $(".seg-review").click();
  const option = await $(`//div[@role='option'][contains(normalize-space(.), '${title}')]`);
  await option.waitForDisplayed();
  if (twice) await option.doubleClick();
  else await option.click();
}

function fileCheckbox(filename: string) {
  return $(`//div[contains(@class, 'tnode')][.//span[contains(@class, 'fname') and normalize-space()='${filename}']]//span[@role='checkbox']`);
}

describe("Gander end to end", () => {
  it("opens the built application with the Gander title", async () => {
    await expect(browser).toHaveTitle("Gander");
    await expect($(".empty")).toHaveText("Pick a repository, then a pull request.");
  });

  it("changes editor font settings in the UI and keeps them after restart", async () => {
    await $("button[aria-label='Editor settings']").click();
    const family = await $("input[name='editor.fontFamily']");
    const size = await $("input[name='editor.fontSize']");
    await expect($(".settings .preview-label")).toHaveText("Preview");
    await family.setValue("'Courier New', monospace");
    await size.setValue("18.5");
    await $(".settings .save").click();
    await expect($(".settings [role='status']")).toHaveText("Saved");

    await browser.reloadSession();

    await $("button[aria-label='Editor settings']").click();
    await expect($("input[name='editor.fontFamily']")).toHaveValue("'Courier New', monospace");
    await expect($("input[name='editor.fontSize']")).toHaveValue("18.5");
    await browser.keys("Escape");
  });

  it("registers a repository and keeps a reviewed file checked after restart", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_PERSISTENCE_URL"), "persistence");
    await openPullRequest("Persist reviewed files");

    const typography = async () => browser.execute(() => {
      const line = document.querySelector<HTMLElement>(".monaco-editor .view-line span");
      if (!line) return null;
      const style = getComputedStyle(line);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize };
    });
    await $(".monaco-editor .view-line span").waitForDisplayed();
    await expect(typography()).resolves.toMatchObject({ fontSize: "18.5px" });
    expect((await typography())?.fontFamily).toContain("Courier New");

    await $("button[aria-label='Full file']").click();
    await $(".monaco-editor .view-line span").waitForDisplayed();
    await expect(typography()).resolves.toMatchObject({ fontSize: "18.5px" });

    const checkbox = await fileCheckbox("a.rb");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect($(".progress")).toHaveText("1/2 reviewed");

    await browser.reloadSession();

    await expect(browser).toHaveTitle("Gander");
    await expect($(".progress")).toHaveText("1/2 reviewed");
    await expect(await fileCheckbox("a.rb")).toHaveAttribute("aria-checked", "true");
  });

  it("opens a pull request twice quickly with one valid clone", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_RACE_URL"), "race");
    await openPullRequest("Open without corrupting the clone", true);
    await expect($(".progress")).toHaveText("0/2 reviewed");
    await expect($(".error-banner")).not.toBeDisplayed();

    expect(existsSync(requiredEnv("GANDER_E2E_RACE_MARKER"))).toBe(true);
    const clonesRoot = join(requiredEnv("GANDER_E2E_USER_DATA"), "clones");
    const matchingClones = readdirSync(clonesRoot).filter((entry) => entry.startsWith("acme__race.git"));
    expect(matchingClones).toEqual(["acme__race.git"]);
    await run("git", ["-C", join(clonesRoot, "acme__race.git"), "fsck", "--full", "--no-dangling"]);
  });
});
