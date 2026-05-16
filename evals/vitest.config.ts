import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["claim-classifier/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
