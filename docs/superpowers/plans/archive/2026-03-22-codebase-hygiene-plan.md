# Codebase Hygiene Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up dead references, fix code quality violations, and raise digital-ads test coverage above its 55% threshold.

**Architecture:** Three workstreams executed sequentially — (A) remove stale docs/references, (B) fix `any` types and remove dead code, (C) add tests to the lowest-coverage digital-ads modules to cross the 55% line. No structural changes to production code.

**Tech Stack:** TypeScript, Vitest, Prisma, ESLint

---

## File Map

### Workstream A — Stale Docs & References (delete/modify only)

| Action | File                                                              | Reason                                                                         |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Delete | `PLAN-V1.md`                                                      | 796-line legacy plan, references removed modules                               |
| Delete | `docs/superpowers/plans/2026-03-20-phase2-messaging-cartridge.md` | References deleted `cartridges/messaging/`                                     |
| Delete | `cartridges/revenue-growth/src/cartridge/actions/`                | Empty directory                                                                |
| Modify | `.claude/skills/gate/SKILL.md:73`                                 | Remove `@switchboard/quant-trading` from blocklist                             |
| Modify | `docs/plans/2026-03-16-gate-skill-implementation.md:96`           | Remove `@switchboard/quant-trading` from blocklist                             |
| Modify | `README.md:59-75`                                                 | Add `packages/agents` and `packages/create-switchboard-cartridge` to structure |

### Workstream B — Code Quality

| Action | File                                                              | Reason                                         |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| Modify | `apps/api/src/routes/scheduled-reports.ts:163`                    | `catch (err: any)` → `catch (err: unknown)`    |
| Modify | `apps/api/src/alerts/notifier.ts:103`                             | `catch (err: any)` → `catch (err: unknown)`    |
| Modify | `apps/dashboard/src/app/api/dashboard/identity/route.ts:11,25,40` | 3x `catch (err: any)` → `catch (err: unknown)` |

> **Note:** Additional `any` usages exist in test files (e.g., `dual-mode-integration.test.ts`). These are excluded from this sweep — test mocking patterns often require `any` for pragmatic reasons.

### Workstream C — Digital-Ads Test Coverage

Current: 50.99% statements (threshold: 55%). Need ~220 more covered statements.

Target modules (0% coverage, moderate size, pure logic):

| Action | File                                                                                 | Lines | Why                          |
| ------ | ------------------------------------------------------------------------------------ | ----- | ---------------------------- |
| Create | `cartridges/digital-ads/src/skills/__tests__/funnel-diagnostic.test.ts`              | ~120  | 245-line module, 0% coverage |
| Create | `cartridges/digital-ads/src/skills/__tests__/multi-platform-diagnostic.test.ts`      | ~60   | 63-line module, 0% coverage  |
| Create | `cartridges/digital-ads/src/config/__tests__/loader.test.ts`                         | ~80   | 115-line module, 0% coverage |
| Create | `cartridges/digital-ads/src/notifications/__tests__/notification-dispatcher.test.ts` | ~100  | 259-line module, 1% coverage |
| Create | `cartridges/digital-ads/src/compliance/__tests__/compliance-auditor.test.ts`         | ~80   | 135-line module, 8% coverage |
| Create | `cartridges/digital-ads/src/pacing/__tests__/pacing-monitor.test.ts`                 | ~80   | 222-line module, 7% coverage |

---

## Tasks

### Task 1: Delete Stale Documents

**Files:**

- Delete: `PLAN-V1.md`
- Delete: `docs/superpowers/plans/2026-03-20-phase2-messaging-cartridge.md`
- Delete: `cartridges/revenue-growth/src/cartridge/actions/` (empty dir)

- [ ] **Step 1: Delete PLAN-V1.md**

```bash
rm PLAN-V1.md
```

- [ ] **Step 2: Delete stale messaging cartridge plan**

```bash
rm docs/superpowers/plans/2026-03-20-phase2-messaging-cartridge.md
```

- [ ] **Step 3: Remove empty actions directory**

```bash
rmdir cartridges/revenue-growth/src/cartridge/actions
```

- [ ] **Step 4: Verify no imports reference these files**

```bash
grep -r "PLAN-V1" --include="*.ts" --include="*.md" . | grep -v node_modules
grep -r "phase2-messaging" --include="*.ts" --include="*.md" . | grep -v node_modules
```

