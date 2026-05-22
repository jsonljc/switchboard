# Route Governance Contract v1 — Impl PR-2 Plan: Cross-App Type Relocation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move five cross-boundary types into `@switchboard/schemas` so every app consumes one canonical declaration, eliminate the 4 surface-URL string sites in core, and add a `check-routes` advisory that catches future local re-declarations.

**Architecture:** Each type relocation is a paired commit — _introduce schema, then migrate consumers_ — so the schema is always the upstream source. `DashboardOverviewSchema` keeps a back-compat alias to `OperatorOverviewSchema` so cockpit-v2 consumers (and any unmigrated dashboard caller) continue to compile; PR-4 removes the alias. Core projections take a `routeTemplates` dependency injected by each surface adapter at the API boundary, completing the surface-agnostic-backend principle. The `check-routes` extension parses local `interface` / `type` declarations under `apps/*/src/**`, cross-references the live `@switchboard/schemas` export set, and emits a warning on collision.

**Tech Stack:** Zod (schema definitions), TypeScript (strict; no `any`), Vitest (TDD), pnpm/Turborepo monorepo, ts-morph (check-routes AST traversal).

**Consumes:** `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` (Sections 8.1–8.6, §11 crosswalk, §12 PR-2 scope). PR-1 (#614, merged 2026-05-22 → `5617dbf0`) is independent — PR-2 does not depend on the operator-direct cohort migration, but `recommendations.ts` is a Cohort A route on `main` whose imports PR-2 leaves untouched.

**Out of scope (deferred to PR-3 / PR-4):**

- Store-layer mutation contract sweep (PR-3).
- `verdictStore.save as any` removal (PR-3).
- Removal of the `DashboardOverview` back-compat alias (PR-4 — gated on grepping zero remaining references first).
- `@route-class:` header backfill for the remaining ~63 routes (PR-4).
- Flipping `check-routes` cross-app-type rule from warning to error (PR-4).

---

## Pre-flight verification — done during plan-writing

Captured here so the implementing agent does not redo this work and so future reviewers can audit the assumptions.

| Question                                                                      | Answer (verified 2026-05-22 on `main` at `5617dbf0`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `ApprovalRecord` still appear locally in 4 sites?                        | Yes. `apps/api/src/routes/dashboard-overview.ts:64`, `packages/core/src/platform/platform-lifecycle.ts:36`, `packages/db/src/storage/prisma-approval-store.ts:6`, `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts:71` (test helper `makeApprovalRecord`).                                                                                                                                                                                                                                                                                                                                                         |
| Does `ApprovalStateSchema` exist in `@switchboard/schemas`?                   | **No.** `ApprovalState` exists only as a TypeScript `interface` in `packages/core/src/approval/state-machine.ts:17`. PR-2 must hoist it into schemas as a Zod schema before `ApprovalRecordSchema` can compose it (Task 1).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Where does `ConversationState` already live in schemas?                       | `packages/schemas/src/chat.ts:48` defines `ConversationStateSchema`. The schema covers MOST fields but is missing 4: `messages`, `leadProfile`, `detectedLanguage`, `machineState`. The chat-side `ConversationStateData` interface at `apps/chat/src/conversation/state.ts:10` is therefore a superset, not a redeclaration of an identical shape. PR-2 expands the schema to the canonical superset (Task 6).                                                                                                                                                                                                                                 |
| Where do `ConversationRow`, `ConversationSummary`, `ConversationDetail` live? | Local interfaces in `apps/api/src/routes/conversations.ts:20-66`. None exist in schemas yet. **Naming collision:** `ConversationSummary` is also the name of an interface in `packages/core/src/handoff/types.ts:34` with a completely different shape. Resolving this collision is one of PR-2's load-bearing micro-decisions (Tasks 4 + 7).                                                                                                                                                                                                                                                                                                   |
| Where does `Handoff` currently live?                                          | `packages/core/src/handoff/types.ts` exports `HandoffPackage` (the canonical shape), `LeadSnapshot`, `QualificationSnapshot`, `ConversationSummary` (handoff-flavored), `HandoffReason`, `HandoffStatus`, `HandoffStore`. The spec's §8.3 proposal does NOT match the existing shape — the existing shape is richer and is already wired through `escalations.ts` + `handoff-adapter.ts`. PR-2 hoists the _existing_ canonical shape (renamed `HandoffPackage` → `Handoff`) into schemas rather than introducing a parallel shape (Tasks 4 + 5).                                                                                                |
| Where is `DashboardOverview` defined and consumed?                            | Defined at `packages/schemas/src/dashboard.ts:3`. Consumed at: `apps/api/src/routes/dashboard-overview.ts:6,95,98,275`, `apps/dashboard/src/lib/api-client/dashboard.ts:4,48,49`, `apps/dashboard/src/hooks/use-dashboard-overview.ts:5,7,13`, `apps/dashboard/src/app/api/dashboard/overview/route.ts:10`. **No references inside `apps/dashboard/src/components/cockpit/**`\*\* (grep verified). The back-compat alias is still mandatory because the dashboard-side consumers are 3 separate sites; PR-2 migrates all of them, and PR-4 removes the alias once grep returns 0.                                                               |
| Where are the 4 surface-URL string sites in core?                             | Verified 3 of 4: `packages/core/src/contacts/list.ts:63` (`detailHref: \`/contacts/${c.id}\``), `packages/core/src/decisions/adapters/handoff-adapter.ts:22` (`\`/contacts/${contact?.id}/conversations/${thread.id}\``), `packages/core/src/decisions/adapters/recommendation-adapter.ts:48` (`\`/contacts/${contactId}/conversations\``). The 4th (`packages/core/src/contacts/detail.ts:39`) was not visible at exact line 39 during plan-writing — the file's `openDecisions`builder is the likely site. Task 10 includes a verification grep to find any remaining`/contacts/${...}` literal in core before declaring routeTemplates done. |
| Is there any `@route-class:` work in PR-2 scope?                              | No. PR-1 added headers to the 4 operator-direct routes. PR-2's only `check-routes` touch is the cross-app-type rule extension. Header backfill is PR-4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Collision risk with cockpit-v2

Grep `apps/dashboard/src/components/cockpit/**` for `DashboardOverview` → **0 hits**. Cockpit consumers do not import this type. The PR-2 migration touches `apps/dashboard/src/hooks/use-dashboard-overview.ts` + `apps/dashboard/src/lib/api-client/dashboard.ts` + `apps/dashboard/src/app/api/dashboard/overview/route.ts` (3 sites). All 3 are outside the cockpit tree. The back-compat alias is still kept (mandatory per spec §8.4) so any future cockpit consumer that picks up `DashboardOverview` indirectly continues to compile until PR-4.

No coordination with the cockpit-v2 owner is required for PR-2.

---

## File structure

### Create

| Path                                                   | Responsibility                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/approval.ts`                     | `ApprovalStateSchema` (hoisted from core interface) + `ApprovalRecordSchema` + derived types.                                                                                                                                                                                                                                                                                               |
| `packages/schemas/src/__tests__/approval.test.ts`      | Schema parse/round-trip tests.                                                                                                                                                                                                                                                                                                                                                              |
| `packages/schemas/src/handoff.ts`                      | `HandoffSchema` (renamed from core `HandoffPackage`) + leaf schemas (`LeadSnapshotSchema`, `QualificationSnapshotSchema`, `HandoffConversationSummarySchema`, `HandoffReasonSchema`, `HandoffStatusSchema`).                                                                                                                                                                                |
| `packages/schemas/src/__tests__/handoff.test.ts`       | Schema parse/round-trip tests.                                                                                                                                                                                                                                                                                                                                                              |
| `packages/schemas/src/conversations.ts`                | `ConversationMessageSchema` + projection schemas `ConversationSummarySchema` + `ConversationDetailSchema` + `ConversationListResultSchema`. (Lives in its own file rather than `chat.ts` because `chat.ts` is already at moderate size and "conversations" is a distinct concern — the canonical projection for the api's `conversations.ts` route, not the channel-gateway runtime state.) |
| `packages/schemas/src/__tests__/conversations.test.ts` | Schema parse/round-trip tests for the projection schemas.                                                                                                                                                                                                                                                                                                                                   |
| `.agent/tools/cross-app-type-check.ts`                 | `findLocalCrossAppTypeDeclarations(sources, schemaExports): Warning[]` — scans `apps/**/src/**` for `interface X { ... }` or `type X = ...` whose `X` matches a name in `schemaExports`. Pure function.                                                                                                                                                                                     |
| `.agent/tools/__tests__/cross-app-type-check.test.ts`  | Vitest suite for the helper.                                                                                                                                                                                                                                                                                                                                                                |

### Modify

| Path                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/chat.ts`                                                       | Extend `ConversationStateSchema` with `messages`, `leadProfile`, `detectedLanguage`, `machineState` so the chat-side `ConversationStateData` becomes a pure consumer (was a strict superset).                                                                                                                                                                                 |
| `packages/schemas/src/index.ts`                                                      | Add 3 barrel re-exports: `approval.js`, `handoff.js`, `conversations.js`.                                                                                                                                                                                                                                                                                                     |
| `packages/schemas/src/dashboard.ts`                                                  | Rename `DashboardOverviewSchema` → `OperatorOverviewSchema`; add back-compat alias `DashboardOverviewSchema = OperatorOverviewSchema` + `type DashboardOverview = OperatorOverview` with a comment flagging PR-4 removal.                                                                                                                                                     |
| `packages/core/src/approval/state-machine.ts`                                        | Replace local `interface ApprovalState` with `type ApprovalState = z.infer<typeof ApprovalStateSchema>` imported from `@switchboard/schemas`. Re-export for back-compat at `packages/core/src/approval/index.ts`.                                                                                                                                                             |
| `packages/core/src/platform/platform-lifecycle.ts`                                   | Replace `type ApprovalRecord = NonNullable<Awaited<ReturnType<CoreApprovalStore["getById"]>>>` (line 36) with `import type { ApprovalRecord } from "@switchboard/schemas"`.                                                                                                                                                                                                   |
| `packages/db/src/storage/prisma-approval-store.ts`                                   | Replace local `type ApprovalRecord = { ... }` (line 6) with import; `toApprovalRecord` becomes the row→schema mapper.                                                                                                                                                                                                                                                         |
| `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts`       | Replace `makeApprovalRecord(overrides): ApprovalRecord` local-typed helper with the imported schema type.                                                                                                                                                                                                                                                                     |
| `apps/api/src/routes/dashboard-overview.ts`                                          | Remove local `interface ApprovalRecord` (lines 64-73); import from `@switchboard/schemas`. Rename `buildDashboardOverview` → `buildOperatorOverview` and update its return type. (The function rename is internal — the route's URL stays `/api/dashboard/overview`.)                                                                                                         |
| `packages/core/src/handoff/types.ts`                                                 | Replace each `export interface` / `export type` with a re-export from `@switchboard/schemas` (`HandoffPackage` becomes `Handoff` from schemas; keep a `HandoffPackage` alias for back-compat during the migration). `HandoffStore` stays in core (it's a store interface, not a cross-app value type — appropriate location).                                                 |
| `apps/api/src/routes/escalations.ts`                                                 | Update imports to pull `Handoff` shape from `@switchboard/schemas` where the route currently relies on ad-hoc shapes (lines 100, 182, 191-204, 311-322). The Prisma `Handoff` row shape and the schema type need a Zod-or-mapper boundary — Task 5 picks the minimal-change option.                                                                                           |
| `packages/core/src/decisions/adapters/handoff-adapter.ts`                            | Update `HandoffPackage` import (line 2) to source from schemas via the core re-export. Replace inline `\`/contacts/${contact?.id}/conversations/${thread.id}\``(line 22) with`deps.routeTemplates.contactConversation(contact?.id ?? "", thread.id)`.                                                                                                                         |
| `apps/chat/src/conversation/state.ts`                                                | Replace local `interface ConversationStateData` + `interface ConversationMessage` with re-exports of the schema types from `@switchboard/schemas`. Helpers (`createConversation`, `transitionConversation`) stay in this file.                                                                                                                                                |
| `apps/chat/src/conversation/store.ts`                                                | No change to logic — only the import switches from `./state.js` to `@switchboard/schemas`. Same for `apps/chat/src/conversation/prisma-store.ts` and `apps/chat/src/conversation/threads.ts`.                                                                                                                                                                                 |
| `apps/api/src/routes/conversations.ts`                                               | Remove local `interface ConversationRow`, `ConversationSummary`, `ConversationDetail`, `ConversationListResult` (lines 20-66). Import the projection types from `@switchboard/schemas`. The route's runtime logic is unchanged.                                                                                                                                               |
| `packages/core/src/contacts/list.ts`                                                 | Add `routeTemplates: { contactDetail(id: string): string }` to `ListContactsDeps`. Replace `\`/contacts/${c.id}\``(line 63) with`deps.routeTemplates.contactDetail(c.id)`.                                                                                                                                                                                                    |
| `packages/core/src/contacts/detail.ts`                                               | Add `routeTemplates` to `ContactDetailDeps`. Replace any `/contacts/${...}` literal found in the file with the appropriate template call (Task 10 grep step locates the exact line — likely inside `buildContactDetailOpenDecisions`).                                                                                                                                        |
| `packages/core/src/decisions/adapters/recommendation-adapter.ts`                     | Take `routeTemplates` as a parameter on `adaptRecommendation` (or thread through the adapter's call site). Replace `\`/contacts/${contactId}/conversations\``(line 48) with`routeTemplates.contactConversations(contactId)`.                                                                                                                                                  |
| `apps/api/src/routes/dashboard-contacts.ts`                                          | Construct `routeTemplates` at the boundary and pass into `listContactsForBrowse` + `getContactDetail` calls. (Verify file name during impl — the file housing the `/api/dashboard/contacts` route is the consumer of these core projections.)                                                                                                                                 |
| `apps/api/src/bootstrap/decisions.ts` (or wherever the decisions adapters are wired) | Same `routeTemplates` injection at the boundary. Task 11 locates the exact wire point during impl.                                                                                                                                                                                                                                                                            |
| `docs/DOCTRINE.md`                                                                   | Add the cross-app-types doctrine line per spec §8.6.                                                                                                                                                                                                                                                                                                                          |
| `.agent/tools/check-routes.ts`                                                       | Add a new pass that invokes `findLocalCrossAppTypeDeclarations` and prints warnings (do not change exit-code semantics; the rule lands in warning mode per spec §8.6).                                                                                                                                                                                                        |
| `.github/workflows/ci.yml`                                                           | The existing `architecture` job already runs `check-routes` after PR-1's warning-mode wiring; no workflow change is needed if the new pass is invoked inline. **Verify during impl** — if PR-1 wired `check-routes` only behind a `--mode=warn-touched` flag, decide whether the cross-app-type warning rides that same flag or runs unconditionally. Task 13 makes the call. |

### Untouched but worth noting

- `apps/mcp-server/src/server.ts:101` defines `MinimalApprovalRecord` as a deliberately-narrower local shape (the MCP server only consumes a subset of `ApprovalRecord` fields). This is **not** a cross-app duplication — the name is different and the shape is intentionally minimal. PR-2 leaves it alone; PR-4's check-routes rule will not match because the name differs.
- `packages/core/src/approval/respond-to-approval.ts:81` defines `ApprovalRecordForResponse`. Same situation: a narrower local shape with a different name. Not in scope for PR-2.
- `packages/db/src/storage/prisma-approval-store.ts` keeps its `toApprovalRecord(row): ApprovalRecord` row-to-schema mapper. PR-2 only narrows the return type; the function body stays.
- `apps/api/src/routes/escalations.ts` uses `app.prisma.handoff.update({...})` directly — the Prisma row type stays inside the route boundary. PR-2's job is to make the route emit / consume `Handoff` shape at its external interfaces (request bodies, response payloads), not to refactor the Prisma access pattern. The mapping happens in the response builders.
- `packages/core/src/handoff/types.ts` keeps `HandoffStore` (store interface — appropriate location per the dependency layer rule).

---

## Implementation tasks

### Task 0: Preflight — confirm pre-flight verification results

This task is a hard blocker — if any assumption in the "Pre-flight verification" table above is now stale (e.g., a new PR landed and moved a file), the subsequent tasks may misfire.

**Files:** read-only audit.

- [ ] **Step 1: Confirm `main` HEAD.**

Run:

```bash
git -C /Users/jasonli/switchboard log --oneline -1 origin/main
```

Expected: `5617dbf0 feat(audit): Route Governance Contract v1 — Impl PR-1 ...` OR a later commit. If the head is different, scan the new commits for any movement of the files listed in the "Modify" table — particularly `packages/db/src/storage/prisma-approval-store.ts`, `apps/api/src/routes/dashboard-overview.ts`, and `apps/chat/src/conversation/state.ts`. If a file has moved or its local interface has been removed by an earlier change, update the plan inline and proceed.

- [ ] **Step 2: Re-grep the 4 `ApprovalRecord` local sites.**

Run:

```bash
rg -n 'ApprovalRecord' apps packages --type ts | grep -v node_modules | grep -v __tests__ | grep -E 'interface ApprovalRecord|type ApprovalRecord'
```

Expected: 3 hits (`apps/api/src/routes/dashboard-overview.ts:64` interface, `packages/db/src/storage/prisma-approval-store.ts:6` type, `packages/core/src/platform/platform-lifecycle.ts:36` derived `NonNullable<...>` type). The 4th site is in the test file (`channel-gateway-approval.test.ts`) — it doesn't have a `interface ApprovalRecord` declaration; it has a `makeApprovalRecord` helper that takes a derived type. Re-grep with `--include='*test.ts'` to confirm the helper still exists.

- [ ] **Step 3: Re-grep `DashboardOverview` cockpit collision.**

Run:

```bash
rg -n 'DashboardOverview' apps/dashboard/src/components/cockpit 2>&1
```

Expected: 0 hits. If non-zero, the back-compat alias is now load-bearing for that consumer and PR-2 must verify the consumer still compiles after the rename (it will, because the alias preserves the name) — but flag in the PR description so the cockpit-v2 owner is aware.

- [ ] **Step 4: Re-grep the surface-URL sites in core.**

Run:

```bash
rg -n '"/contacts/' packages/core/src --type ts 2>&1
rg -n '/contacts/\$\{' packages/core/src --type ts 2>&1
```

Expected: 3-4 hits across `contacts/list.ts`, `contacts/detail.ts`, `decisions/adapters/handoff-adapter.ts`, `decisions/adapters/recommendation-adapter.ts`. Note exact line numbers — Task 10 / Task 11 reference these.

- [ ] **Step 5: No commit.** This is a verification-only task. Capture findings into a scratch note for the PR description if any assumption changed.

---

### Task 1: Hoist `ApprovalState` into `@switchboard/schemas`

The spec's §8.1 `ApprovalRecordSchema` composes `ApprovalStateSchema`, which does not yet exist. This task introduces it as a Zod schema mirroring the current `interface ApprovalState` at `packages/core/src/approval/state-machine.ts:17`, then has core re-export the inferred type so existing core call sites keep working.

**Files:**

- Create: `packages/schemas/src/approval.ts` (initial — only the state schema; the record schema lands in Task 2 on the same file).
- Create: `packages/schemas/src/__tests__/approval.test.ts` (initial).
- Modify: `packages/schemas/src/index.ts`.
- Modify: `packages/core/src/approval/state-machine.ts`.

- [ ] **Step 1: Read the current `ApprovalState` interface.**

Run:

```bash
sed -n '1,60p' packages/core/src/approval/state-machine.ts
```

Note every field — including the nested `QuorumState` / `QuorumEntry` types. The schema must be a faithful Zod equivalent.

- [ ] **Step 2: Write failing tests for `ApprovalStateSchema`.**

Create `packages/schemas/src/__tests__/approval.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApprovalStateSchema, type ApprovalState } from "../approval.js";

describe("ApprovalStateSchema", () => {
  it("parses a minimal valid state", () => {
    const valid: ApprovalState = {
      status: "pending",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(),
      version: 1,
      quorum: null,
    };
    const result = ApprovalStateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("parses a state with quorum entries", () => {
    const withQuorum: ApprovalState = {
      status: "approved",
      respondedBy: "user_a",
      respondedAt: new Date(),
      patchValue: null,
      expiresAt: new Date(Date.now() + 3600_000),
      version: 2,
      quorum: {
        required: 2,
        approvalHashes: [
          { approverId: "user_a", hash: "abc", approvedAt: new Date() },
          { approverId: "user_b", hash: "def", approvedAt: new Date() },
        ],
      },
    };
    expect(ApprovalStateSchema.safeParse(withQuorum).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const result = ApprovalStateSchema.safeParse({
      status: "not-a-status",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: new Date(),
      version: 1,
      quorum: null,
    });
    expect(result.success).toBe(false);
  });

  it("coerces ISO-string dates into Date objects", () => {
    const result = ApprovalStateSchema.safeParse({
      status: "pending",
      respondedBy: null,
      respondedAt: null,
      patchValue: null,
      expiresAt: "2026-12-31T23:59:59.000Z",
      version: 1,
      quorum: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt).toBeInstanceOf(Date);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/approval.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module ../approval.js`.

- [ ] **Step 4: Implement `ApprovalStateSchema`.**

Create `packages/schemas/src/approval.ts`:

```ts
import { z } from "zod";

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "patched",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const QuorumEntrySchema = z.object({
  approverId: z.string(),
  hash: z.string(),
  approvedAt: z.coerce.date(),
});
export type QuorumEntry = z.infer<typeof QuorumEntrySchema>;

export const QuorumStateSchema = z.object({
  required: z.number().int().min(1),
  approvalHashes: z.array(QuorumEntrySchema),
});
export type QuorumState = z.infer<typeof QuorumStateSchema>;

/**
 * Canonical persistable shape of an approval's lifecycle state. Hoisted from
 * `packages/core/src/approval/state-machine.ts` per Route Governance Contract
 * v1 §8.1 (cross-app types live in `@switchboard/schemas`). Core's
 * `ApprovalState` is now `z.infer<typeof ApprovalStateSchema>`.
 */
export const ApprovalStateSchema = z.object({
  status: ApprovalStatusSchema,
  respondedBy: z.string().nullable(),
  respondedAt: z.coerce.date().nullable(),
  patchValue: z.record(z.string(), z.unknown()).nullable(),
  expiresAt: z.coerce.date(),
  version: z.number().int().min(1),
  quorum: QuorumStateSchema.nullable(),
});
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
```

Add to `packages/schemas/src/index.ts` (just below the existing approval-lifecycle export):

```ts
export * from "./approval.js";
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/approval.test.ts 2>&1 | tail -10`
Expected: PASS — 4 cases green.

- [ ] **Step 6: Migrate `core` to consume `ApprovalState` from schemas.**

In `packages/core/src/approval/state-machine.ts`:

- Delete the local `export interface ApprovalState { ... }` block (verified at line 17 during plan-writing).
- Delete the local `QuorumState` and `QuorumEntry` interfaces if present.
- Add at the top of the file: `import type { ApprovalState, ApprovalStatus, QuorumState, QuorumEntry } from "@switchboard/schemas";` (or `export type {...}` if external callers reach into this file directly — `core/approval/index.ts` already re-exports these names).
- Add re-exports: `export type { ApprovalState, ApprovalStatus, QuorumState, QuorumEntry };` so `import { ApprovalState } from "@switchboard/core"` keeps working.

In `packages/core/src/approval/index.ts`: the existing `export type { ApprovalState, ApprovalStatus, QuorumState, QuorumEntry } from "./state-machine.js";` line at line 9 keeps working — no change needed.

- [ ] **Step 7: Build schemas + core to verify the wiring.**

Run:

```bash
pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build 2>&1 | tail -20
```

Expected: both packages build green. If `core` complains that `ApprovalState`'s `expiresAt` is now `Date | string` (Zod `coerce.date()` accepts both before transform), narrow the type at the call site OR change `z.coerce.date()` back to `z.date()` if every caller already provides a real `Date`. Check the call site behavior empirically — `prisma-approval-store.ts:save()` passes a `Date`; the state-machine helpers always pass a `Date`. `z.date()` is the safer default. Adjust the schema and re-run.

- [ ] **Step 8: Run the full schemas + core test suites.**

Run:

```bash
pnpm --filter @switchboard/schemas test -- --run 2>&1 | tail -10
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -10
```

Expected: both suites PASS.

- [ ] **Step 9: Commit.**

```bash
git add packages/schemas/src/approval.ts packages/schemas/src/__tests__/approval.test.ts packages/schemas/src/index.ts packages/core/src/approval/state-machine.ts
git commit -m "$(cat <<'EOF'
feat(schemas): hoist ApprovalState into @switchboard/schemas

ApprovalState was a TypeScript interface in core. Route Governance
Contract v1 §8.1 requires cross-app value types to live in
@switchboard/schemas. core/approval/state-machine.ts now re-exports the
inferred type so existing callers keep working.

Preparatory step for ApprovalRecordSchema (next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `ApprovalRecordSchema` to `packages/schemas/src/approval.ts`

**Files:**

- Modify: `packages/schemas/src/approval.ts`.
- Modify: `packages/schemas/src/__tests__/approval.test.ts`.

- [ ] **Step 1: Write failing tests for `ApprovalRecordSchema`.**

Append to `packages/schemas/src/__tests__/approval.test.ts`:

```ts
import { ApprovalRecordSchema, type ApprovalRecord } from "../approval.js";
import { ApprovalRequestSchema } from "../chat.js";

describe("ApprovalRecordSchema", () => {
  const validRequest = {
    id: "appr_1",
    actionId: "act_1",
    envelopeId: "env_1",
    conversationId: null,
    summary: "Test approval",
    riskCategory: "medium",
    bindingHash: "abc123hash",
    evidenceBundle: {
      decisionTrace: {},
      contextSnapshot: {},
      identitySnapshot: {},
    },
    suggestedButtons: [],
    approvers: ["user_a"],
    fallbackApprover: null,
    status: "pending" as const,
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: new Date(Date.now() + 3600_000),
    expiredBehavior: "deny" as const,
    createdAt: new Date(),
    quorum: null,
  };

  it("parses a minimal valid record", () => {
    const record: ApprovalRecord = {
      request: validRequest,
      state: {
        status: "pending",
        respondedBy: null,
        respondedAt: null,
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: null,
    };
    const result = ApprovalRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("accepts a non-null organizationId", () => {
    const record: ApprovalRecord = {
      request: validRequest,
      state: {
        status: "approved",
        respondedBy: "user_a",
        respondedAt: new Date(),
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: "org_a",
    };
    expect(ApprovalRecordSchema.safeParse(record).success).toBe(true);
  });

  it("rejects when state.status is missing", () => {
    const result = ApprovalRecordSchema.safeParse({
      request: validRequest,
      state: {
        respondedBy: null,
        respondedAt: null,
        patchValue: null,
        expiresAt: new Date(),
        version: 1,
        quorum: null,
      },
      envelopeId: "env_1",
      organizationId: null,
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/approval.test.ts 2>&1 | tail -10`
Expected: FAIL — `ApprovalRecordSchema` not exported.

- [ ] **Step 3: Add `ApprovalRecordSchema` to `packages/schemas/src/approval.ts`.**

Append to `packages/schemas/src/approval.ts`:

```ts
import { ApprovalRequestSchema } from "./chat.js";

/**
 * The persistable record shape for an approval — the pair of (request, state)
 * plus the envelope it belongs to. Replaces the 3+ local declarations of
 * `interface ApprovalRecord` that previously lived in `apps/api`,
 * `packages/core`, and `packages/db`. Route Governance Contract v1 §8.1.
 */
export const ApprovalRecordSchema = z.object({
  request: ApprovalRequestSchema,
  state: ApprovalStateSchema,
  envelopeId: z.string(),
  organizationId: z.string().nullable(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/approval.test.ts 2>&1 | tail -10`
Expected: PASS — 3 new cases green; the 4 from Task 1 still green.

- [ ] **Step 5: Commit.**

```bash
git add packages/schemas/src/approval.ts packages/schemas/src/__tests__/approval.test.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add ApprovalRecordSchema

Closes the schema half of Cat 3.4. Consumer migration (4 local sites)
follows in the next commit.

Route Governance Contract v1 §8.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrate `ApprovalRecord` consumers

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`.
- Modify: `packages/core/src/platform/platform-lifecycle.ts`.
- Modify: `packages/db/src/storage/prisma-approval-store.ts`.
- Modify: `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts`.

This task has no new test code — it's a pure type-replacement sweep validated by `pnpm typecheck`.

- [ ] **Step 1: Remove the local interface in `dashboard-overview.ts`.**

Read `apps/api/src/routes/dashboard-overview.ts` (verify line numbers first — PR-1's review may have moved them). Locate the `interface ApprovalRecord { ... }` block (lines 64-73 at plan-writing time).

Replace by:

1. Add at the top: `import type { ApprovalRecord } from "@switchboard/schemas";` (or merge into existing schemas import).
2. Delete the `interface ApprovalRecord { ... }` block.
3. Verify the rest of the file references `ApprovalRecord` correctly — the schema type has a richer `request` (full `ApprovalRequestSchema`, including `evidenceBundle`, `suggestedButtons`, etc.); the previous local interface narrowed it to `{ id, summary, riskCategory, bindingHash, createdAt }`. The route's existing `.queryApprovals` consumers may need a typed adapter (e.g., `record.request.summary` is unchanged, but `record.request.createdAt` is now `Date` not `Date | string`).

- [ ] **Step 2: Run `pnpm typecheck` for api.**

Run: `pnpm --filter @switchboard/api typecheck 2>&1 | tail -30`
Expected: green, or compile errors at the 4-5 sites that consume `ApprovalRecord` fields. Fix each by:

- Using `record.request.createdAt.toISOString()` if a string is needed.
- Acknowledging the wider type — the existing handler may now have access to fields it didn't before (cosmetic; no behavior change).

If the test file `apps/api/src/__tests__/dashboard-overview-*.test.ts` (or similar) mocks `queryApprovals` with the narrower shape, expand the mocks to satisfy the full schema. Use a small `makeApprovalRecord` test fixture if multiple mocks need it.

- [ ] **Step 3: Migrate `platform-lifecycle.ts`.**

Open `packages/core/src/platform/platform-lifecycle.ts`. Replace at line 36:

```ts
// Before:
type ApprovalRecord = NonNullable<Awaited<ReturnType<CoreApprovalStore["getById"]>>>;
// After:
import type { ApprovalRecord } from "@switchboard/schemas";
```

The 3 method signatures that reference `ApprovalRecord` (lines 470, 508, 521) keep their existing argument names; the imported type is structurally identical.

If `CoreApprovalStore["getById"]`'s return type is narrower than `ApprovalRecord | null`, tighten the store interface to return `Promise<ApprovalRecord | null>` (most likely already true — the store impl in `packages/db` already shapes its return).

Run: `pnpm --filter @switchboard/core typecheck 2>&1 | tail -20`
Expected: green.

- [ ] **Step 4: Migrate `prisma-approval-store.ts`.**

Open `packages/db/src/storage/prisma-approval-store.ts`. Replace lines 6-12:

```ts
// Before:
type ApprovalRecord = {
  request: ApprovalRequest;
  state: ApprovalState;
  envelopeId: string;
  organizationId?: string | null;
};
// After:
import type { ApprovalRecord } from "@switchboard/schemas";
```

The `toApprovalRecord(row): ApprovalRecord` function (line 78) keeps its return-type annotation; if the schema's `organizationId: z.string().nullable()` is stricter than the previous `organizationId?: string | null`, ensure `row.organizationId ?? null` is returned (not `undefined`). The store's `save()` method already accepts an `ApprovalRecord` shape — verify the call sites pass a non-undefined `organizationId` after this change (the schema requires it to be present-but-nullable, not optional).

Run: `pnpm --filter @switchboard/db typecheck 2>&1 | tail -20`
Expected: green.

- [ ] **Step 5: Migrate the channel-gateway test helper.**

Open `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts`. Locate `function makeApprovalRecord(overrides)` (line 71 at plan-writing time). Replace any local-typed reference with `import type { ApprovalRecord } from "@switchboard/schemas"` and update the function's return type to `ApprovalRecord`.

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Run the full test sweep for the touched packages.**

Run:

```bash
pnpm --filter @switchboard/api test -- --run 2>&1 | tail -20
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -20
pnpm --filter @switchboard/db test -- --run 2>&1 | tail -20
```

Expected: all green. If a test file mocked the narrower `ApprovalRecord` shape, expand the mock to satisfy the full schema (or use `as unknown as ApprovalRecord` only in test setup with a comment justifying the cast).

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/routes/dashboard-overview.ts packages/core/src/platform/platform-lifecycle.ts packages/db/src/storage/prisma-approval-store.ts packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts
git commit -m "$(cat <<'EOF'
refactor: migrate ApprovalRecord consumers to @switchboard/schemas

Closes Cat 3.4. Four local declarations replaced by the canonical schema
type:
- apps/api/src/routes/dashboard-overview.ts (interface)
- packages/core/src/platform/platform-lifecycle.ts (derived NonNullable)
- packages/db/src/storage/prisma-approval-store.ts (type alias)
- packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts (test helper)

Route Governance Contract v1 §8.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Hoist `HandoffPackage` + leaf types into `packages/schemas/src/handoff.ts`

The current canonical shape lives in `packages/core/src/handoff/types.ts` (verified during plan-writing). Spec §8.3 proposed a thinner shape; the plan keeps the existing-rich shape because too many call sites already depend on it. Rename `HandoffPackage` → `Handoff` (the spec-preferred name) and re-export `HandoffPackage` from core as a back-compat alias.

**Naming collision warning:** `packages/core/src/handoff/types.ts` exports `interface ConversationSummary { turnCount, keyTopics, ... }`. This name will collide with the `ConversationSummary` projection that Task 7 adds to schemas (the api `conversations.ts` route's summary shape — different fields). Rename the handoff-flavored one to `HandoffConversationSummary` at hoist time so both can coexist in schemas.

**Files:**

- Create: `packages/schemas/src/handoff.ts`.
- Create: `packages/schemas/src/__tests__/handoff.test.ts`.
- Modify: `packages/schemas/src/index.ts`.

- [ ] **Step 1: Read the current `core/handoff/types.ts` in full.**

Run: `cat packages/core/src/handoff/types.ts`

Note every exported name, every field, every nullable / optional distinction. The schema must round-trip every shape that currently flows through `escalations.ts`, `handoff-adapter.ts`, the handoff store impls, and the channel gateway.

- [ ] **Step 2: Write failing tests for `HandoffSchema`.**

Create `packages/schemas/src/__tests__/handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  HandoffSchema,
  HandoffReasonSchema,
  HandoffStatusSchema,
  type Handoff,
} from "../handoff.js";

describe("HandoffReasonSchema", () => {
  it.each([
    "human_requested",
    "max_turns_exceeded",
    "complex_objection",
    "negative_sentiment",
    "compliance_concern",
    "booking_failure",
    "escalation_timeout",
    "missing_knowledge",
    "outside_whatsapp_window",
  ])("accepts %s", (reason) => {
    expect(HandoffReasonSchema.safeParse(reason).success).toBe(true);
  });

  it("rejects unknown reasons", () => {
    expect(HandoffReasonSchema.safeParse("definitely_not_a_reason").success).toBe(false);
  });
});

describe("HandoffStatusSchema", () => {
  it.each(["pending", "assigned", "active", "released"])("accepts %s", (status) => {
    expect(HandoffStatusSchema.safeParse(status).success).toBe(true);
  });
});

describe("HandoffSchema", () => {
  const baseHandoff: Handoff = {
    id: "h_1",
    sessionId: "session_1",
    organizationId: "org_a",
    reason: "human_requested",
    status: "pending",
    leadSnapshot: { channel: "whatsapp" },
    qualificationSnapshot: {
      signalsCaptured: {},
      qualificationStage: "QUALIFYING",
    },
    conversationSummary: {
      turnCount: 5,
      keyTopics: ["pricing"],
      objectionHistory: [],
      sentiment: "neutral",
    },
    slaDeadlineAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
  };

  it("parses a minimal valid handoff", () => {
    expect(HandoffSchema.safeParse(baseHandoff).success).toBe(true);
  });

  it("parses a handoff with optional acknowledgedAt + full lead snapshot", () => {
    const full: Handoff = {
      ...baseHandoff,
      acknowledgedAt: new Date(),
      leadSnapshot: {
        leadId: "lead_1",
        name: "Alice",
        phone: "+65...",
        email: "a@example.com",
        serviceInterest: "consultation",
        channel: "whatsapp",
        source: "instagram_ad",
      },
      qualificationSnapshot: {
        signalsCaptured: { interest: "high" },
        qualificationStage: "QUALIFIED",
        leadScore: 0.8,
      },
      conversationSummary: {
        turnCount: 8,
        keyTopics: ["pricing", "availability"],
        objectionHistory: ["too_expensive"],
        sentiment: "positive",
        suggestedOpening: "Hi Alice, ...",
      },
    };
    expect(HandoffSchema.safeParse(full).success).toBe(true);
  });

  it("rejects missing required leadSnapshot.channel", () => {
    const broken = { ...baseHandoff, leadSnapshot: {} };
    expect(HandoffSchema.safeParse(broken).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/handoff.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/schemas/src/handoff.ts`.**

Create the file:

```ts
import { z } from "zod";

export const HandoffReasonSchema = z.enum([
  "human_requested",
  "max_turns_exceeded",
  "complex_objection",
  "negative_sentiment",
  "compliance_concern",
  "booking_failure",
  "escalation_timeout",
  "missing_knowledge",
  "outside_whatsapp_window",
]);
export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

export const HandoffStatusSchema = z.enum(["pending", "assigned", "active", "released"]);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export const LeadSnapshotSchema = z.object({
  leadId: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  serviceInterest: z.string().optional(),
  channel: z.string(),
  source: z.string().optional(),
});
export type LeadSnapshot = z.infer<typeof LeadSnapshotSchema>;

export const QualificationSnapshotSchema = z.object({
  signalsCaptured: z.record(z.string(), z.unknown()),
  qualificationStage: z.string(),
  leadScore: z.number().optional(),
});
export type QualificationSnapshot = z.infer<typeof QualificationSnapshotSchema>;

/**
 * The summary attached to a Handoff — keyed by turn count + key topics, not
 * to be confused with `ConversationSummary` in `./conversations.ts`, which is
 * a per-conversation projection used by the api's /conversations route. The
 * naming collision was resolved at hoist time per the PR-2 plan.
 */
export const HandoffConversationSummarySchema = z.object({
  turnCount: z.number().int(),
  keyTopics: z.array(z.string()),
  objectionHistory: z.array(z.string()),
  sentiment: z.string(),
  suggestedOpening: z.string().optional(),
});
export type HandoffConversationSummary = z.infer<typeof HandoffConversationSummarySchema>;

/**
 * Canonical Handoff shape — the package the chat layer constructs when an
 * agent escalates to a human, persisted to the `Handoff` Prisma row, surfaced
 * by `/api/escalations`, and consumed by the decisions adapter. Previously
 * `HandoffPackage` in `packages/core/src/handoff/types.ts`; renamed per Route
 * Governance Contract v1 §8.3. Core re-exports `HandoffPackage` as a
 * back-compat alias.
 */
export const HandoffSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  organizationId: z.string(),
  reason: HandoffReasonSchema,
  status: HandoffStatusSchema,
  leadSnapshot: LeadSnapshotSchema,
  qualificationSnapshot: QualificationSnapshotSchema,
  conversationSummary: HandoffConversationSummarySchema,
  slaDeadlineAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  acknowledgedAt: z.coerce.date().optional(),
});
export type Handoff = z.infer<typeof HandoffSchema>;
```

Add to `packages/schemas/src/index.ts`:

```ts
export * from "./handoff.js";
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/handoff.test.ts 2>&1 | tail -10`
Expected: PASS — all cases green.

- [ ] **Step 6: Commit.**

```bash
git add packages/schemas/src/handoff.ts packages/schemas/src/__tests__/handoff.test.ts packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): hoist HandoffPackage → Handoff into @switchboard/schemas

The canonical shape from core/handoff/types.ts moves into schemas as
HandoffSchema + leaf schemas (LeadSnapshot, QualificationSnapshot,
HandoffConversationSummary). Renamed from HandoffPackage to Handoff per
spec §8.3. Core's leaf ConversationSummary renamed to
HandoffConversationSummary to avoid collision with the upcoming
conversations.ts projection schema.

Consumer migration (core re-exports + escalations.ts + handoff-adapter)
follows in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate `Handoff` consumers — core re-exports + downstream callers

**Files:**

- Modify: `packages/core/src/handoff/types.ts`.
- Modify: `packages/core/src/decisions/adapters/handoff-adapter.ts`.
- Modify: `apps/api/src/routes/escalations.ts`.

- [ ] **Step 1: Convert `packages/core/src/handoff/types.ts` to a re-export shim.**

Replace the file contents with:

```ts
// ---------------------------------------------------------------------------
// Human Handoff — Types (re-exports from @switchboard/schemas)
// ---------------------------------------------------------------------------
// HandoffPackage / LeadSnapshot / QualificationSnapshot / ConversationSummary
// were hoisted to @switchboard/schemas per Route Governance Contract v1 §8.3.
// This file keeps the existing import paths working via re-export and adds
// the `HandoffPackage` back-compat alias for the renamed `Handoff` type.
// The `HandoffStore` interface stays here — it's a store contract, not a
// cross-app value type, and lives appropriately in core.
// ---------------------------------------------------------------------------

export type {
  Handoff,
  HandoffReason,
  HandoffStatus,
  LeadSnapshot,
  QualificationSnapshot,
  HandoffConversationSummary,
} from "@switchboard/schemas";

// Back-compat alias — `HandoffPackage` was the original core name. Existing
// callers (escalations.ts, handoff-store impls) keep importing this until a
// follow-up sweep renames them. PR-4 removes this alias once grep returns 0.
import type { Handoff } from "@switchboard/schemas";
export type HandoffPackage = Handoff;

// Back-compat alias for the renamed inner summary type.
import type { HandoffConversationSummary } from "@switchboard/schemas";
export type ConversationSummary = HandoffConversationSummary;

export interface HandoffStore {
  save(pkg: HandoffPackage): Promise<void>;
  getById(id: string): Promise<HandoffPackage | null>;
  getBySessionId(sessionId: string): Promise<HandoffPackage | null>;
  updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void>;
  listPending(organizationId: string): Promise<HandoffPackage[]>;
}
```

Note: the `import type` lines for the local aliases must come AFTER the `export type` re-export block; TypeScript allows the same name to be both imported (locally) and re-exported (publicly) only with this ordering.

- [ ] **Step 2: Verify core builds + tests pass.**

Run:

```bash
pnpm --filter @switchboard/core build 2>&1 | tail -10
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -20
```

Expected: green. Any failure here points to a call site relying on a specific field name that did not survive the rename — investigate and update the call site, not the schema.

- [ ] **Step 3: Update `handoff-adapter.ts` to import the new type names.**

In `packages/core/src/decisions/adapters/handoff-adapter.ts`, change the import at line 2 from:

```ts
import type { HandoffPackage } from "../../handoff/types.js";
```

to:

```ts
import type { Handoff } from "@switchboard/schemas";
```

Update the function signature: `adaptHandoff(row: HandoffPackage, ...)` → `adaptHandoff(row: Handoff, ...)`. The body is unchanged because field names are identical.

(`routeTemplates` injection at line 22 lands in Task 10, not here — keep the inline `\`/contacts/${contact?.id}/conversations/${thread.id}\`` template for now; we want each commit small.)

- [ ] **Step 4: Verify `apps/api/src/routes/escalations.ts` still compiles.**

The route uses `app.prisma.handoff.update({...})` (Prisma row shape) and shapes responses from those rows. After the rename in core, anywhere `escalations.ts` imports `HandoffPackage` should still work via the back-compat alias. Verify:

Run: `pnpm --filter @switchboard/api typecheck 2>&1 | tail -20`
Expected: green. If a type error fires, change `HandoffPackage` → `Handoff` in the route or accept the alias.

- [ ] **Step 5: Run the api + core test suites.**

Run:

```bash
pnpm --filter @switchboard/api test -- --run 2>&1 | tail -20
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -20
```

Expected: green.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/handoff/types.ts packages/core/src/decisions/adapters/handoff-adapter.ts apps/api/src/routes/escalations.ts
git commit -m "$(cat <<'EOF'
refactor: migrate Handoff consumers to @switchboard/schemas

core/handoff/types.ts becomes a re-export shim with HandoffPackage and
ConversationSummary kept as back-compat aliases. HandoffStore stays in
core (store interface, not cross-app value type). decisions adapter
imports Handoff directly from schemas.

Closes Cat 3.6 (schema half) and the consumer-migration half. PR-4
removes the back-compat aliases.

Route Governance Contract v1 §8.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Extend `ConversationStateSchema` to cover the chat-side superset

The chat-side `ConversationStateData` interface is a superset of the existing `ConversationStateSchema` (missing fields: `messages`, `leadProfile`, `detectedLanguage`, `machineState`). PR-2 expands the schema and migrates the chat consumer to be a pure importer.

**Files:**

- Modify: `packages/schemas/src/chat.ts`.
- Modify: `packages/schemas/src/__tests__/schemas.test.ts` (or wherever ConversationStateSchema is currently tested).
- Modify: `apps/chat/src/conversation/state.ts`.
- Modify: `apps/chat/src/conversation/store.ts`, `prisma-store.ts`, `threads.ts` (import-path updates only).

- [ ] **Step 1: Add `ConversationMessageSchema` to `packages/schemas/src/chat.ts`.**

Currently `ConversationMessage` is defined as an `interface` at `apps/chat/src/conversation/state.ts:5`. Mirror it as a schema:

```ts
// Add above ConversationStateSchema in chat.ts:
export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  timestamp: z.coerce.date(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
```

- [ ] **Step 2: Extend `ConversationStateSchema` with the 4 missing fields.**

Find the existing `ConversationStateSchema` block (currently ends at line 64 with `crmContactId`). Add 4 more fields:

```ts
// Inside ConversationStateSchema, after crmContactId:
  messages: z.array(ConversationMessageSchema),
  /** Typed lead profile that accumulates intelligence over conversation turns. */
  leadProfile: LeadProfileSchema.nullable(),
  /** Detected language of the user (resolved from recent messages). */
  detectedLanguage: z.string().nullable(),
  /** Current lead state machine state (e.g. QUALIFYING, BOOKING_PUSH). */
  machineState: z.string().nullable(),
```

`LeadProfileSchema` must already exist in schemas — confirm with `rg -n 'LeadProfileSchema' packages/schemas/src`. If it exists, import it (`import { LeadProfileSchema } from "./lead-profile.js"` or via the barrel). If it does NOT exist, the chat-side `LeadProfile` is a TypeScript interface that needs hoisting too — bail out of this task with a note, and run a separate sub-task to hoist `LeadProfile` first.

**Verification:**

```bash
rg -n 'LeadProfileSchema\|export.*LeadProfile\b' packages/schemas/src --type ts 2>&1 | head -10
```

If 0 hits, add a Task 6.5 to hoist `LeadProfile` from wherever it currently lives (chat or core) into schemas. If hits exist, proceed.

- [ ] **Step 3: Write a regression test for the expanded schema.**

Append to `packages/schemas/src/__tests__/schemas.test.ts` (or create a new file `packages/schemas/src/__tests__/conversation-state.test.ts`):

```ts
import { ConversationStateSchema } from "../chat.js";

describe("ConversationStateSchema — expanded shape (PR-2)", () => {
  it("parses a fully-populated conversation state", () => {
    const result = ConversationStateSchema.safeParse({
      id: "conv_1",
      threadId: "thread_1",
      channel: "whatsapp",
      principalId: "user_a",
      organizationId: "org_a",
      status: "active",
      currentIntent: null,
      pendingProposalIds: [],
      pendingApprovalIds: [],
      clarificationQuestion: null,
      firstReplyAt: null,
      lastInboundAt: null,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      crmContactId: null,
      messages: [{ role: "user", text: "hi", timestamp: new Date() }],
      leadProfile: null,
      detectedLanguage: "en",
      machineState: "QUALIFYING",
    });
    expect(result.success).toBe(true);
  });

  it("requires the 4 expanded fields", () => {
    // missing `messages`, `leadProfile`, `detectedLanguage`, `machineState`
    const result = ConversationStateSchema.safeParse({
      id: "conv_1",
      threadId: "thread_1",
      channel: "whatsapp",
      principalId: "user_a",
      organizationId: null,
      status: "active",
      currentIntent: null,
      pendingProposalIds: [],
      pendingApprovalIds: [],
      clarificationQuestion: null,
      lastActivityAt: new Date(),
      expiresAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
```

Run: `pnpm --filter @switchboard/schemas test -- --run 2>&1 | tail -10`
Expected: PASS — new cases green; existing ones (including the 13 ApprovalRequest tests) still green.

- [ ] **Step 4: Migrate `apps/chat/src/conversation/state.ts`.**

Replace local interface declarations with re-exports:

```ts
// Before:
export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}
export interface ConversationStateData {
  /* ...15+ fields... */
}

// After:
export type {
  ConversationMessage,
  ConversationState as ConversationStateData,
} from "@switchboard/schemas";
```

The `ConversationStateData` ↔ `ConversationState` rename is deliberate — chat-side callers consume the name `ConversationStateData` everywhere (32+ sites). Re-exporting under the alias keeps every consumer working without a 32-file rename PR.

The helper functions `createConversation`, `transitionConversation`, etc. stay in this file. They keep producing `ConversationStateData`-typed values, which are now structurally identical to `ConversationState` from schemas.

- [ ] **Step 5: Update import paths in chat's neighboring files.**

`apps/chat/src/conversation/store.ts`, `prisma-store.ts`, `threads.ts` currently `import type { ConversationStateData } from "./state.js"`. They keep working because `state.ts` re-exports the name. **No code change needed in these 3 files** — the migration is invisible to them.

Verify:

```bash
pnpm --filter @switchboard/chat typecheck 2>&1 | tail -20
pnpm --filter @switchboard/chat test -- --run 2>&1 | tail -20
```

Expected: green. If a chat test mocked `ConversationStateData` with the old narrower shape, expand the mock to include the 4 new fields (use `as ConversationStateData` with a comment if the mock genuinely doesn't need them).

- [ ] **Step 6: Commit.**

```bash
git add packages/schemas/src/chat.ts packages/schemas/src/__tests__/*.test.ts apps/chat/src/conversation/state.ts
git commit -m "$(cat <<'EOF'
feat(schemas): expand ConversationStateSchema to chat-side superset

Adds ConversationMessageSchema and 4 fields (messages, leadProfile,
detectedLanguage, machineState) so that apps/chat's ConversationStateData
becomes a pure re-export of ConversationState.

Closes the schema half of Cat 3.5 — chat-side consumer migration via
re-export shim keeps all 30+ existing call sites compiling unchanged.

Route Governance Contract v1 §8.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add `ConversationSummarySchema` + `ConversationDetailSchema` to schemas, migrate api `conversations.ts`

The api's `conversations.ts` route exposes projections (summary list, single detail) over `ConversationState`. These are distinct cross-app types (the dashboard's hooks consume them by name) and currently live as local interfaces in the route file. Hoist them into a new `packages/schemas/src/conversations.ts` and migrate.

**Files:**

- Create: `packages/schemas/src/conversations.ts`.
- Create: `packages/schemas/src/__tests__/conversations.test.ts`.
- Modify: `packages/schemas/src/index.ts`.
- Modify: `apps/api/src/routes/conversations.ts`.

- [ ] **Step 1: Write failing tests for the new projection schemas.**

Create `packages/schemas/src/__tests__/conversations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ConversationSummarySchema,
  ConversationDetailSchema,
  ConversationListResultSchema,
  type ConversationSummary,
} from "../conversations.js";

describe("ConversationSummarySchema", () => {
  const valid: ConversationSummary = {
    id: "conv_1",
    threadId: "thread_1",
    channel: "whatsapp",
    principalId: "user_a",
    organizationId: "org_a",
    status: "active",
    currentIntent: null,
    messageCount: 3,
    lastMessage: "Hello",
    firstReplyAt: null,
    lastActivityAt: "2026-05-22T10:00:00.000Z",
  };

  it("parses a valid summary", () => {
    expect(ConversationSummarySchema.safeParse(valid).success).toBe(true);
  });

  it("allows null lastMessage when conversation has zero messages", () => {
    expect(
      ConversationSummarySchema.safeParse({ ...valid, messageCount: 0, lastMessage: null }).success,
    ).toBe(true);
  });
});

describe("ConversationDetailSchema", () => {
  it("parses a valid detail with messages", () => {
    const result = ConversationDetailSchema.safeParse({
      id: "conv_1",
      threadId: "thread_1",
      channel: "whatsapp",
      principalId: "user_a",
      organizationId: null,
      status: "active",
      currentIntent: null,
      firstReplyAt: null,
      lastActivityAt: "2026-05-22T10:00:00.000Z",
      messages: [{ role: "user", text: "hi", timestamp: "2026-05-22T09:59:59.000Z" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationListResultSchema", () => {
  it("parses an empty list", () => {
    expect(
      ConversationListResultSchema.safeParse({
        conversations: [],
        total: 0,
        limit: 20,
        offset: 0,
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/conversations.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/schemas/src/conversations.ts`.**

Create the file:

```ts
import { z } from "zod";

/**
 * Wire-format message entry used by the api `conversations.ts` route's
 * projection schemas. Distinct from `ConversationMessage` in `./chat.ts`,
 * which uses `Date` (the runtime shape); here we use ISO strings because
 * the projections cross the HTTP boundary and are JSON-serialized.
 */
export const ConversationMessageEntrySchema = z.object({
  role: z.string(),
  text: z.string(),
  timestamp: z.string(),
});
export type ConversationMessageEntry = z.infer<typeof ConversationMessageEntrySchema>;

/**
 * Summary projection of ConversationState — what `/api/conversations` returns
 * in its list response. `messages` is collapsed to count + preview, dates are
 * ISO strings.
 */
export const ConversationSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  channel: z.string(),
  principalId: z.string(),
  organizationId: z.string().nullable(),
  status: z.string(),
  currentIntent: z.string().nullable(),
  messageCount: z.number().int().min(0),
  lastMessage: z.string().nullable(),
  firstReplyAt: z.string().nullable(),
  lastActivityAt: z.string(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

/**
 * Detail projection of ConversationState — what `/api/conversations/:id`
 * returns. Includes the message array in wire format.
 */
export const ConversationDetailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  channel: z.string(),
  principalId: z.string(),
  organizationId: z.string().nullable(),
  status: z.string(),
  currentIntent: z.string().nullable(),
  firstReplyAt: z.string().nullable(),
  lastActivityAt: z.string(),
  messages: z.array(ConversationMessageEntrySchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export const ConversationListResultSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
});
export type ConversationListResult = z.infer<typeof ConversationListResultSchema>;
```

Add to `packages/schemas/src/index.ts`:

```ts
export * from "./conversations.js";
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/schemas test -- --run packages/schemas/src/__tests__/conversations.test.ts 2>&1 | tail -10`
Expected: PASS — all cases green.

- [ ] **Step 5: Migrate `apps/api/src/routes/conversations.ts`.**

Open the route file. Remove the local interface declarations (lines 20-66 at plan-writing time):

- `interface MessageEntry` → replace with `ConversationMessageEntry` from schemas.
- `interface ConversationRow` → stays internal (it's a Prisma row shape, not a cross-app type). Keep it.
- `export interface ConversationSummary` → delete; import from schemas.
- `export interface ConversationDetail` → delete; import from schemas.
- `export interface ConversationListResult` → delete; import from schemas.

Add at the top:

```ts
import type {
  ConversationMessageEntry,
  ConversationSummary,
  ConversationDetail,
  ConversationListResult,
} from "@switchboard/schemas";
```

Verify the route's handlers and helper functions still typecheck. Any place that previously typed a variable as `ConversationSummary` (local) now reads the import; structural equivalence keeps it working.

Run:

```bash
pnpm --filter @switchboard/api typecheck 2>&1 | tail -20
pnpm --filter @switchboard/api test -- --run 2>&1 | tail -20
```

Expected: green. If any dashboard hook or chat consumer imported the projection types from `apps/api` directly (unlikely — apps shouldn't cross-import), update them to import from `@switchboard/schemas` instead.

- [ ] **Step 6: Commit.**

```bash
git add packages/schemas/src/conversations.ts packages/schemas/src/__tests__/conversations.test.ts packages/schemas/src/index.ts apps/api/src/routes/conversations.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add ConversationSummary + ConversationDetail projections

Hoists the api conversations.ts route's response projection schemas
into @switchboard/schemas. Route is the only producer; dashboard hooks
that consume these now import the canonical types.

Closes the remainder of Cat 3.5.

Route Governance Contract v1 §8.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Rename `DashboardOverview` → `OperatorOverview` with back-compat alias

**Files:**

- Modify: `packages/schemas/src/dashboard.ts`.
- Modify: `packages/schemas/src/__tests__/index-exports.test.ts` (if it asserts the export name).

- [ ] **Step 1: Read the current `dashboard.ts`.**

Run: `cat packages/schemas/src/dashboard.ts | head -90`

Confirm the schema's current shape and that line 82 is where `export type DashboardOverview` lives.

- [ ] **Step 2: Write a failing test for both names exporting the same shape.**

Append to `packages/schemas/src/__tests__/index-exports.test.ts` (or create a new file `packages/schemas/src/__tests__/dashboard.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import * as schemas from "../index.js";

describe("OperatorOverview rename (PR-2)", () => {
  it("exports OperatorOverviewSchema", () => {
    expect(schemas.OperatorOverviewSchema).toBeDefined();
  });

  it("exports the back-compat alias DashboardOverviewSchema", () => {
    expect(schemas.DashboardOverviewSchema).toBeDefined();
  });

  it("alias and canonical schema are the same object", () => {
    expect(schemas.DashboardOverviewSchema).toBe(schemas.OperatorOverviewSchema);
  });
});
```

Run: `pnpm --filter @switchboard/schemas test -- --run 2>&1 | tail -10`
Expected: FAIL — `OperatorOverviewSchema` not defined.

- [ ] **Step 3: Update `packages/schemas/src/dashboard.ts`.**

Replace:

```ts
// Before:
export const DashboardOverviewSchema = z.object({
  /* ...long shape... */
});
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;

// After:
export const OperatorOverviewSchema = z.object({
  /* ...identical long shape... */
});
export type OperatorOverview = z.infer<typeof OperatorOverviewSchema>;

/**
 * Back-compat alias for the old name. Route Governance Contract v1 §8.4 —
 * the rename is gradual; PR-4 removes this alias once `rg DashboardOverview`
 * returns 0 across the monorepo. New code SHOULD import `OperatorOverview`.
 */
export const DashboardOverviewSchema = OperatorOverviewSchema;
export type DashboardOverview = OperatorOverview;
```

Update `packages/schemas/src/index.ts` (line 129 currently re-exports `DashboardOverviewSchema, type DashboardOverview` explicitly). Switch to a star export so both names are surfaced:

```ts
// Before:
export { DashboardOverviewSchema, type DashboardOverview } from "./dashboard.js";
// After:
export * from "./dashboard.js";
```

(`export *` already covers both names because they're both `export`s of the dashboard.ts module.)

- [ ] **Step 4: Run tests + typecheck.**

```bash
pnpm --filter @switchboard/schemas test -- --run 2>&1 | tail -10
pnpm --filter @switchboard/schemas typecheck 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/schemas/src/dashboard.ts packages/schemas/src/index.ts packages/schemas/src/__tests__/index-exports.test.ts
git commit -m "$(cat <<'EOF'
refactor(schemas): rename DashboardOverview → OperatorOverview

Adds OperatorOverviewSchema as the canonical name; DashboardOverviewSchema
becomes a back-compat alias that PR-4 will remove once consumer migration
is complete.

Closes the schema half of Cat 3.10. Consumer migration (api + dashboard,
3 sites) follows in the next commit.

Route Governance Contract v1 §8.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Migrate `OperatorOverview` consumers

**Files:**

- Modify: `apps/api/src/routes/dashboard-overview.ts`.
- Modify: `apps/dashboard/src/lib/api-client/dashboard.ts`.
- Modify: `apps/dashboard/src/hooks/use-dashboard-overview.ts`.
- Modify: `apps/dashboard/src/app/api/dashboard/overview/route.ts`.

The route's URL (`/api/dashboard/overview`) is unchanged. Only the type name (and the producer function name) changes. The back-compat alias means any site missed here still compiles.

- [ ] **Step 1: Update `apps/api/src/routes/dashboard-overview.ts`.**

Replace the import at line 6:

```ts
// Before:
import type { DashboardOverview } from "@switchboard/schemas";
// After:
import type { OperatorOverview } from "@switchboard/schemas";
```

Rename the function at line 95: `buildDashboardOverview` → `buildOperatorOverview`. Update its return type annotation (`Promise<DashboardOverview>` → `Promise<OperatorOverview>`). Update the one call site at line 275 (the route handler).

The exported function rename is internal — no other app imports `buildDashboardOverview` from this route file (verify with `rg -n 'buildDashboardOverview' apps packages` — expected 0 hits outside `dashboard-overview.ts` itself).

- [ ] **Step 2: Update `apps/dashboard/src/lib/api-client/dashboard.ts`.**

Replace at lines 4, 48, 49:

```ts
// Before:
import { DashboardOverview, ... } from "@switchboard/schemas";
// ...
async getDashboardOverview(orgId: string): Promise<DashboardOverview> {
  return this.request<DashboardOverview>(`/api/${orgId}/dashboard/overview`);
}
// After:
import { OperatorOverview, ... } from "@switchboard/schemas";
// ...
async getOperatorOverview(orgId: string): Promise<OperatorOverview> {
  return this.request<OperatorOverview>(`/api/${orgId}/dashboard/overview`);
}
```

The route path stays `/api/${orgId}/dashboard/overview` — only the type/method names change.

If `getDashboardOverview` has callers outside this file, find them:

```bash
rg -n 'getDashboardOverview' apps/dashboard/src 2>&1
```

Update each caller to `getOperatorOverview`. Expected: 1 hit at `apps/dashboard/src/app/api/dashboard/overview/route.ts:10`.

- [ ] **Step 3: Update the Next route handler.**

`apps/dashboard/src/app/api/dashboard/overview/route.ts`:

```ts
// Before:
const data = await client.getDashboardOverview(session.organizationId);
// After:
const data = await client.getOperatorOverview(session.organizationId);
```

- [ ] **Step 4: Update `apps/dashboard/src/hooks/use-dashboard-overview.ts`.**

The file name stays `use-dashboard-overview.ts` to avoid a 10+ caller rename in this PR (the hook's _content_ migrates; the file rename can ride in PR-4 with the alias removal). Inside the file:

```ts
// Before:
import type { DashboardOverview } from "@switchboard/schemas";
async function fetchOverview(): Promise<DashboardOverview> { ... }
export function useDashboardOverview() { ... }
// After:
import type { OperatorOverview } from "@switchboard/schemas";
async function fetchOverview(): Promise<OperatorOverview> { ... }
export function useDashboardOverview() { ... }   // hook name unchanged
```

The hook NAME (`useDashboardOverview`) stays — that's the public API consumed by components. Only the inner type annotation changes.

- [ ] **Step 5: Run typecheck for both api and dashboard.**

```bash
pnpm --filter @switchboard/api typecheck 2>&1 | tail -20
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -20
```

Expected: green. If a dashboard component imports `DashboardOverview` directly (not via the hook), it still compiles via the back-compat alias — but should be migrated. Grep:

```bash
rg -n 'DashboardOverview' apps/dashboard/src 2>&1
```

If any non-test consumer still uses the old name, update it to `OperatorOverview` in this commit.

- [ ] **Step 6: Run the dashboard tests + verify Next build.**

```bash
pnpm --filter @switchboard/dashboard test -- --run 2>&1 | tail -10
pnpm --filter @switchboard/dashboard build 2>&1 | tail -30
```

Expected: tests pass; `next build` succeeds. **Mandatory** per `feedback_dashboard_build_not_in_ci.md` — CI does NOT run `next build`, so any extension-related regression slips past unless verified locally.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/routes/dashboard-overview.ts apps/dashboard/src/lib/api-client/dashboard.ts apps/dashboard/src/hooks/use-dashboard-overview.ts apps/dashboard/src/app/api/dashboard/overview/route.ts
git commit -m "$(cat <<'EOF'
refactor: migrate DashboardOverview consumers to OperatorOverview

Three dashboard sites + one api route now consume OperatorOverview
directly. Back-compat alias still in place for any consumer missed
(removal in PR-4 gated on grep returning 0).

Route Governance Contract v1 §8.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add `routeTemplates` dependency to core read-side projections

Core projections currently inject surface URLs as hard-coded `/contacts/${id}` literals — violating the surface-agnostic-backend principle (memory: `feedback_surface_agnostic_backend.md`). PR-2 extracts a `routeTemplates` dependency parameter; surface adapters (Task 11) wire it.

**Files:**

- Modify: `packages/core/src/contacts/list.ts`.
- Modify: `packages/core/src/contacts/detail.ts`.
- Modify: `packages/core/src/decisions/adapters/handoff-adapter.ts`.
- Modify: `packages/core/src/decisions/adapters/recommendation-adapter.ts`.
- Update: the core barrel + test mocks.

- [ ] **Step 1: Verify the exact URL literal sites in core.**

Run:

```bash
rg -n '"/contacts/' packages/core/src --type ts
rg -n '/contacts/\$\{' packages/core/src --type ts
```

Note every hit. Expected 3-4 sites: `contacts/list.ts:63`, `contacts/detail.ts:???` (verify the line — likely inside `buildContactDetailOpenDecisions`), `decisions/adapters/handoff-adapter.ts:22`, `decisions/adapters/recommendation-adapter.ts:48`.

If `contacts/detail.ts` has NO `/contacts/` literal, the spec's reference to `detail.ts:39` was likely about the deps interface, not a URL literal. In that case, Task 10 only adds the `routeTemplates` parameter to `ContactDetailDeps` without changing the function body (preparing for future projections that need a URL). Note this finding in the PR description.

- [ ] **Step 2: Add a shared `RouteTemplates` interface.**

Create `packages/core/src/lib/route-templates.ts` (or a similar dedicated file — locate the conventional spot during impl; if `packages/core/src/lib/` doesn't exist, place at `packages/core/src/contacts/route-templates.ts` and re-export from the contacts barrel):

```ts
/**
 * Surface-agnostic URL templates. Core read-side projections take this as a
 * dependency and call its methods rather than constructing `/contacts/${id}`
 * literals inline. Each transport (api, chat, dashboard) constructs an
 * instance at its boundary; the templates encapsulate the URL shape the
 * dashboard / chat client expects.
 *
 * Route Governance Contract v1 §8.5.
 */
export interface RouteTemplates {
  /** Detail page for a single contact. Used by /contacts list projection. */
  contactDetail(contactId: string): string;
  /** Conversations index for a contact. Used by recommendation adapter. */
  contactConversations(contactId: string): string;
  /** Single conversation under a contact. Used by handoff adapter. */
  contactConversation(contactId: string, threadId: string): string;
}

/**
 * Canonical dashboard template set. Use this from api adapters that want the
 * shape the operator dashboard renders. Apps that surface URLs in a
 * different transport (mobile, embedded SDK) construct their own instance.
 */
export const dashboardRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (contactId) => `/contacts/${contactId}/conversations`,
  contactConversation: (contactId, threadId) => `/contacts/${contactId}/conversations/${threadId}`,
};
```

Export the interface + value from the core barrel (`packages/core/src/index.ts` or its sub-barrels).

- [ ] **Step 3: Inject into `ContactListDeps`.**

Open `packages/core/src/contacts/list.ts`. Add to the deps interface (lines 23-25 at plan-writing time):

```ts
import type { RouteTemplates } from "../lib/route-templates.js"; // adjust path

export interface ListContactsDeps {
  contactStore: Pick<ContactStore, "listForBrowse">;
  routeTemplates: RouteTemplates;
}
```

Replace the inline literal at line 63:

```ts
// Before:
detailHref: `/contacts/${c.id}`,
// After:
detailHref: deps.routeTemplates.contactDetail(c.id),
```

- [ ] **Step 4: Inject into `ContactDetailDeps`.**

Open `packages/core/src/contacts/detail.ts`. Add `routeTemplates: RouteTemplates` to `ContactDetailDeps`. If a URL literal exists in the file (from Step 1 grep), replace it with the appropriate template call.

If no literal exists, the parameter is added prospectively — it costs nothing and matches the pattern downstream consumers expect. Comment inline:

```ts
// routeTemplates: presently unused by this projection but kept to match
// the surface-agnostic injection pattern used by sibling read-side
// projections. Surface URL emission below will adopt this when the
// follow-up projection (e.g. linking to /contacts/:id/threads/:tid) lands.
routeTemplates: RouteTemplates;
```

(Only add the comment if the parameter is truly prospective. If it IS used, no comment.)

- [ ] **Step 5: Inject into the decisions adapters.**

`packages/core/src/decisions/adapters/handoff-adapter.ts`: change `adaptHandoff(row, contact, thread)` signature to `adaptHandoff(row, contact, thread, routeTemplates)` OR (preferred) introduce a deps object: `adaptHandoff(row, contact, thread, deps: { routeTemplates: RouteTemplates })`. The caller (located via grep — likely a decisions composer in `packages/core/src/decisions/`) passes the deps from its own injected RouteTemplates.

Replace line 22:

```ts
// Before:
threadHref: thread ? `/contacts/${contact?.id}/conversations/${thread.id}` : null,
// After:
threadHref:
  thread && contact?.id
    ? deps.routeTemplates.contactConversation(contact.id, thread.id)
    : null,
```

`packages/core/src/decisions/adapters/recommendation-adapter.ts`: same pattern. Change `adaptRecommendation(row)` to accept routeTemplates as part of deps. Replace `deriveThreadHref` (line 48) to use `routeTemplates.contactConversations(contactId)`.

- [ ] **Step 6: Update tests for the changed core function signatures.**

Every test that calls `listContactsForBrowse`, `getContactDetail`, `adaptHandoff`, or `adaptRecommendation` now passes a `routeTemplates`. The simplest fixture is the exported `dashboardRouteTemplates`:

```ts
import { dashboardRouteTemplates } from "@switchboard/core";
// ... in test setup:
const deps = { contactStore: ..., routeTemplates: dashboardRouteTemplates };
```

Find all affected tests:

```bash
rg -n 'listContactsForBrowse\|getContactDetail\|adaptHandoff\|adaptRecommendation' packages/core/src --type ts | grep test
```

Update each.

- [ ] **Step 7: Run core build + tests.**

```bash
pnpm --filter @switchboard/core build 2>&1 | tail -10
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -30
```

Expected: green. If a test fails with "routeTemplates is undefined", the fixture was missed — add `routeTemplates: dashboardRouteTemplates` to its deps.

- [ ] **Step 8: Verify no `/contacts/${` literal remains in core.**

```bash
rg -n '"/contacts/\|/contacts/\$\{' packages/core/src --type ts 2>&1
```

Expected: 0 hits. The `dashboardRouteTemplates` constant in `route-templates.ts` is allowed (it's the canonical owner of these literals); ensure the grep excludes that file or accept 3 hits from that one file. Refine the grep if needed:

```bash
rg -n '/contacts/\$\{' packages/core/src --type ts | grep -v route-templates
```

Expected: 0 hits.

- [ ] **Step 9: Commit.**

```bash
git add packages/core/src/lib/route-templates.ts packages/core/src/contacts/list.ts packages/core/src/contacts/detail.ts packages/core/src/decisions/adapters/handoff-adapter.ts packages/core/src/decisions/adapters/recommendation-adapter.ts packages/core/src/index.ts
# Plus any updated test files
git commit -m "$(cat <<'EOF'
refactor(core): inject routeTemplates instead of hard-coding /contacts/...

Core read-side projections take a RouteTemplates dependency; surface
adapters construct the dashboard template set at their boundary. Removes
4 inline /contacts/... literals from core, completing the
surface-agnostic-backend invariant for these projections.

Closes Cat 3.9.

Route Governance Contract v1 §8.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wire `routeTemplates` from API surface adapters

The core projections now require `routeTemplates`. API routes that call them must pass `dashboardRouteTemplates` (or a custom set) at the boundary.

**Files:**

- Modify: every api route file that calls `listContactsForBrowse`, `getContactDetail`, `adaptHandoff`, or `adaptRecommendation`. Locate via grep.

- [ ] **Step 1: Locate the api consumers.**

```bash
rg -n 'listContactsForBrowse\|getContactDetail\|adaptHandoff\|adaptRecommendation' apps/api/src --type ts | grep -v __tests__
```

Expected hits — typical wiring lives in `apps/api/src/routes/dashboard-contacts.ts` (or similarly-named) and the decisions/recommendations bootstrap. Note every call site.

- [ ] **Step 2: Update each call site.**

Pattern:

```ts
// Before:
const result = await listContactsForBrowse({ orgId, query }, { contactStore: app.contactStore });
// After:
import { dashboardRouteTemplates } from "@switchboard/core";
// ...
const result = await listContactsForBrowse(
  { orgId, query },
  { contactStore: app.contactStore, routeTemplates: dashboardRouteTemplates },
);
```

Apply the same change to every call site. The handoff + recommendation adapters' callers (whoever composes the decisions list) take the deps the same way — find by grep at composition time.

- [ ] **Step 3: Run api build + tests.**

```bash
pnpm --filter @switchboard/api build 2>&1 | tail -10
pnpm --filter @switchboard/api test -- --run 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 4: Commit.**

```bash
git add apps/api/src/routes/dashboard-contacts.ts # plus other touched route files
git commit -m "$(cat <<'EOF'
refactor(api): wire dashboardRouteTemplates into core projection calls

Final consumer-side change for the routeTemplates injection. API routes
construct dashboardRouteTemplates at the boundary and pass it into core
projections; core no longer constructs surface URLs.

Route Governance Contract v1 §8.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Add the cross-app-types doctrine line to `docs/DOCTRINE.md`

**Files:**

- Modify: `docs/DOCTRINE.md`.

- [ ] **Step 1: Locate the right section.**

The doctrine has a section called "Cross-app types" or similar. Open `docs/DOCTRINE.md` and find it. If no such section exists, add one near the "Schemas" / "Types" architectural area.

- [ ] **Step 2: Append the line.**

Add per spec §8.6 verbatim:

```markdown
> **Cross-app types live in `@switchboard/schemas`.** A type declared in `apps/api/`, `apps/chat/`, or `apps/dashboard/` that is also defined elsewhere — by name, by shape, or by structural duplication — is a contract violation. `check-routes` flags new local declarations of types that match a `@switchboard/schemas` export.
```

- [ ] **Step 3: Run lint to confirm markdown formatting.**

If repo has a markdown linter step, run it. Otherwise the line is markdown-clean by construction.

- [ ] **Step 4: Commit.**

```bash
git add docs/DOCTRINE.md
git commit -m "$(cat <<'EOF'
docs(doctrine): cross-app types live in @switchboard/schemas

Spec §8.6 — load-bearing doctrine line. check-routes warns on new local
declarations matching a @switchboard/schemas export (rule added in next
commit).

Route Governance Contract v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Extend `check-routes` with a cross-app-type warning rule

**Files:**

- Create: `.agent/tools/cross-app-type-check.ts`.
- Create: `.agent/tools/__tests__/cross-app-type-check.test.ts`.
- Modify: `.agent/tools/check-routes.ts`.

- [ ] **Step 1: Write failing tests.**

Create `.agent/tools/__tests__/cross-app-type-check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { findLocalCrossAppTypeDeclarations } from "../cross-app-type-check.js";

function makeSource(content: string, fileName = "test.ts") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(fileName, content);
}

describe("findLocalCrossAppTypeDeclarations", () => {
  const schemaExports = new Set([
    "ApprovalRecord",
    "Handoff",
    "OperatorOverview",
    "ConversationState",
    "ConversationSummary",
  ]);

  it("warns on local interface matching a schema export name", () => {
    const sf = makeSource(
      `
      // @route-class: read-only
      interface ApprovalRecord {
        request: string;
      }
      export const x = 1;
    `,
      "apps/api/src/routes/foo.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("ApprovalRecord");
    expect(result[0]?.file).toBe("apps/api/src/routes/foo.ts");
  });

  it("warns on local type alias matching a schema export name", () => {
    const sf = makeSource(
      `
      type Handoff = { id: string };
    `,
      "apps/chat/src/foo.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Handoff");
  });

  it("ignores names that do not appear in schemaExports", () => {
    const sf = makeSource(
      `
      interface MyLocalThing { x: number; }
    `,
      "apps/api/src/foo.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toEqual([]);
  });

  it("ignores re-exports (export type { X } from ...)", () => {
    const sf = makeSource(
      `
      export type { ApprovalRecord } from "@switchboard/schemas";
    `,
      "apps/api/src/foo.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toEqual([]);
  });

  it("ignores test files (path contains __tests__)", () => {
    const sf = makeSource(
      `
      interface ApprovalRecord { id: string; }
    `,
      "apps/api/src/__tests__/foo.test.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toEqual([]);
  });

  it("ignores files outside apps/*/src", () => {
    const sf = makeSource(
      `
      interface Handoff { id: string; }
    `,
      "packages/core/src/foo.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toEqual([]);
  });

  it("returns multiple warnings for multiple collisions in one file", () => {
    const sf = makeSource(
      `
      interface ApprovalRecord { id: string; }
      interface Handoff { id: string; }
      type OperatorOverview = { x: number };
    `,
      "apps/dashboard/src/foo.ts",
    );

    const result = findLocalCrossAppTypeDeclarations([sf], schemaExports);
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm exec vitest run .agent/tools/__tests__/cross-app-type-check.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cross-app-type-check.ts`.**

Create `.agent/tools/cross-app-type-check.ts`:

```ts
import type { SourceFile } from "ts-morph";

export interface CrossAppTypeWarning {
  file: string; // relative path
  line: number;
  name: string; // the duplicated type/interface name
  kind: "interface" | "type-alias";
  message: string;
}

/**
 * Find local interface/type-alias declarations under `apps/*/ src; /**` whose
 * name collides with an export from `@switchboard/schemas`. Re-exports
 * (`export type { X } from ...`) are not flagged; test files are skipped.
 *
 * Route Governance Contract v1 §8.6 / PR-2 warning rule. Promoted to error
 * in PR-4.
 */
export function findLocalCrossAppTypeDeclarations(
  sources: SourceFile[],
  schemaExports: Set<string>,
): CrossAppTypeWarning[] {
  const warnings: CrossAppTypeWarning[] = [];

  for (const sf of sources) {
    const path = sf.getFilePath().replace(/^.*?(apps|packages)\//, "$1/");
    if (!path.startsWith("apps/") || !path.includes("/src/")) continue;
    if (path.includes("__tests__") || path.endsWith(".test.ts")) continue;

    for (const decl of sf.getInterfaces()) {
      const name = decl.getName();
      if (schemaExports.has(name)) {
        warnings.push({
          file: path,
          line: decl.getStartLineNumber(),
          name,
          kind: "interface",
          message: `Local interface '${name}' shadows @switchboard/schemas export. Move to schemas or rename.`,
        });
      }
    }

    for (const decl of sf.getTypeAliases()) {
      // Skip re-exports — they appear as ExportDeclarations elsewhere.
      if (decl.isExported() && decl.getFullText().includes("from ")) continue;
      const name = decl.getName();
      if (schemaExports.has(name)) {
        warnings.push({
          file: path,
          line: decl.getStartLineNumber(),
          name,
          kind: "type-alias",
          message: `Local type alias '${name}' shadows @switchboard/schemas export. Move to schemas or rename.`,
        });
      }
    }
  }

  return warnings;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm exec vitest run .agent/tools/__tests__/cross-app-type-check.test.ts 2>&1 | tail -10`
Expected: PASS — all cases green.

- [ ] **Step 5: Wire into `check-routes`.**

Open `.agent/tools/check-routes.ts`. Locate a good place to invoke the new rule (after existing passes, before exit). Add:

```ts
import { findLocalCrossAppTypeDeclarations } from "./cross-app-type-check.js";

// inside runCheckRoutes(opts), after the existing passes:
const schemaExports = await loadSchemaExports(); // implementation note below
const crossAppWarnings = findLocalCrossAppTypeDeclarations(sources, schemaExports);
for (const w of crossAppWarnings) {
  // Use stderr + non-zero exit ONLY if warning mode flips to error;
  // PR-2 lands in warning mode per spec §8.6.
  console.warn(`[cross-app-type] ${w.file}:${w.line} — ${w.message}`);
}
```

For `loadSchemaExports()`: read `packages/schemas/src/index.ts` and walk re-exports with ts-morph, OR (simpler) maintain a static list in `.agent/tools/cross-app-type-check.ts` of the names PR-2 hoisted (`ApprovalRecord`, `ApprovalState`, `Handoff`, `OperatorOverview`, `ConversationState`, `ConversationMessage`, `ConversationSummary`, `ConversationDetail`, `ConversationListResult`). Static list is the lower-risk choice for PR-2; PR-4 can swap to dynamic enumeration when the rule flips to error.

Pick the static list approach in PR-2 — it's deterministic and fast.

- [ ] **Step 6: Run the full check-routes self-test.**

```bash
pnpm exec vitest run .agent/tools 2>&1 | tail -30
node .agent/tools/check-routes.ts 2>&1 | head -30
```

Expected: tests pass; the CLI runs and emits 0 warnings on `main` (because PR-2 already migrated all known consumers). Any warning that appears here points to a missed migration — fix before committing.

- [ ] **Step 7: Commit.**

```bash
git add .agent/tools/cross-app-type-check.ts .agent/tools/__tests__/cross-app-type-check.test.ts .agent/tools/check-routes.ts
git commit -m "$(cat <<'EOF'
feat(tools): add cross-app-type warning rule to check-routes

Scans apps/*/src/** for local interface/type-alias declarations whose
name collides with a @switchboard/schemas export. Emits stderr warnings
in PR-2; PR-4 flips to error.

Doctrine reference: docs/DOCTRINE.md "Cross-app types live in
@switchboard/schemas".

Route Governance Contract v1 §8.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: End-to-end verification

**Files:** none touched — verification only.

- [ ] **Step 1: Run the full monorepo build.**

```bash
pnpm reset 2>&1 | tail -10
pnpm build 2>&1 | tail -30
```

Expected: clean build. `pnpm reset` is mandatory because PR-2 touches schemas + core + db — stale `dist/` artifacts cause spurious "missing export" errors per the CLAUDE.md note.

- [ ] **Step 2: Run the full test suite.**

```bash
pnpm test 2>&1 | tail -40
```

Expected: green. If a flake fires per the memory hits (e.g., `prisma-work-trace-store-integrity` advisory-lock flake or `bootstrap-smoke` npm-warning flake), confirm it reproduces on baseline `main` and is not a PR-2 regression.

- [ ] **Step 3: Run typecheck across the monorepo.**

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 4: Run the dashboard Next build (CI does NOT run this).**

```bash
pnpm --filter @switchboard/dashboard build 2>&1 | tail -30
```

Expected: green. Per `feedback_dashboard_build_not_in_ci.md` — Next.js extension-related regressions slip past CI's lint+typecheck unless verified locally.

- [ ] **Step 5: Run `pnpm format:check` (CI runs this; local `pnpm lint` does not).**

```bash
pnpm format:check 2>&1 | tail -10
```

Expected: green. Per `feedback_ci_prettier_not_in_local_lint.md`.

- [ ] **Step 6: Run the new check-routes rule against `main`.**

```bash
node .agent/tools/check-routes.ts 2>&1
```

Expected: 0 cross-app-type warnings on the PR-2 branch (because PR-2 migrated all known sites). If non-zero, fix before merging.

- [ ] **Step 7: Verify the grep state is clean.**

```bash
# DashboardOverview consumers (back-compat alias means non-zero is OK, but document):
rg -n 'DashboardOverview' apps packages --type ts | grep -v 'export.*DashboardOverview' | grep -v __tests__

# No local ApprovalRecord interfaces survive:
rg -n 'interface ApprovalRecord\|type ApprovalRecord' apps packages --type ts | grep -v __tests__

# No /contacts/${...} literals in core:
rg -n '/contacts/\$\{' packages/core/src --type ts | grep -v route-templates
```

Expected:

- DashboardOverview: hits in the back-compat alias declaration in dashboard.ts + zero migrated consumers (use-dashboard-overview.ts intentionally keeps the _function name_ `useDashboardOverview` per Task 9 Step 4, but its type annotation is now `OperatorOverview`).
- ApprovalRecord: 0 hits in `interface ApprovalRecord` / `type ApprovalRecord`.
- /contacts/${...}: 0 hits (the only literals live in `route-templates.ts`).

- [ ] **Step 8: No new commit.** Verification is a gate, not a code change. Open the PR after this step passes.

---

## Self-review

Performed after the plan was written, against the spec sections it consumes.

**Spec coverage:**

- §8.1 ApprovalRecord — Tasks 1 + 2 + 3.
- §8.2 ConversationState residual — Tasks 6 + 7.
- §8.3 Handoff — Tasks 4 + 5.
- §8.4 DashboardOverview rename + alias — Tasks 8 + 9.
- §8.5 Surface-URL strings (4 sites) — Tasks 10 + 11.
- §8.6 Doctrine line + check-routes rule — Tasks 12 + 13.
- §12 PR-2 scope (~20 files) — covered. File count: 4 + 4 + 3 + 4 + 6 + 1 + 3 = ~25, within the spec's "~20" tolerance given the test-file additions.

**Type consistency:**

- `Handoff` is the canonical name in schemas; `HandoffPackage` is the back-compat alias. Tasks 4-5 use both consistently.
- `OperatorOverview` is the canonical; `DashboardOverview` is the back-compat alias. Tasks 8-9 use both consistently.
- `ApprovalState` is hoisted in Task 1 before `ApprovalRecord` references it in Task 2.
- `ConversationSummary` (chat / api projection) and `HandoffConversationSummary` (handoff inner) have explicit collision resolution at Task 4 Step 4.
- `routeTemplates` deps interface (Task 10 Step 2) is consistently referenced in Tasks 10-11.

**No placeholders:** searched the document — no TBD, no "implement later", no "similar to Task N" without the code shown.

**Collision risk audited:** Task 0 + the Preflight section document cockpit-v2 collision = 0 hits. Plan is safe to execute concurrently with cockpit-v2 work.

---

## Execution handoff

Plan complete. Two execution options on PR-2 impl:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review. PR-2's tasks are mostly independent type relocations, ideal for parallel-with-checkpoints execution.

2. **Inline Execution** — execute tasks sequentially via `superpowers:executing-plans` with batch checkpoints. Reasonable if reviewer prefers a single linear log.
