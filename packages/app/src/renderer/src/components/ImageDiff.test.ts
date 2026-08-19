// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageSide } from "../../../api.js";
import ImageDiff from "./ImageDiff.vue";
import ImageDiffSide from "./ImageDiffSide.vue";

const image = (byte = 1): ImageSide => ({
  kind: "image",
  mediaType: "image/png",
  size: 2048,
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, byte]),
});

const createObjectURL = vi.fn(() => "blob:gander-preview");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
});

describe("ImageDiff", () => {
  it("renders both modified image sides and switches between fit and actual size", async () => {
    const wrapper = mount(ImageDiff, {
      props: {
        preview: { base: image(1), head: image(2) },
        filename: "logo.png",
        baseLabel: "main",
        headLabel: "Head",
        mode: "diff",
      },
    });

    expect(wrapper.findAll("img")).toHaveLength(2);
    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("Head");
    expect(wrapper.findAll("img").every((node) => node.classes().includes("fit"))).toBe(true);
    await wrapper.get("button[aria-pressed='false']").trigger("click");
    expect(wrapper.findAll("img").every((node) => !node.classes().includes("fit"))).toBe(true);
  });

  it("labels missing sides for added and deleted images", () => {
    const added = mount(ImageDiff, {
      props: {
        preview: { base: { kind: "absent" }, head: image() },
        filename: "added.png", baseLabel: "main", headLabel: "Head", mode: "diff",
      },
    });
    expect(added.text()).toContain("No image on this side.");
    expect(added.findAll("img")).toHaveLength(1);

    const deleted = mount(ImageDiff, {
      props: {
        preview: { base: image(), head: { kind: "absent" } },
        filename: "deleted.png", baseLabel: "main", headLabel: "Head", mode: "diff",
      },
    });
    expect(deleted.text()).toContain("No image on this side.");
    expect(deleted.findAll("img")).toHaveLength(1);
  });

  it("explains the intentionally unavailable binary snapshot in since-my-check mode", () => {
    const wrapper = mount(ImageDiff, {
      props: {
        preview: { base: image(), head: image() },
        filename: "logo.png", baseLabel: "main", headLabel: "Head", mode: "since",
      },
    });
    expect(wrapper.get("[role='status']").text()).toContain("No historical visual snapshot is available");
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("keeps ordinary binary files on the generic fallback and reports over-limit images", async () => {
    const binary = mount(ImageDiff, {
      props: {
        preview: { base: { kind: "unsupported", size: 40 }, head: { kind: "unsupported", size: 50 } },
        filename: "archive.bin", baseLabel: "main", headLabel: "Head", mode: "diff",
      },
    });
    expect(binary.text()).toBe("Binary file — diff cannot be displayed.");
    await binary.setProps({ mode: "since" });
    expect(binary.text()).toBe("Binary file — diff cannot be displayed.");

    const large = mount(ImageDiff, {
      props: {
        preview: { base: { kind: "absent" }, head: { kind: "too-large", size: 20_000_000, limit: 10_485_760 } },
        filename: "large.png", baseLabel: "main", headLabel: "Head", mode: "diff",
      },
    });
    expect(large.get("[role='status']").text()).toContain("too large to preview");
  });
});

describe("ImageDiffSide", () => {
  it("shows decoded dimensions and revokes object URLs on replacement and unmount", async () => {
    const wrapper = mount(ImageDiffSide, {
      props: { side: image(1), label: "Head", filename: "logo.png", fit: true },
    });
    const element = wrapper.get("img").element;
    Object.defineProperty(element, "naturalWidth", { configurable: true, value: 640 });
    Object.defineProperty(element, "naturalHeight", { configurable: true, value: 480 });
    await wrapper.get("img").trigger("load");
    expect(wrapper.text()).toContain("640 × 480");
    expect(wrapper.text()).toContain("2.0 KB");
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

    await wrapper.setProps({ side: image(2) });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:gander-preview");
    wrapper.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("fails visibly when Chromium cannot decode signature-matching bytes", async () => {
    const wrapper = mount(ImageDiffSide, {
      props: { side: image(), label: "Head", filename: "corrupt.png", fit: true },
    });
    await wrapper.get("img").trigger("error");
    expect(wrapper.get("[role='status']").text()).toBe("Image could not be decoded.");
  });
});
