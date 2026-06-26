import { defineConfig } from "vitest/config";

// Real-Postgres integration tier (INFRA-2 / EV-16). A dedicated, standalone vitest
// config — run via `pnpm exec vitest run --config vitest.integration.config.ts` in
// the `integration-postgres` CI job, which provides a real Postgres and sets
// DATABASE_URL. This is NOT loaded by the default `vitest run` (the unit `test`
// lane uses vitest.config.ts), so the unit lanes stay Postgres-free.
//
// The suites below already gate on `describe.skipIf(!process.env.DATABASE_URL)`,
// so they no-op when DATABASE_URL is unset (every other lane) and execute only
// here. We reuse that existing DATABASE_URL skip-gate — no INTEGRATION_DB_URL.
//
// Future real-Postgres suites (SPINE-1 booking-join regression, SPINE-6 outbox
// unique-constraint races, SPINE-8 listTasteCandidates starvation, CHAN-2
// deferred-store org-scope) add themselves to the `include` list below.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    // The integration suites share ONE Postgres. Serialize test files so cross-file
    // DB state cannot race — e.g. prisma-ledger-storage asserts a before/after delta
    // on the GLOBAL auditEntry count while prisma-work-trace-store-integrity writes
    // audit anchors. Tests within a file already run sequentially.
    fileParallelism: false,
    // Explicit per-suite list (mirrors evals/vitest.config.ts). Fail loudly if the
    // globs ever match zero files rather than silently passing.
    passWithNoTests: false,
    include: [
      "packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts",
      "packages/db/src/stores/__tests__/prisma-greeting-signal-store.test.ts",
      "packages/db/src/stores/__tests__/lead-intake-store.test.ts",
      "packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts",
    ],
  },
});
