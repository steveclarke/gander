import { describe, expect, it } from "vitest";
import type { PrFile } from "@gander/shared";
import { buildTree, dirState, filesUnder } from "./tree.js";

const file = (path: string, checked = false): PrFile =>
  ({ path, status: "M", baseContent: "", headContent: "", baseHash: "b", headHash: "h", checked, changedSince: false });

describe("buildTree", () => {
  it("nests by directory and compacts single-child chains", () => {
    const tree = buildTree([
      file("app/models/member.rb"),
      file("app/services/dues/late_fee_calculator.rb"),
      file("config/routes.rb"),
    ]);
    expect(tree.map((n) => (n.type === "dir" ? n.name : n.file.path))).toEqual(["app", "config"]);
    const app = tree[0]!;
    if (app.type !== "dir") throw new Error("expected dir");
    // chains compacted: "models" and "services/dues"
    expect(app.children.map((c) => (c.type === "dir" ? c.name : ""))).toEqual(["models", "services/dues"]);
    const config = tree[1]!;
    if (config.type !== "dir") throw new Error("expected dir");
    expect(config.children[0]).toMatchObject({ type: "file", file: { path: "config/routes.rb" } });
  });

  it("sorts directories before files, both alphabetically", () => {
    const tree = buildTree([file("zz.rb"), file("app/a.rb"), file("aa.rb")]);
    expect(tree.map((n) => (n.type === "dir" ? `d:${n.name}` : `f:${n.file.path}`))).toEqual(["d:app", "f:aa.rb", "f:zz.rb"]);
  });

  it("does not compact a directory that holds both a direct file and a single subdirectory", () => {
    const tree = buildTree([file("app/a.rb"), file("app/sub/b.rb")]);
    expect(tree).toEqual([{ type: "dir", name: "app", path: "app", children: expect.any(Array) }]);
    const app = tree[0]!;
    if (app.type !== "dir") throw new Error("expected dir");
    expect(app.children.map((c) => (c.type === "dir" ? `d:${c.name}` : `f:${c.file.path}`))).toEqual(["d:sub", "f:app/a.rb"]);
    const sub = app.children[0]!;
    if (sub.type !== "dir") throw new Error("expected dir");
    expect(sub.name).toBe("sub");
    expect(sub.children).toEqual([{ type: "file", file: expect.objectContaining({ path: "app/sub/b.rb" }) }]);
  });
});

describe("dirState / filesUnder", () => {
  it("computes none/some/all from descendants", () => {
    const mk = (aChecked: boolean, bChecked: boolean) => {
      const tree = buildTree([file("app/a.rb", aChecked), file("app/b/c.rb", bChecked)]);
      const app = tree[0]!;
      if (app.type !== "dir") throw new Error("expected dir");
      return app;
    };
    expect(dirState(mk(false, false))).toBe("none");
    expect(dirState(mk(true, false))).toBe("some");
    expect(dirState(mk(true, true))).toBe("all");
    expect(filesUnder(mk(true, false)).map((f) => f.path)).toEqual(["app/b/c.rb", "app/a.rb"].sort() as string[]);
  });
});
