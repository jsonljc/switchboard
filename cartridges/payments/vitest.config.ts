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
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**", "src/providers/real-stripe.ts"],
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        // Target: 80/70/75/80 — current coverage: ~71/72/91/71
        statements: 70,
        branches: 70,
        functions: 75,
        lines: 70,
      },
    },
  },
});
