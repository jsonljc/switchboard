# Phase 0: Codebase Cleanup — Dead Code Removal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all dead and legacy code from the Switchboard codebase to create a lean foundation for the AI agent marketplace pivot.

**Architecture:** The codebase has a governance-first core (policy engine, approval state machine, competence tracker, audit ledger) that is kept intact. Everything being removed is either completely orphaned (zero imports) or belongs to the deprecated employee/content/SMB product direction with no consumers. Removal is sequenced from leaf dependencies inward to avoid broken imports at any step.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Prisma ORM, Fastify API, Next.js dashboard

---

## File Map

### Files to delete (Tier 1 — zero consumers, safe immediate deletion):

| Package                  | Files                            | Reason                                                   |
| ------------------------ | -------------------------------- | -------------------------------------------------------- |
| `employees/creative/`    | Entire package (12 src + 6 test) | Deprecated AI Creative employee, depends on employee-sdk |
| `packages/employee-sdk/` | Entire package (7 src + 5 test)  | Only consumer was employees/creative/                    |
| `packages/memory/`       | Entire package (4 src + 3 test)  | Orphaned — no package depends on it                      |

### Files to delete (Tier 2 — requires unwiring from barrel exports first):

| File                                                                | Reason                                       |
| ------------------------------------------------------------------- | -------------------------------------------- |
| `apps/api/src/routes/employees.ts`                                  | Old employee CRUD, no frontend consumer      |
| `apps/api/src/routes/__tests__/employees.test.ts`                   | Test for deleted route                       |
| `apps/api/src/routes/content.ts`                                    | Old content management, no frontend consumer |
| `apps/api/src/routes/__tests__/content.test.ts`                     | Test for deleted route                       |
| `packages/db/src/stores/prisma-employee-store.ts`                   | Store for deleted model                      |
| `packages/db/src/stores/prisma-skill-store.ts`                      | Store for deleted model, zero imports        |
| `packages/db/src/stores/prisma-performance-store.ts`                | Store for deleted model                      |
| `packages/db/src/stores/prisma-content-store.ts`                    | Store for deleted model                      |
| `packages/db/src/stores/prisma-roas-store.ts`                       | Store for deleted model, zero imports        |
| `packages/db/src/storage/prisma-outcome-store.ts`                   | Store for deleted model, zero imports        |
| `packages/db/src/stores/__tests__/prisma-employee-store.test.ts`    | Test for deleted store                       |
| `packages/db/src/stores/__tests__/prisma-skill-store.test.ts`       | Test for deleted store                       |
| `packages/db/src/stores/__tests__/prisma-performance-store.test.ts` | Test for deleted store                       |
| `packages/db/src/stores/__tests__/prisma-content-store.test.ts`     | Test for deleted store                       |
| `packages/db/src/stores/__tests__/prisma-roas-store.test.ts`        | Test for deleted store                       |

### Files to delete (Tier 3 — requires unwiring from orchestrator):

| File                                                     | Reason                                    |
| -------------------------------------------------------- | ----------------------------------------- |
| `packages/core/src/smb/tier-resolver.ts`                 | SMB tier system, being replaced           |
| `packages/core/src/smb/activity-log.ts`                  | SMB activity log, being replaced          |
| `packages/core/src/smb/approval.ts`                      | SMB approval helpers                      |
| `packages/core/src/smb/evaluator.ts`                     | SMB evaluator                             |
| `packages/core/src/smb/pipeline.ts`                      | SMB pipeline                              |
| `packages/core/src/smb/index.ts`                         | SMB barrel export                         |
| `packages/core/src/__tests__/smb-tier-upgrade.test.ts`   | Test for deleted module                   |
| `packages/core/src/__tests__/smb-pipeline.test.ts`       | Test for deleted module                   |
| `packages/core/src/__tests__/smb-activity-log.test.ts`   | Test for deleted module                   |
| `packages/core/src/outcome/aggregator.ts`                | Outcome system, zero app consumers        |
| `packages/core/src/outcome/optimiser.ts`                 | Outcome system, zero app consumers        |
| `packages/core/src/outcome/pipeline.ts`                  | Outcome system, zero app consumers        |
| `packages/core/src/outcome/types.ts`                     | Outcome system, zero app consumers        |
| `packages/core/src/outcome/__tests__/pipeline.test.ts`   | Test for deleted module                   |
| `packages/core/src/outcome/__tests__/aggregator.test.ts` | Test for deleted module                   |
| `packages/db/src/prisma-tier-store.ts`                   | Prisma store for deleted SMB tier         |
| `packages/db/src/prisma-smb-activity-log.ts`             | Prisma store for deleted SMB activity log |

