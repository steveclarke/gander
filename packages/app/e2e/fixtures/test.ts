import { test as base, expect } from "@playwright/test";
import { GanderWorld } from "./world.js";

export const test = base.extend<{ world: GanderWorld }>({
  world: async ({}, use, testInfo) => {
    const world = await GanderWorld.create(testInfo);
    try {
      await use(world);
    } finally {
      await world.dispose();
    }
  },
});

export { expect };
