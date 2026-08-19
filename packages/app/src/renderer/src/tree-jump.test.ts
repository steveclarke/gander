import { beforeEach, describe, expect, it } from "vitest";
import type { PrFile } from "@gander/shared";
import { collapsedDirs } from "./tree-nav.js";
import { jumpTargets, matchName, useTreeJump } from "./tree-jump.js";

const file = (path: string): PrFile =>
  ({ path, status: "M", baseContent: "", headContent: "", baseHash: "b", headHash: "h", checked: false, changedSince: false });

beforeEach(() => collapsedDirs.clear());

describe("tree jump", () => {
  it("matches a case-insensitive subsequence and reports the characters to highlight", () => {
    expect(matchName("FileTree.vue", "ftv")).toEqual([0, 4, 9]);
    expect(matchName("FileTree.vue", "FTE")).toEqual([0, 4, 6]);
    expect(matchName("FileTree.vue", "xyz")).toBeNull();
  });

  it("targets drawn directory and file names without matching a file's full path", () => {
    const targets = jumpTargets([file("client/server.ts"), file("README.md")], "client");

    expect(targets.map((target) => target.path)).toEqual(["client"]);
    expect(targets[0]?.name).toBe("client");
  });

  it("leaves rows inside a collapsed directory out of the motion", () => {
    const files = [file("src/FileTree.vue"), file("README.md")];
    collapsedDirs.add("src");

    expect(jumpTargets(files, "tree").map((target) => target.path)).toEqual([]);
    expect(jumpTargets(files, "s").map((target) => target.path)).toEqual(["src"]);
  });

  it("gives each remaining row a distinct one-key hint that cannot continue the search", () => {
    const files = [file("src/FileTree.vue"), file("src/formatter.ts"), file("docs/fixture.ts")];
    const many = jumpTargets(files, "f");

    expect(many.every((target) => target.label?.match(/^[a-z0-9]$/))).toBe(true);
    expect(new Set(many.map((target) => target.label)).size).toBe(many.length);
    for (const target of many) expect(jumpTargets(files, `f${target.label}`)).toEqual([]);
    expect(jumpTargets(files, "formatter")).toMatchObject([{ path: "src/formatter.ts", label: null }]);
  });

  it("narrows on plain characters and jumps as soon as one row remains", () => {
    const moved: string[] = [];
    const files = [file("FileTree.vue"), file("formatter.ts"), file("fixture.ts")];
    const jump = useTreeJump(() => files, (path) => moved.push(path));

    expect(jump.start()).toBe(true);
    expect(jump.handleKey(press("o"))).toBe(true);
    expect(moved).toEqual(["formatter.ts"]);
    expect(jump.active.value).toBe(false);
  });

  it("jumps on a displayed hint, and Escape cancels without moving", () => {
    const moved: string[] = [];
    const files = [file("FileTree.vue"), file("formatter.ts")];
    const jump = useTreeJump(() => files, (path) => moved.push(path));

    jump.start();
    const target = [...jump.targetsByPath.value.values()][1]!;
    expect(jump.handleKey(press(target.label!))).toBe(true);
    expect(moved).toEqual([target.path]);

    jump.start();
    expect(jump.handleKey(press("Escape"))).toBe(true);
    expect(moved).toEqual([target.path]);
    expect(jump.active.value).toBe(false);
  });

  it("keeps an empty result active so Backspace can widen it again", () => {
    const files = [file("FileTree.vue"), file("formatter.ts")];
    const jump = useTreeJump(() => files, () => {});

    jump.start();
    jump.handleKey(press("z"));
    expect(jump.targetsByPath.value.size).toBe(0);
    expect(jump.active.value).toBe(true);

    jump.handleKey(press("Backspace"));
    expect(jump.targetsByPath.value.size).toBe(2);
  });
});

function press(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  } as KeyboardEvent;
}
