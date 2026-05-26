import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    // `.agent/**` runs under its own config/deps (not a workspace member) via the
    // CI "Validator self-tests" step in the `architecture` job — NOT untested.
    // `apps/dashboard` + `evals` likewise have their own runners.
    exclude: ["**/node_modules/**", "apps/dashboard/**", ".agent/**", "evals/**"],
    passWithNoTests: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      include: [
        "packages/*/src/**/*.ts",
        "apps/api/src/**/*.ts",
        "apps/chat/src/**/*.ts",
        "cartridges/*/src/**/*.ts",
      ],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/dist/**", "**/node_modules/**"],
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 52,
        lines: 55,
      },
    },
  },
});