### Files to modify:

| File                                                  | Change                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `apps/api/src/bootstrap/routes.ts`                    | Remove employee + content route imports and registrations       |
| `packages/db/src/index.ts`                            | Remove exports for deleted stores                               |
| `packages/core/src/index.ts`                          | Remove `export * from "./smb/index.js"` and outcome exports     |
| `packages/core/src/orchestrator/lifecycle.ts`         | Remove optional tierStore/smbActivityLog from config            |
| `packages/core/src/orchestrator/shared-context.ts`    | Remove tierStore/smbActivityLog from SharedContext              |
| `packages/core/src/orchestrator/propose-pipeline.ts`  | Remove SMB tier check branch                                    |
| `packages/core/src/orchestrator/approval-manager.ts`  | Remove SMB activity log recording                               |
| `packages/core/src/orchestrator/__tests__/helpers.ts` | Remove tierStore/smbActivityLog from test helpers               |
| `apps/api/src/app.ts`                                 | Remove tierStore/smbActivityLog decoration and imports          |
| `apps/api/src/bootstrap/storage.ts`                   | Remove SMB tier store and activity log bootstrap                |
| `packages/db/prisma/schema.prisma`                    | Remove 10 deprecated models                                     |
| `pnpm-workspace.yaml`                                 | Remove `"employees/*"` workspace entry                          |
| `package.json`                                        | Remove `cartridges/*/src/**/*.ts` from format:check script      |
| `packages/schemas/src/employee-events.ts`             | Delete — only consumer was employees/creative/                  |
| `packages/schemas/src/organization-tier.ts`           | Delete — only consumers were core/smb/ and db tier store        |
| `packages/schemas/src/outcome-event.ts`               | Delete — only consumers were core/outcome/ and db outcome store |
| `packages/schemas/src/index.ts`                       | Remove barrel exports for deleted schema files                  |

---

### Task 1: Delete orphaned packages (employees/creative, employee-sdk, memory)

**Files:**

- Delete: `employees/creative/` (entire directory — deprecated AI Creative employee)
- Delete: `packages/employee-sdk/` (entire directory — only consumer was employees/creative/)
- Delete: `packages/memory/` (entire directory — zero consumers)
- Modify: `pnpm-workspace.yaml:4` — remove `"employees/*"` entry
- Modify: `package.json:14` — remove `cartridges/*/src/**/*.ts` from format:check

- [ ] **Step 1: Verify import chains**

```bash
cd /Users/jasonljc/switchboard && grep -r "@switchboard/employee-sdk" --include="*.ts" --include="*.json" packages/ apps/ | grep -v node_modules | grep -v employee-sdk/ | grep -v "employees/"
```

Expected: no output (only consumer is employees/creative/ which we're also deleting)

```bash
grep -r "@switchboard/memory" --include="*.ts" --include="*.json" packages/ apps/ | grep -v node_modules | grep -v "packages/memory/"
```

Expected: no output (zero external imports)

- [ ] **Step 2: Delete the packages**

```bash
rm -rf employees/creative packages/employee-sdk packages/memory
```

- [ ] **Step 3: Remove `"employees/*"` from pnpm-workspace.yaml**

In `pnpm-workspace.yaml`, remove the line:

```yaml
- "employees/*"
```

- [ ] **Step 4: Clean up format:check in root package.json**

In `package.json`, change the `format:check` script from:

```json
"format:check": "prettier --check \"packages/*/src/**/*.ts\" \"apps/*/src/**/*.ts\" \"cartridges/*/src/**/*.ts\""
```

to:

```json
"format:check": "prettier --check \"packages/*/src/**/*.ts\" \"apps/*/src/**/*.ts\""
```

- [ ] **Step 5: Run pnpm install to update lockfile**

```bash
npx pnpm@9.15.4 install
```

Expected: clean install, no missing dependency errors

- [ ] **Step 6: Run typecheck to confirm nothing breaks**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS — these packages had zero app-level consumers

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove orphaned packages (employees/creative, employee-sdk, memory)

These packages had zero app-level consumers:
- employees/creative/ — deprecated AI Creative employee
- packages/employee-sdk/ — only consumer was employees/creative/
- packages/memory/ — brand memory & skill retriever, never imported
Also cleaned up pnpm-workspace.yaml and format:check script.
EOF
)"
```

---

### Task 2: Remove employee and content API routes

**Files:**

- Delete: `apps/api/src/routes/employees.ts`
- Delete: `apps/api/src/routes/__tests__/employees.test.ts`
- Delete: `apps/api/src/routes/content.ts`
- Delete: `apps/api/src/routes/__tests__/content.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts:30-31,59-60`

- [ ] **Step 1: Remove imports and registrations from routes.ts**

In `apps/api/src/bootstrap/routes.ts`, remove these two import lines:

```typescript
import { employeesRoutes } from "../routes/employees.js";
import { contentRoutes } from "../routes/content.js";
```

And remove these two registration lines:

```typescript
await app.register(employeesRoutes, { prefix: "/api/employees" });
await app.register(contentRoutes, { prefix: "/api/content" });
```

- [ ] **Step 2: Delete route files and their tests**

```bash
rm apps/api/src/routes/employees.ts apps/api/src/routes/__tests__/employees.test.ts
rm apps/api/src/routes/content.ts apps/api/src/routes/__tests__/content.test.ts
```

- [ ] **Step 3: Run typecheck on api package**

```bash
npx pnpm@9.15.4 --filter @switchboard/api typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove employee and content API routes

