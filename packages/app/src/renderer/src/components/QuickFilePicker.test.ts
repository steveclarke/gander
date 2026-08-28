// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import type { PrFile } from "@gander/shared";
import QuickFilePicker from "./QuickFilePicker.vue";

if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

const file = (path: string, status: PrFile["status"] = "M"): PrFile => ({
  path,
  status,
  baseContent: "old",
  headContent: "new",
  baseHash: "base",
  headHash: "head",
  checked: false,
  changedSince: false,
});

const files = [
  file("README.md"),
  file("packages/app/src/components/QuickFilePicker.vue", "A"),
  file("packages/service/src/server.ts"),
];

describe("QuickFilePicker", () => {
  it("filters paths fuzzily and opens the active result", async () => {
    const wrapper = mount(QuickFilePicker, {
      attachTo: document.body,
      props: { files, selectedPath: "README.md", iconTheme: "catppuccin-mocha" },
    });
    const input = wrapper.get("input");

    await nextTick();
    expect(document.activeElement).toBe(input.element);
    await input.setValue("qfp");
    expect(wrapper.findAll("[role='option']")).toHaveLength(1);
    expect(wrapper.get("[role='option']").text()).toContain("QuickFilePicker.vue");
    expect(wrapper.findAll("mark.match").map((part) => part.text()).join("")).toBe("QFP");

    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toEqual([["packages/app/src/components/QuickFilePicker.vue"]]);
    wrapper.unmount();
  });

  it("moves through results and Escape closes without selecting", async () => {
    const returnTarget = document.createElement("button");
    document.body.append(returnTarget);
    returnTarget.focus();
    const wrapper = mount(QuickFilePicker, {
      attachTo: document.body,
      props: { files, selectedPath: "README.md", iconTheme: "catppuccin-mocha" },
    });
    const input = wrapper.get("input");

    expect(wrapper.get("[role='option'][aria-selected='true']").text()).toContain("README.md");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.get("[role='option'][aria-selected='true']").text()).toContain("QuickFilePicker.vue");
    await input.trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(document.activeElement).toBe(returnTarget);
    wrapper.unmount();
    returnTarget.remove();
  });

  it("shows a clear empty result state", async () => {
    const wrapper = mount(QuickFilePicker, {
      props: { files, selectedPath: null, iconTheme: "catppuccin-mocha" },
    });

    await wrapper.get("input").setValue("does-not-exist");
    expect(wrapper.get(".empty").text()).toBe("No matching files");
    expect(wrapper.findAll("[role='option']")).toHaveLength(0);
  });
});
