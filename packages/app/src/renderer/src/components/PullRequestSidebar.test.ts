// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it } from "vitest";
import type { Store } from "../store.js";
import PullRequestSidebar from "./PullRequestSidebar.vue";

// Only the fields this sidebar reads. A whole store would say nothing more about which
// of the two empty states it renders.
function fakeStore(prsError: string | null): Store {
  return reactive({
    prs: [],
    prsError,
    view: null,
    currentRepoId: "acme/atlas",
    targetRepoId: "acme/atlas",
    selectedPrNumber: null,
  }) as unknown as Store;
}

const props = (prsError: string | null) => ({
  store: fakeStore(prsError),
  iconTheme: "catppuccin-mocha" as const,
  typography: { fontFamily: "monospace", fontSize: 13 },
});

describe("PullRequestSidebar", () => {
  it("states an empty list as fact only when GitHub actually answered", () => {
    const wrapper = mount(PullRequestSidebar, { props: props(null) });

    expect(wrapper.get(".empty").text()).toBe("No open pull requests.");
  });

  it("says the list could not be fetched, and why, when the request failed", () => {
    // Otherwise a missing token looks like a repository with nothing open, and the
    // reviewer goes looking in the wrong place.
    const wrapper = mount(PullRequestSidebar, { props: props("No GitHub token. Add one in Settings") });

    expect(wrapper.get(".empty").text()).toContain("Could not list pull requests");
    expect(wrapper.get(".empty").text()).toContain("No GitHub token");
  });
});