These routes served the deprecated AI employee/content direction.
No frontend or downstream consumer existed for either route group.
EOF
)"
```

---

### Task 3: Remove dead DB stores and their barrel exports

**Files:**

- Delete: `packages/db/src/stores/prisma-employee-store.ts`
- Delete: `packages/db/src/stores/prisma-skill-store.ts`
- Delete: `packages/db/src/stores/prisma-performance-store.ts`
- Delete: `packages/db/src/stores/prisma-content-store.ts`
- Delete: `packages/db/src/stores/prisma-roas-store.ts`
- Delete: `packages/db/src/storage/prisma-outcome-store.ts`
- Modify: `packages/db/src/index.ts:52,72-75`

- [ ] **Step 1: Remove exports from db barrel**

In `packages/db/src/index.ts`, remove these lines:

```typescript
export { PrismaOutcomeStore } from "./storage/prisma-outcome-store.js";
export { PrismaEmployeeStore } from "./stores/prisma-employee-store.js";
export { PrismaSkillStore } from "./stores/prisma-skill-store.js";
export { PrismaPerformanceStore } from "./stores/prisma-performance-store.js";
export { PrismaContentStore } from "./stores/prisma-content-store.js";
```

Also remove `PrismaRoasStore` if it's exported (check the file — it may be exported from `storage/index.ts` instead).

- [ ] **Step 2: Delete store files**

```bash
rm packages/db/src/stores/prisma-employee-store.ts
rm packages/db/src/stores/prisma-skill-store.ts
rm packages/db/src/stores/prisma-performance-store.ts
rm packages/db/src/stores/prisma-content-store.ts
rm packages/db/src/stores/prisma-roas-store.ts
rm packages/db/src/storage/prisma-outcome-store.ts
```

- [ ] **Step 3: Delete test files for these stores**

```bash
rm -f packages/db/src/stores/__tests__/prisma-employee-store.test.ts
rm -f packages/db/src/stores/__tests__/prisma-skill-store.test.ts
rm -f packages/db/src/stores/__tests__/prisma-performance-store.test.ts
rm -f packages/db/src/stores/__tests__/prisma-content-store.test.ts
rm -f packages/db/src/stores/__tests__/prisma-roas-store.test.ts
```

Also check for any outcome store tests:

```bash
find packages/db/src -path "*outcome*test*" -type f
```

Delete any found.

- [ ] **Step 4: Run typecheck on db package**

```bash
npx pnpm@9.15.4 --filter @switchboard/db typecheck
```

Expected: PASS — the routes that imported these stores were already deleted in Task 2

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove dead DB stores (employee, content, skill, roas, outcome)

All deleted stores had zero app-level consumers after route removal.
EOF
)"
```

---

### Task 4: Remove SMB modules from core and unwire from orchestrator

This is the most delicate task. The SMB modules (`tierStore`, `smbActivityLog`) are wired into the orchestrator as **optional** dependencies (null-checked everywhere). We need to remove the fields and all branches that reference them.

**Files:**

