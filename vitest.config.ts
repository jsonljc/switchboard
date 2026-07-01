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
        // Per-path regression floors (EV-19 INFRA-5). The single root coverage
        // run is the only place apps/api + apps/chat coverage is gated in CI, and
        // both sit under the global aggregate, so a per-app drop would otherwise
        // pass unseen. vitest 2.1 evaluates each glob key over the true aggregate
        // (covered/total) of its matched subset while the global numbers still
        // apply. Floors are set ~2 points below the measured actual (rounded
        // down) so normal variance stays green but a real regression reds.
        // Measured actuals: api 71.43/77.91/84.40/71.43, chat 53.90/73.97/69.87/53.90.
        "apps/api/src/**": {
          statements: 69,
          branches: 75,
          functions: 82,
          lines: 69,
        },
        "apps/chat/src/**": {
          statements: 51,
          branches: 71,
          functions: 67,
          lines: 51,
        },
      },
    },
  },
});
