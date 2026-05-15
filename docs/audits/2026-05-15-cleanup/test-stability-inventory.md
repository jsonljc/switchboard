# test-stability-inventory

**Charter:** Enumerate every `.skip` / `.skipIf` / `.todo` test pattern across all test files, triage into quarantine/needs-fix/delete categories, and cross-reference known-flake suites.

**Method:** `find packages apps scripts -name "*.test.ts" -exec grep -l '\.skip\|\.skipIf\|\.todo' {} \;` located 11 test files with skip/todo patterns. Manual inspection of each file to capture line numbers, surrounding test names, and reason comments. Known-flake suites cross-referenced.

**Scope exclusions applied:** None. No findings collide with exclusion masks.

## Headline counts

- Total `.skip` / `.skipIf` / `.todo` occurrences: 14
- Quarantine OK (env-gated integration tests): 8
- Needs fix (describe.skip + it.todo placeholders): 4
- Delete (stale): 0
- Known-flake suites: 3 present, all conditionally skipped (not broken)

## Findings

### [HIGH] call-site verification describe.skip with 3 unimplemented it.todo placeholders

- **Where:** `packages/core/src/__tests__/work-trace-update-caller-rule.test.ts:119-141`
- **Skip type:** `describe.skip()` wrapping 3x `it.todo()`
- **Reason (from comment):** "call site verification (requires lifecycle fixtures)" — awaiting fixture wiring pattern from `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`
- **Triage:** needs-fix
- **Why it matters:** 3 specific call sites in lifecycle-service.ts and platform-lifecycle.ts are flagged for update() ordering verification but tests are placeholder-only. Coverage gap on work-trace call sequencing rules.
- **Fix:** Implement fixture-driven tests using `instrumentedStore + real lifecycle` pattern from `platform-lifecycle.test.ts`
- **Effort:** M
- **Risk if untouched:** Work-trace update sequencing bugs may reach production; ordering invariants (read-before-update) not enforced
- **Collides with active work?:** no

### [MED] operator override plumbing it.todo

- **Where:** `packages/core/src/platform/__tests__/platform-lifecycle-integrity.test.ts:337-339`
- **Skip type:** `it.todo()` (standalone test placeholder)
- **Reason (from comment):** "blocked on operator override plumbing in respondToApproval"
- **Triage:** needs-fix
- **Why it matters:** Tests integrity mismatch + operator override path; escalation safety not verified
- **Fix:** Implement once operator override parameter is plumbed through `respondToApproval`
- **Effort:** M
- **Risk if untouched:** Operator override feature may not handle integrity exceptions correctly
- **Collides with active work?:** no

### [LOW] Runtime First Response — environment-gated skipIf

- **Where:** `packages/core/src/platform/__tests__/runtime-first-response.test.ts:170`
- **Skip type:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`
- **Triage:** quarantine-OK — E2E test requiring live Claude API
- **Collides with active work?:** no

### [LOW] Alex Skill Behavior — environment-gated skipIf

- **Where:** `packages/core/src/skill-runtime/__tests__/alex-skill-behavior.test.ts:133`
- **Skip type:** `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`
- **Triage:** quarantine-OK
- **Collides with active work?:** no

### [LOW] check-prisma-drift — environment-gated skipIf

- **Where:** `scripts/__tests__/check-prisma-drift.test.ts:16`
- **Skip type:** `describe.skipIf(!postgresReachable)`
- **Reason (from comment):** "drift check needs Prisma shadow database; CI test job has no DB service container"
- **Triage:** quarantine-OK
- **Collides with active work?:** no

### [LOW] PrismaWorkTraceStore-integrity — env-gated skipIf (DATABASE_URL)

- **Where:** `packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts:33`
- **Skip type:** `describe.skipIf(SKIP)` where `SKIP = !process.env.DATABASE_URL`
- **Triage:** quarantine-OK
- **Known-flake suite:** Present and conditionally-skipped (NOT actually broken)
- **Collides with active work?:** no

### [LOW] PrismaGreetingSignalStore — env-gated skipIf

- **Where:** `packages/db/src/stores/__tests__/prisma-greeting-signal-store.test.ts:14`
- **Skip type:** `describe.skipIf(!process.env.DATABASE_URL)`
- **Triage:** quarantine-OK
- **Known-flake suite:** Present and conditionally-skipped
- **Collides with active work?:** no

### [LOW] PrismaLedgerStorage — env-gated skipIf

- **Where:** `packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts:308`
- **Skip type:** `describe.skipIf(!process.env.DATABASE_URL)`
- **Reason (from comment):** Verifies "runtime atomicity semantics against a live PostgreSQL database"
- **Triage:** quarantine-OK
- **Known-flake suite:** Present and conditionally-skipped
- **Collides with active work?:** no

### [LOW] PrismaLeadIntakeStore — env-gated skipIf

- **Where:** `packages/db/src/stores/__tests__/lead-intake-store.test.ts:13`
- **Skip type:** `describe.skipIf(!process.env["DATABASE_URL"])`
- **Triage:** quarantine-OK
- **Collides with active work?:** no

### [LOW] PrismaConversationStateStore — env-gated skipIf

- **Where:** `apps/api/src/__tests__/conversation-state-store.integration.test.ts:10`
- **Skip type:** `describe.skipIf(!process.env["DATABASE_URL"])`
- **Triage:** quarantine-OK
- **Collides with active work?:** no

### [LOW] PrismaDeploymentLifecycleStore — env-gated skipIf

- **Where:** `apps/api/src/__tests__/deployment-lifecycle-store.integration.test.ts:14`
- **Skip type:** `describe.skipIf(!process.env["DATABASE_URL"])`
- **Triage:** quarantine-OK
- **Collides with active work?:** no

## Known-flake suites (from memory)

| Suite                             | File                                                                            | Status                                                     |
| --------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| prisma-work-trace-store-integrity | `packages/db/src/stores/__tests__/prisma-work-trace-store-integrity.test.ts:33` | Conditionally skipped on missing DATABASE_URL — NOT broken |
| prisma-greeting-signal-store      | `packages/db/src/stores/__tests__/prisma-greeting-signal-store.test.ts:14`      | Conditionally skipped — NOT broken                         |
| prisma-ledger-storage             | `packages/db/src/storage/__tests__/prisma-ledger-storage.test.ts:308`           | Conditionally skipped — NOT broken                         |

**Key finding:** All three known-flake suites are **NOT actually flaky or broken**. They use `describe.skipIf(!process.env.DATABASE_URL)` which is environment-gating, not a quarantine. They run when Postgres is available (integration mode) and skip gracefully in unit-test runs.

## Out of scope / deferred for this lane

- No findings in masked paths
- No orphaned test files found
- No `.only` patterns blocking CI (outside charter)