- Delete: `packages/core/src/smb/` (entire directory — 6 files)
- Delete: `packages/core/src/__tests__/smb-tier-upgrade.test.ts`
- Delete: `packages/core/src/__tests__/smb-pipeline.test.ts`
- Delete: `packages/core/src/__tests__/smb-activity-log.test.ts`
- Modify: `packages/core/src/index.ts:81`
- Modify: `packages/core/src/orchestrator/lifecycle.ts:63,65,120-121`
- Modify: `packages/core/src/orchestrator/shared-context.ts:44-45,86-88`
- Modify: `packages/core/src/orchestrator/propose-pipeline.ts:131-138`
- Modify: `packages/core/src/orchestrator/approval-manager.ts:165-166,263-264`
- Modify: `packages/core/src/orchestrator/__tests__/helpers.ts:83-84`

- [ ] **Step 1: Read orchestrator files to understand exact removal points**

Read these files to identify the exact code blocks to remove:

- `packages/core/src/orchestrator/lifecycle.ts`
- `packages/core/src/orchestrator/shared-context.ts`
- `packages/core/src/orchestrator/propose-pipeline.ts`
- `packages/core/src/orchestrator/approval-manager.ts`

- [ ] **Step 2: Remove SMB from SharedContext type**

In `packages/core/src/orchestrator/shared-context.ts`:

- Remove `tierStore: TierStore | null;` field
- Remove `smbActivityLog: SmbActivityLog | null;` field
- Remove the `if (!ctx.tierStore || !organizationId)` helper/function that uses tierStore
- Remove imports for `TierStore` and `SmbActivityLog`

- [ ] **Step 3: Remove SMB from LifecycleOrchestrator config**

In `packages/core/src/orchestrator/lifecycle.ts`:

- Remove `tierStore?:` and `smbActivityLog?:` from the config interface
- Remove `tierStore: config.tierStore ?? null,` and `smbActivityLog: config.smbActivityLog ?? null,` from the constructor
- Remove imports for `TierStore` and `SmbActivityLog`

- [ ] **Step 4: Remove SMB branch from propose-pipeline**

In `packages/core/src/orchestrator/propose-pipeline.ts`:

- Remove the entire `if (this.ctx.tierStore && params.organizationId)` block (~lines 131-138)

- [ ] **Step 5: Remove SMB branch from approval-manager**

In `packages/core/src/orchestrator/approval-manager.ts`:

- Remove the `smbConfig` lookup via `this.ctx.tierStore` (~line 165-166)
- Remove the `if (isSmbForAudit && this.ctx.smbActivityLog)` block (~lines 263-264+)
- Remove the `isSmbForAudit` variable if nothing else uses it

- [ ] **Step 6: Remove from test helpers**

In `packages/core/src/orchestrator/__tests__/helpers.ts`:

- Remove `tierStore: null,` and `smbActivityLog: null,` from the mock context

- [ ] **Step 7: Remove SMB barrel export from core index**

In `packages/core/src/index.ts`, remove:

```typescript
// SMB Governance
export * from "./smb/index.js";
```

- [ ] **Step 8: Run typecheck on core package to find any remaining references**

```bash
npx pnpm@9.15.4 --filter @switchboard/core typecheck
```

Fix any remaining references — grep for `TierStore`, `SmbActivityLog`, `tierStore`, `smbActivityLog` in the core package and remove.

- [ ] **Step 9: Delete SMB files and tests**

```bash
rm -rf packages/core/src/smb/
rm -f packages/core/src/__tests__/smb-tier-upgrade.test.ts
rm -f packages/core/src/__tests__/smb-pipeline.test.ts
rm -f packages/core/src/__tests__/smb-activity-log.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove SMB governance modules from core

Unwired tierStore and smbActivityLog from orchestrator (they were
optional/null-checked). Deleted packages/core/src/smb/ entirely.
The SMB tier system is replaced by the marketplace trust score engine.
EOF
)"
```

---

### Task 5: Remove SMB and dead stores from API app wiring

**Files:**

- Modify: `apps/api/src/app.ts:20,39-40,345-346`
- Modify: `apps/api/src/bootstrap/storage.ts:14-15,37-38,104-115,125-126`
- Delete: `packages/db/src/prisma-tier-store.ts`
- Delete: `packages/db/src/prisma-smb-activity-log.ts`
- Modify: `packages/db/src/index.ts:45-46`

- [ ] **Step 1: Remove SMB from storage bootstrap**

In `apps/api/src/bootstrap/storage.ts`:

