import { execFile } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { $, browser, expect } from "@wdio/globals";
import "@wdio/electron-service";

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

/** The round trip bin/gander makes: raw argv in, the app's answer out. */
function ganderCommand(argv: string[]): Promise<{ ok?: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(requiredEnv("GANDER_E2E_APP_SOCKET"), () => {
      socket.write(`${JSON.stringify({ argv })}\n`);
    });
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { out += chunk; });
    socket.on("end", () => resolve(JSON.parse(out) as { ok?: boolean; error?: string }));
    socket.on("error", reject);
  });
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
    await expect($(".settings-pane h1")).toHaveText("Settings");
    const family = await $("input[name='editor.fontFamily']");
    const size = await $("input[name='editor.fontSize']");
    await expect($("#editor-preview-label")).toHaveText("Preview");
    await family.clearValue();
    await family.setValue("'Courier New', monospace");
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await browser.execute(() =>
      document.documentElement.style.getPropertyValue("--editor-font-family"),
    )).includes("Courier New"));
    await size.click();
    await size.clearValue();
    await size.setValue("18.5");
    await browser.keys("Tab");
    await browser.waitUntil(async () => await browser.execute(() =>
      document.documentElement.style.getPropertyValue("--editor-font-size") === "18.5px",
    ));
    await expect($(".settings-pane [role='status']")).toHaveText("Saved automatically");

    await $("//button[@role='tab' and normalize-space()='JSON']").click();
    await $(".settings-json-editor .monaco-editor").waitForDisplayed();
    const jsonSource = await browser.execute(() =>
      document.querySelector(".settings-json-editor .view-lines")?.textContent ?? "",
    );
    expect(jsonSource).toContain("editor.fontFamily");
    expect(jsonSource).toContain("editor.fontSize");
    await $("button[aria-label='Close settings']").click();
    await expect($(".settings-pane")).not.toBeDisplayed();

    await browser.electron.execute((electron) => {
      electron.Menu.getApplicationMenu()?.getMenuItemById("settings")?.click();
    });
    await expect($(".settings-pane h1")).toHaveText("Settings");
    await $("button[aria-label='Close settings']").click();

    await browser.reloadSession();

    await $("button[aria-label='Editor settings']").click();
    await expect($("input[name='editor.fontFamily']")).toHaveValue("'Courier New', monospace");
    await expect($("input[name='editor.fontSize']")).toHaveValue("18.5");
    await $("button[aria-label='Close settings']").click();
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

    await browser.execute(() => {
      const editor = document.querySelector<HTMLElement>(".diff .monaco-editor");
      if (editor) editor.dataset.mountMarker = "preserved";
    });
    await $("button[aria-label='Editor settings']").click();
    await expect($(".settings-pane")).toBeDisplayed();
    await $("button[aria-label='Close settings']").click();
    await expect($(".diff .monaco-editor[data-mount-marker='preserved']")).toBeDisplayed();

    await browser.keys("n");
    const question = await $("textarea[placeholder='What needs answering or changing here?']");
    await question.waitForDisplayed();
    await question.setValue("Why does this need to happen here?");
    await browser.keys("Enter");
    await $("button[aria-label='Questions']").click();
    await expect($(".message.original .text")).toHaveText("Why does this need to happen here?");

    const reply = await $(".reply-form input");
    await reply.setValue("Because both callers share this path.");
    await browser.keys("Enter");
    await expect($(".message.reply .author")).toHaveText("REVIEWER");
    await expect($(".message.reply .text")).toHaveText("Because both callers share this path.");

    const checkbox = await fileCheckbox("a.rb");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect($(".progress")).toHaveText("1/2 reviewed");

    await browser.reloadSession();

    await expect(browser).toHaveTitle("Gander");
    await expect($(".progress")).toHaveText("1/2 reviewed");
    await expect(await fileCheckbox("a.rb")).toHaveAttribute("aria-checked", "true");
    await $("button[aria-label='Questions']").click();
    await expect($(".message.reply .text")).toHaveText("Because both callers share this path.");
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

  it("opens a pull request named on the command line", async () => {
    const repoId = requiredEnv("GANDER_E2E_LAUNCHER_REPO");
    // The repository has never been registered in the app — naming it is enough.
    const reply = await ganderCommand(["--repo", repoId, "--pr", "1"]);
    expect(reply).toEqual({ ok: true, target: { repoId, prNumber: 1 } });

    await expect($(".seg-review")).toHaveText(expect.stringContaining("Open from the command line"));
    await expect($(".progress")).toHaveText("0/2 reviewed");
    await expect($(".error-banner")).not.toBeDisplayed();
  });

  it("answers a command that names nothing openable", async () => {
    const reply = await ganderCommand(["--repo", "notarepoid"]);
    expect(reply.error).toContain("owner/name");
  });
});
