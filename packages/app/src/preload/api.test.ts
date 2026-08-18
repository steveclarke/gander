import { describe, expect, it, vi } from "vitest";
import { createGanderApi } from "./api.js";

describe("preload API", () => {
  it("routes typed settings calls through their namespaced IPC channels", async () => {
    const invoke = vi.fn(async () => ({ editor: { fontFamily: "monospace", fontSize: 16 } }));
    const api = createGanderApi(invoke);

    await api.getSettings();
    expect(invoke).toHaveBeenLastCalledWith("gander:getSettings");

    const settings = { editor: { fontFamily: "Fira Code, monospace", fontSize: 17 } };
    await api.updateSettings(settings);
    expect(invoke).toHaveBeenLastCalledWith("gander:updateSettings", settings);
  });
});