Expected: No matches (these are standalone documents, not imported).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: delete stale PLAN-V1, messaging plan, and empty actions dir"
```

---

### Task 2: Remove Stale quant-trading References

**Files:**

- Modify: `.claude/skills/gate/SKILL.md:73`
- Modify: `docs/plans/2026-03-16-gate-skill-implementation.md:96`

- [ ] **Step 1: Edit gate skill**

In `.claude/skills/gate/SKILL.md` line 73, remove `, @switchboard/quant-trading` from the blocklist string. The line currently reads:

```
- In `packages/core/` files: flag any import from `@switchboard/digital-ads`, `@switchboard/customer-engagement`, `@switchboard/payments`, `@switchboard/crm`, `@switchboard/quant-trading`, `@switchboard/revenue-growth`, or `@switchboard/db`
```

Change to:

```
- In `packages/core/` files: flag any import from `@switchboard/digital-ads`, `@switchboard/customer-engagement`, `@switchboard/payments`, `@switchboard/crm`, `@switchboard/revenue-growth`, or `@switchboard/db`
```

- [ ] **Step 2: Edit gate plan doc**

Same change in `docs/plans/2026-03-16-gate-skill-implementation.md` line 96.

- [ ] **Step 3: Verify no other stale references**

```bash
grep -rn "quant-trading" --include="*.md" --include="*.ts" --include="*.json" . | grep -v node_modules | grep -v pnpm-lock
```

Expected: No matches.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove stale quant-trading references from skill docs"
```

---

### Task 3: Update README Project Structure

**Files:**

- Modify: `README.md:59-75`

- [ ] **Step 1: Update the packages section**

In `README.md`, find the project structure block (around line 59) and update the `packages/` section to include `agents` and `create-switchboard-cartridge`. Also add `revenue-growth` to cartridges since it's missing.

Change:

```
├── packages/
│   ├── schemas          # Zod domain types (Envelope, Policy, RiskScore, etc.)
│   ├── core             # Policy engine, risk scorer, orchestrator, audit ledger
│   ├── cartridge-sdk    # SDK for building cartridges (ActionBuilder, TestCartridge)
│   └── db               # Prisma schema and client
├── cartridges/
│   ├── digital-ads      # Meta/Google Ads cartridge (pause, resume, budget, targeting)
│   ├── payments         # Payments cartridge (Stripe invoices, refunds, payouts)
│   ├── crm              # CRM cartridge (contacts, deals, activities)
│   └── customer-engagement # Customer engagement cartridge (appointments, messaging)
```

To:

