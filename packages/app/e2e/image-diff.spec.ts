import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("decodes both sides of a changed image through blob URLs", async ({ world }) => {
  const resources = resolve(import.meta.dirname, "../resources");
  const repository = await world.addRepository({
    repoId: "acme/images",
    baseFiles: { "preview.png": await readFile(resolve(resources, "icon.png")) },
    featureFiles: { "preview.png": await readFile(resolve(resources, "icon-dev.png")) },
  });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.open(repository.title);
  await review.selectFile("preview.png");
  const images = app.page.locator(".image-diff img");
  await expect(images).toHaveCount(2);
  await expect.poll(async () => images.evaluateAll((elements) => elements.every((element) => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }))).toBe(true);
  await expect.poll(async () => images.evaluateAll((elements) => elements.every((element) => (
    (element as HTMLImageElement).src.startsWith("blob:")
  )))).toBe(true);
});
