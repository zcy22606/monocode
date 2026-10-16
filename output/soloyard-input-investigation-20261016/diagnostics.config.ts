import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["output/soloyard-input-investigation-20261016/*.probe.ts"],
  },
});
