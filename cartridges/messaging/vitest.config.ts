import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**"],
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 52,
        lines: 55,
      },
    },
  },
});
