import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        statements: 65,
        branches: 65,
        functions: 70,
        lines: 65,
      },
    },
  },
});