- Remove imports: `InMemoryTierStore`, `SmbActivityLog`, `InMemorySmbActivityLogStorage`
- Remove type imports: `TierStore`
- Remove `tierStore` and `smbActivityLog` from the `StorageBootstrapResult` interface
- Remove the SMB tier store and activity log bootstrap block (~lines 104-115)
- Remove `tierStore` and `smbActivityLog` from the return object

- [ ] **Step 2: Remove SMB from app.ts**

In `apps/api/src/app.ts`:

- Remove `SmbActivityLog` from the `@switchboard/core` import (line 20)
- Remove `TierStore` from the type import (line 18)
- Remove `tierStore: TierStore;` and `smbActivityLog: SmbActivityLog;` from FastifyInstance declaration (lines 39-40)
- Remove `tierStore` and `smbActivityLog` from the `bootstrapStorage` destructuring (~line 148)
- Remove `tierStore` and `smbActivityLog` from orchestrator config (~line 327)
- Remove `app.decorate("tierStore", tierStore);` and `app.decorate("smbActivityLog", smbActivityLog);` (~lines 344-345)

- [ ] **Step 3: Remove SMB DB stores and exports**

In `packages/db/src/index.ts`, remove:

```typescript
export { PrismaTierStore } from "./prisma-tier-store.js";
export { PrismaSmbActivityLogStorage } from "./prisma-smb-activity-log.js";
```

Then delete the files:

```bash
rm -f packages/db/src/prisma-tier-store.ts packages/db/src/prisma-smb-activity-log.ts
```

- [ ] **Step 4: Run typecheck across all packages**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove SMB wiring from API app and DB stores

Removed tierStore and smbActivityLog from storage bootstrap, app.ts
Fastify decorators, and orchestrator config. Deleted PrismaTierStore
and PrismaSmbActivityLogStorage.
EOF
)"
```

---

### Task 6: Remove outcome modules from core

**Files:**

- Delete: `packages/core/src/outcome/` (entire directory — 4 src + 2 test)
- Modify: `packages/core/src/index.ts:161-164`

- [ ] **Step 1: Remove outcome exports from core index**

In `packages/core/src/index.ts`, remove:

```typescript
// Outcome Pipeline
export { OutcomePipeline } from "./outcome/pipeline.js";
export { OutcomeAggregator } from "./outcome/aggregator.js";
export { runOptimisationCycle } from "./outcome/optimiser.js";
export type { OutcomeStore, OptimisationProposal } from "./outcome/types.js";
```

- [ ] **Step 2: Check for any remaining references**

```bash
cd /Users/jasonljc/switchboard && grep -r "OutcomePipeline\|OutcomeAggregator\|runOptimisationCycle\|OutcomeStore\|OptimisationProposal" --include="*.ts" packages/ apps/ | grep -v node_modules | grep -v "outcome/"
```

Expected: no output (zero references outside the outcome directory)

- [ ] **Step 3: Delete outcome directory**

```bash
rm -rf packages/core/src/outcome/
```

- [ ] **Step 4: Run typecheck**

```bash
npx pnpm@9.15.4 --filter @switchboard/core typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove outcome pipeline from core

OutcomePipeline, OutcomeAggregator, and runOptimisationCycle had zero
app-level consumers. The outcome/ROAS tracking will be replaced by the
marketplace trust score engine.
EOF
)"
```

---

### Task 7: Remove deprecated Prisma models and create migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

Models to remove:

- `EmployeeRegistration` (~line 1069)
- `EmployeeSkill` (~line 1081)
- `EmployeePerformanceEvent` (~line 1098)
- `ContentDraft` (~line 1112)
- `ContentCalendarEntry` (~line 1129)
- `SmbActivityLogEntry` (~line 381)
- `RoasSnapshot` (~line 761)
- `ResponseVariantLog` (~line 508)
- `OptimisationProposal` (~line 525)
- `OutcomeEvent` (~line 494)

- [ ] **Step 1: Read the current schema to identify exact line ranges**

Read `packages/db/prisma/schema.prisma` and identify the exact start/end lines for each model to remove.

- [ ] **Step 2: Remove models from schema**

Remove all 10 model blocks listed above from the schema file. Also remove any relations pointing to these models from other models (check `@@` annotations and relation fields).

- [ ] **Step 3: Check for any enum types only used by deleted models**

Search the schema for enums that were only referenced by the deleted models. Remove those too.

- [ ] **Step 4: Generate Prisma migration**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name remove_deprecated_models --create-only
```

This creates the migration SQL without applying it. Review the generated SQL to confirm it only drops the intended tables.

