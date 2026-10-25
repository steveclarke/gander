import { describe, expect, it } from "vitest";
import type { ServerChoiceRequest } from "../../api.js";
import { choiceDetail, choiceTitle, claimLabel, initialChoice } from "./server-choice-text.js";

const request = (reason: ServerChoiceRequest["reason"], answers: Array<[string, ServerChoiceRequest["claims"][number]["answer"]]>, currentServerId?: string): ServerChoiceRequest => ({
  requestId: "r", repoId: "acme/harbor", reason, ...(currentServerId ? { currentServerId } : {}),
  claims: answers.map(([name, answer]) => ({ serverId: name.toLowerCase(), name, answer })),
});

describe("server chooser text", () => {
  it("names the servers that claim, or says none do", () => {
    expect(choiceDetail(request("several", [["Team", "claimed"], ["Home", "claimed"]]))).toBe("Team and Home both cover this repository. Gander remembers your choice.");
    expect(choiceDetail(request("several", [["A", "claimed"], ["B", "claimed"], ["C", "claimed"]]))).toMatch(/^A, B and C all cover/);
    expect(choiceDetail(request("none", [["Team", "declined"]]))).toMatch(/^None of your servers/);
    expect(choiceDetail(request("unavailable", [["Team", "claimed"], ["Home", "unavailable"]]))).toMatch(/could not check with Home/);
  });

  it("titles a change differently from a first open", () => {
    expect(choiceTitle(request("none", []))).toBe("Where should acme/harbor save notes?");
    expect(choiceTitle(request("change", []))).toBe("Change where acme/harbor saves notes");
  });

  it("labels each answer plainly", () => {
    expect(claimLabel({ serverId: "a", name: "A", answer: "unsupported" })).toBe("Older server; does not say");
    expect(claimLabel({ serverId: "a", name: "A", answer: "unavailable", detail: "Rejected the saved token" })).toBe("Rejected the saved token");
  });

  it("starts on the current server, else the one claimant, else the first", () => {
    expect(initialChoice(request("change", [["Team", "claimed"], ["Home", "declined"]], "home"))).toBe("home");
    expect(initialChoice(request("unavailable", [["Home", "unavailable"], ["Team", "claimed"]]))).toBe("team");
    expect(initialChoice(request("several", [["Home", "claimed"], ["Team", "claimed"]]))).toBe("home");
  });
});