```
├── packages/
│   ├── schemas          # Zod domain types (Envelope, Policy, RiskScore, etc.)
│   ├── core             # Policy engine, risk scorer, orchestrator, audit ledger
│   ├── cartridge-sdk    # SDK for building cartridges (ActionBuilder, TestCartridge)
│   ├── db               # Prisma schema and client
│   ├── agents           # Agent runtime — EventLoop, LLM infra, escalation, concurrency
│   └── create-switchboard-cartridge  # Scaffolding CLI for new cartridges
├── cartridges/
│   ├── digital-ads      # Multi-platform ad management (Meta, Google, TikTok)
│   ├── payments         # Stripe-backed payment operations
│   ├── crm              # Contacts, deals, activities, pipeline
│   ├── customer-engagement # Leads, conversations, appointments, cadences
│   └── revenue-growth   # Autonomous revenue optimization (Theory of Constraints)
```

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "docs: update README project structure with agents and all cartridges"
```

---

### Task 4: Fix `any` Types in Error Handlers

**Files:**

- Modify: `apps/api/src/routes/scheduled-reports.ts:163`
- Modify: `apps/api/src/alerts/notifier.ts:103`
- Modify: `apps/dashboard/src/app/api/dashboard/identity/route.ts:11,25,40`

- [ ] **Step 1: Fix scheduled-reports.ts**

At line 163, change:

```typescript
} catch (err: any) {
```

To:

```typescript
} catch (err: unknown) {
```

Then find where `err.message` is used in that catch block and wrap it:

```typescript
const message = err instanceof Error ? err.message : String(err);
```

- [ ] **Step 2: Fix notifier.ts**

Same pattern at line 103. Change `err: any` to `err: unknown`, then wrap `err.message` usage:

```typescript
const message = err instanceof Error ? err.message : String(err);
```

- [ ] **Step 3: Fix identity/route.ts**

Three catch blocks at lines 11, 25, and 40. Same pattern for each:

```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: All 25 packages pass.

- [ ] **Step 5: Run tests**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "fix: replace catch(err: any) with catch(err: unknown) in error handlers"
```

---

### Task 5: Add Tests for digital-ads Skills Module

**Files:**

- Create: `cartridges/digital-ads/src/skills/__tests__/funnel-diagnostic.test.ts`
- Create: `cartridges/digital-ads/src/skills/__tests__/multi-platform-diagnostic.test.ts`
- Reference: `cartridges/digital-ads/src/skills/funnel-diagnostic.ts` (245 lines)
- Reference: `cartridges/digital-ads/src/skills/multi-platform-diagnostic.ts` (63 lines)

**Context:** These modules are at 0% coverage. `funnel-diagnostic.ts` exports `runFunnelDiagnostic()` and `formatDiagnostic()`. `multi-platform-diagnostic.ts` exports `formatMultiPlatformDiagnostic()` and re-exports `runMultiPlatformDiagnostic`. They depend on platform clients and analysis modules — mock all external dependencies.

- [ ] **Step 1: Read source files to understand interfaces**

```bash
cat cartridges/digital-ads/src/skills/funnel-diagnostic.ts
cat cartridges/digital-ads/src/skills/multi-platform-diagnostic.ts
```

- [ ] **Step 2: Create `__tests__` directory**

```bash
mkdir -p cartridges/digital-ads/src/skills/__tests__
```

- [ ] **Step 3: Write funnel-diagnostic tests**

Create `cartridges/digital-ads/src/skills/__tests__/funnel-diagnostic.test.ts`. Mock all imports from `../core/analysis/`, `../platforms/registry`, and `../advisors/registry`. Test:

- `runFunnelDiagnostic()` calls the analysis pipeline in correct order
- `runFunnelDiagnostic()` passes platform credentials through
- `formatDiagnostic()` returns a human-readable string from a DiagnosticResult
- `formatDiagnostic()` handles empty findings array

- [ ] **Step 4: Write multi-platform-diagnostic tests**

Create `cartridges/digital-ads/src/skills/__tests__/multi-platform-diagnostic.test.ts`. Test:

- `formatMultiPlatformDiagnostic()` includes executive summary
- `formatMultiPlatformDiagnostic()` formats per-platform results
- `formatMultiPlatformDiagnostic()` handles correlations

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @switchboard/digital-ads test
```

Expected: All tests pass including new ones.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test(digital-ads): add tests for skills module (funnel + multi-platform diagnostic)"
```

---

### Task 6: Add Tests for digital-ads Config Loader

**Files:**

- Create: `cartridges/digital-ads/src/config/__tests__/loader.test.ts`
- Reference: `cartridges/digital-ads/src/config/loader.ts` (115 lines)
- Reference: `cartridges/digital-ads/src/config/types.ts` (62 lines)

**Context:** This module is at 0% coverage. Exports `loadConfig()` (reads JSON file, resolves env vars) and `buildConfig()` (runtime config builder with defaults). Pure functions, easy to test.

- [ ] **Step 1: Read source file**

```bash
cat cartridges/digital-ads/src/config/loader.ts
cat cartridges/digital-ads/src/config/types.ts
```

- [ ] **Step 2: Create `__tests__` directory**

```bash
mkdir -p cartridges/digital-ads/src/config/__tests__
```

- [ ] **Step 3: Write loader tests**

Create `cartridges/digital-ads/src/config/__tests__/loader.test.ts`. Mock `node:fs` for `readFileSync`. Test:

- `loadConfig()` parses JSON and returns AccountConfig
- `loadConfig()` resolves `$ENV_VAR` references in credentials from `process.env`
- `buildConfig()` applies defaults for optional fields
- `buildConfig()` preserves required fields as-is
- `loadConfig()` throws on invalid JSON

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/digital-ads test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(digital-ads): add tests for config loader"
```

---

### Task 7: Add Tests for digital-ads Notification Dispatcher

**Files:**

- Create: `cartridges/digital-ads/src/notifications/__tests__/notification-dispatcher.test.ts`
- Reference: `cartridges/digital-ads/src/notifications/notification-dispatcher.ts` (259 lines)
- Reference: `cartridges/digital-ads/src/notifications/types.ts` (70 lines)

**Context:** This module is at 1% coverage. The `NotificationDispatcher` class sends alerts to configured channels (webhook, slack, email). Mock all channel implementations.

- [ ] **Step 1: Read source files**

```bash
cat cartridges/digital-ads/src/notifications/notification-dispatcher.ts
cat cartridges/digital-ads/src/notifications/types.ts
```

- [ ] **Step 2: Create `__tests__` directory**

```bash
mkdir -p cartridges/digital-ads/src/notifications/__tests__
```

- [ ] **Step 3: Write dispatcher tests**

Create `cartridges/digital-ads/src/notifications/__tests__/notification-dispatcher.test.ts`. Mock channel modules. Test:

- Constructor accepts channel configs
- `dispatch()` sends to all configured channels
- `dispatch()` continues on individual channel failure (fan-out resilience)
- `dispatch()` returns per-channel results
- `dispatchAnomaly()` / `dispatchBudgetForecast()` / `dispatchPolicyScan()` format payloads correctly

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/digital-ads test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(digital-ads): add tests for notification dispatcher"
```

---

### Task 8: Add Tests for digital-ads Compliance Auditor

**Files:**

- Create: `cartridges/digital-ads/src/compliance/__tests__/compliance-auditor.test.ts`
- Reference: `cartridges/digital-ads/src/compliance/compliance-auditor.ts` (135 lines)
- Reference: `cartridges/digital-ads/src/compliance/types.ts` (34 lines)

**Context:** This module is at 8% coverage. Pure compliance checking logic — reviews ad content against policy rules.

- [ ] **Step 1: Read source files**

```bash
cat cartridges/digital-ads/src/compliance/compliance-auditor.ts
cat cartridges/digital-ads/src/compliance/types.ts
```

- [ ] **Step 2: Create `__tests__` directory**

```bash
mkdir -p cartridges/digital-ads/src/compliance/__tests__
```

- [ ] **Step 3: Write compliance auditor tests**

Create `cartridges/digital-ads/src/compliance/__tests__/compliance-auditor.test.ts`. Test the core audit functions — mock any external data fetching but test the rule evaluation logic directly.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/digital-ads test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(digital-ads): add tests for compliance auditor"
```

---

### Task 9: Add Tests for digital-ads Pacing Monitor

**Files:**

- Create: `cartridges/digital-ads/src/pacing/__tests__/pacing-monitor.test.ts`
- Reference: `cartridges/digital-ads/src/pacing/pacing-monitor.ts` (222 lines)
- Reference: `cartridges/digital-ads/src/pacing/types.ts` (33 lines)

**Context:** This module is at 7% coverage. Monitors campaign pacing (spend rate vs budget over time).

- [ ] **Step 1: Read source files**

```bash
cat cartridges/digital-ads/src/pacing/pacing-monitor.ts
cat cartridges/digital-ads/src/pacing/types.ts
```

- [ ] **Step 2: Create `__tests__` directory**

```bash
mkdir -p cartridges/digital-ads/src/pacing/__tests__
```

- [ ] **Step 3: Write pacing monitor tests**

Create `cartridges/digital-ads/src/pacing/__tests__/pacing-monitor.test.ts`. Test pacing calculations — these are mostly math/logic functions. Mock data sources.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/digital-ads test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(digital-ads): add tests for pacing monitor"
```

---

### Task 10: Verify Coverage Threshold and Final PR

**Files:** None (verification only)

- [ ] **Step 1: Run digital-ads coverage**

```bash
pnpm --filter @switchboard/digital-ads test -- --coverage
```

Expected: Statements >= 55%, Branches >= 55%, Functions >= 60%, Lines >= 55%.

If still under threshold, identify the next-lowest coverage module and add tests until the threshold is met.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: All 24 suites pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: All 25 packages pass.

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit any remaining changes and push**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 6: Create PR**

Title: `chore: codebase hygiene — stale docs, any types, digital-ads coverage`

Body should summarize all three workstreams with stats.
