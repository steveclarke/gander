import { describe, expect, it } from "vitest";
import { languageForPath } from "./languages.js";

describe("languageForPath", () => {
  it("maps common extensions", () => {
    expect(languageForPath("app/models/member.rb")).toBe("ruby");
    expect(languageForPath("src/App.vue")).toBe("html");
    expect(languageForPath("src/main.ts")).toBe("typescript");
    expect(languageForPath("a/b.js")).toBe("javascript");
    expect(languageForPath("x.json")).toBe("json");
    expect(languageForPath("y.md")).toBe("markdown");
    expect(languageForPath("z.py")).toBe("python");
    expect(languageForPath("style.css")).toBe("css");
    expect(languageForPath("index.html")).toBe("html");
    expect(languageForPath("script.sh")).toBe("shell");
    expect(languageForPath("main.go")).toBe("go");
    expect(languageForPath("lib.rs")).toBe("rust");
  });
  it("falls back to plaintext", () => {
    expect(languageForPath("LICENSE")).toBe("plaintext");
    expect(languageForPath("data.unknownext")).toBe("plaintext");
  });
});