- [ ] **Step 5: Review the generated migration SQL**

Read the generated migration file and verify:

- It only contains `DROP TABLE` statements for the 10 models
- No other tables are affected
- No data in kept tables is lost

- [ ] **Step 6: Generate Prisma client**

```bash
npx pnpm@9.15.4 db:generate
```

- [ ] **Step 7: Run typecheck across all packages**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS — all code referencing these models was already deleted in Tasks 2-6

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove 10 deprecated Prisma models

Dropped: EmployeeRegistration, EmployeeSkill, EmployeePerformanceEvent,
ContentDraft, ContentCalendarEntry, SmbActivityLogEntry, RoasSnapshot,
ResponseVariantLog, OptimisationProposal, OutcomeEvent.

All code referencing these models was removed in prior commits.
Migration is create-only — apply with `prisma migrate deploy`.
EOF
)"
```

---

### Task 8: Remove deprecated Zod schemas from packages/schemas

**Files:**

- Delete: `packages/schemas/src/employee-events.ts` — only consumer was employees/creative/ (deleted in Task 1)
- Delete: `packages/schemas/src/organization-tier.ts` — only consumers were core/smb/ and db tier store (deleted in Tasks 4-5)
- Delete: `packages/schemas/src/outcome-event.ts` — only consumers were core/outcome/ and db outcome store (deleted in Tasks 3,6)
- Modify: `packages/schemas/src/index.ts` — remove barrel exports for deleted files

- [ ] **Step 1: Verify no remaining consumers**

```bash
cd /Users/jasonljc/switchboard && grep -r "employee-events\|organization-tier\|outcome-event" --include="*.ts" packages/ apps/ | grep -v node_modules | grep -v "packages/schemas/"
```

Expected: no output — all consumers were deleted in prior tasks

- [ ] **Step 2: Remove barrel exports from schemas index**

In `packages/schemas/src/index.ts`, remove the export lines for:

- `employee-events`
- `organization-tier`
- `outcome-event`

- [ ] **Step 3: Delete schema files**

```bash
rm -f packages/schemas/src/employee-events.ts
rm -f packages/schemas/src/organization-tier.ts
rm -f packages/schemas/src/outcome-event.ts
```

- [ ] **Step 4: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: remove deprecated Zod schemas (employee-events, organization-tier, outcome-event)

All consumers of these schemas were removed in prior cleanup commits.
EOF
)"
```

---

### Task 9: Final verification — full build and test

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS

- [ ] **Step 2: Run full lint**

```bash
npx pnpm@9.15.4 lint
```

Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Run full test suite**

```bash
npx pnpm@9.15.4 test
```

Expected: PASS — all tests for deleted code were removed alongside the code. Existing governance tests should still pass.

- [ ] **Step 4: Verify governance engine tests specifically**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test
```

Expected: PASS — the policy engine, approval state machine, competence tracker, and audit ledger tests should all pass unchanged.

- [ ] **Step 5: Run build**

```bash
npx pnpm@9.15.4 build
```

Expected: PASS

- [ ] **Step 6: Verify app boots**

```bash
cd /Users/jasonljc/switchboard && timeout 10 npx pnpm@9.15.4 --filter @switchboard/api dev 2>&1 | head -20 || true
```

Expected: server starts without import errors

---

## Summary

| Metric                          | Count                                                 |
| ------------------------------- | ----------------------------------------------------- |
| Packages deleted                | 3 (employees/creative, employee-sdk, memory)          |
| Route files deleted             | 2 (employees, content) + 2 tests                      |
| DB store files deleted          | 6 stores + 5 tests                                    |
| Core module directories deleted | 2 (smb/, outcome/)                                    |
| Prisma models removed           | 10                                                    |
| Schema files removed            | 3 (employee-events, organization-tier, outcome-event) |
| Files modified (unwiring)       | ~14                                                   |
| Estimated total files removed   | ~65                                                   |
| Governance tests affected       | 0 (all preserved)                                     |

After cleanup, the remaining codebase is:

- **Core governance engine** — policy engine, approval state machine, competence tracker, audit ledger (fully tested, untouched)
- **API app** — 23 route groups (down from 25), orchestrator, auth, health checks
- **Dashboard** — 14 pages (all clean of old-direction references)
- **Chat app** — multi-channel handlers, dialogue system (needs stale action-type string cleanup in a future task)
- **MCP server** — governance bridge for LLM tool use
- **DB layer** — ~32 models (down from 42), all stores for kept models
