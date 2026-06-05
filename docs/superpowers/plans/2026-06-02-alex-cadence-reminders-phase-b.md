# Alex Conversion Polish — Phase B Implementation Plan (cadence + reminders)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shipped one-and-done governed follow-up (#786) into a 3-touch **+2d/+5d/+12d cadence**, and add governed **appointment reminders** ~24 h before a confirmed booking — both reusing the proactive-send pipeline, both fail-closed until Meta approves the (draft) templates.

**Architecture:** Two logical units on one branch (`feat/alex-cadence-reminders`), shipped as **one PR** with cleanly separated commit groups (matches the Phase-A precedent where PR-1a/1b/1c/2 landed as commits in one PR, #794). **PR-3 (Delta A, cadence)** extends the existing `ScheduledFollowUp` queue + dispatch cron. **PR-4 (Delta B, reminders)** clones the send path into a new `ScheduledReminder` queue + a dedicated `conversation.reminder.send` workflow + an hourly booking-driven cron. Store interfaces in `packages/core`, Prisma impls in `packages/db`, crons + workflows in `apps/api`, pure policy primitives in `packages/schemas`.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest (db-layer tests mock Prisma — CI has no Postgres), Prisma, Inngest (crons + step memoization). Prettier (semi, double quotes, 2-space, 100 width). Commitlint (lowercase subject). Run `pnpm typecheck` + the affected `pnpm --filter … test` before each commit.

**Design source:** `docs/superpowers/specs/2026-06-01-alex-conversion-polish-delta-design.md` §"Delta A", §"Delta B", §9, §Amendments. That spec lives on branch `docs/alex-conversion-polish` (PR #794, not yet merged to `main`), so it is **not** present in this worktree — this plan is self-contained.

**Builds on (verified against `main` @ this worktree, not memory):**

- `ScheduledFollowUp` model — `packages/db/prisma/schema.prisma:2034` (fields: `dueAt,status,attempts,dedupeKey,skipReason,lastError,nextRetryAt,sentAt`; `@@unique(dedupeKey)`; `@@index([status,dueAt])`,`@@index([organizationId,contactId])`; **no `touchNumber`/`cadenceId`**).
- Store interface — `packages/core/src/scheduled-follow-up/scheduled-follow-up-store.ts` (`CreateScheduledFollowUpInput`, `DueScheduledFollowUp`, `ScheduledFollowUpStore` = create/findPendingForContact/findDue/markSent/markSkipped/markFailed). Barrel `packages/core/src/index.ts` re-exports it.
- Store impl — `packages/db/src/stores/prisma-scheduled-follow-up-store.ts` (**`MAX_ATTEMPTS = 3`** at `:8` — the spec appendix's "8" is WRONG; `markSent`→`{status:"sent",sentAt}`, `markSkipped`→`{status:"skipped",skipReason}`, `markFailed`→ retry/terminal by `nextRetryAt`).
- Producer — `packages/core/src/skill-runtime/tools/schedule-follow-up.ts` (op `followup.schedule`; `dueAt = now + FOLLOW_UP_DELAY_MS[delay]`; `dedupeKey = followup:${orgId}:${contactId}:${dueAt.slice(0,10)}`; rate-guard `findPendingForContact` → `already_scheduled`; hardcodes `channel:"whatsapp"`, `templateIntentClass:"re-engagement-offer"`, `conversationThreadId = sessionId = ctx.sessionId`).
- Dispatch — `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts` (`*/15 * * * *`; **own `MAX_ATTEMPTS = 3` at `:8`**; per-row `step.run`; maps `!response.ok`→markFailed, `outputs.sent===true`→markSent, `outputs.sent===false`→markSkipped, else→markFailed("no_terminal_outcome"); `computeNextRetry` exponential backoff).
- Workflow — `apps/api/src/services/workflows/conversation-followup-send-workflow.ts` (channel-gate → `getSendContext` → `evaluateProactiveSendEligibility` → phone-gate → env-gate → Graph `POST /v21.0/{phoneNumberId}/messages` with 2 body params; returns `{sent, skipReason}` / `{sent:true, messageId}`).
- Submit builder — `apps/api/src/services/workflows/followup-send-request.ts:20` actor **`{ id: "system", type: "system" }`** (seeded by `ensureSystemIdentity` → principal `"system"`/type `"system"` ↔ IdentitySpec `"default"`, `apps/api/src/bootstrap/system-identity.ts:13-19`). The landmine is a _bespoke_ `system:<x>` id, **not** the `type` field — bare `"system"` is seeded and safe.
- Eligibility — `packages/core/src/notifications/proactive-eligibility.ts:39` `evaluateProactiveSendEligibility(input): {eligible:true,template} | {eligible:false,reason}`. `reason ∈ ProactiveSkipReason` (`packages/schemas/src/scheduled-follow-up.ts:35-43`): `consent_pending, consent_revoked, no_optin, no_template, template_not_approved, marketing_blocked, unsupported_channel`.
- Bootstrap — `apps/api/src/bootstrap/contained-workflows.ts` (`getSendContext` `:166-201`; handler-map `:214`; IntentRegistry `:294-300` `{approvalPolicy:"none",allowedTriggers:["schedule"]}`; submit closure `:323-332`) + `apps/api/src/bootstrap/inngest.ts` (deps `:538-552`, cron registered `:819`).
- Reminder templates — `packages/core/src/skill-runtime/templates/whatsapp-registry.ts:94-127` `appointment_reminder_{sg,my}_v1`, `intentClass:"appointment-reminder"`, `templateCategory:"utility"`, `approvalStatus:"draft"`, **4 vars in order** `lead_name, business_name, date, time`; lookup `selectTemplate({intentClass, jurisdiction})` `:220`.
- Booking — `packages/db/prisma/schema.prisma:1902` (`startsAt`, `endsAt`, **`timezone String @default("Asia/Singapore")` `:1911`**, `status String @default("pending_confirmation")`, `attendeeName`, `organizationId`, `contactId`; `@@index([organizationId,startsAt])`, `@@index([status])`; **no `conversationThreadId`, no `reminderSentAt`**). `BookingStatusSchema` = `pending_confirmation|confirmed|cancelled|no_show|completed|failed` (`packages/schemas/src/calendar.ts:21`). `CalendarProvider` has **no hold/reserve** (`:92`).
- `PrismaBookingStore` — `packages/db/src/stores/prisma-booking-store.ts` (`listByDate`, `countConfirmed`, `countExcludingStatuses`; **no window query**). No shared `BookingStore` interface — extend the concrete class.
- `ConversationThread` — `schema.prisma` (`@@unique([contactId, organizationId])`; `lastWhatsAppInboundAt DateTime?`) → resolvable by the compound unique key.

**Non-negotiable invariants (carry through every task):**

1. Every send is a governed mutation → `PlatformIngress.submit()`; the cron submits, never POSTs WhatsApp directly. Actor **`{ id: "system", type: "system" }`** verbatim.
2. `submit()` does **not** fire consent/window gates — that's why `evaluateProactiveSendEligibility` runs at the mutation site. Reuse it; never assume submit auto-gates.
3. `CalendarProvider` has no hold/reserve — no slot-hold language anywhere.
4. Layering: schemas (no `@switchboard/*` deps) → core (schemas only) → db (schemas+core) → apps. ESM `.js` import extensions; no `console.log`/`any`; commitlint lowercase subject. Schema change → migration in the same commit; `pnpm db:check-drift` (needs Postgres — note if unavailable). db tests mock Prisma. Co-located `*.test.ts`. File-size error 600 / warn 400.
5. Templates ship `draft` → fail-closed: code + tests land, but sends are inert (eligibility soft-skips `template_not_approved`) until Meta approval. Intended.

**Worktree note:** executes in `.claude/worktrees/alex-cadence-reminders` (branch `feat/alex-cadence-reminders`, off `main`). `pnpm install` + `pnpm build` already run (deps present, dist built). Husky hooks need that install; commits in this run use `--no-verify` only if hooks are absent, otherwise let them run. **Cross-package build order:** after changing `packages/schemas`, run `pnpm --filter @switchboard/schemas build` before testing `core`/`db`/`api` (their tests import the built dist — the reset/build gotcha); likewise rebuild `core` after core changes before testing `db`/`api`.

---

# PR-3 — Delta A: Multi-touch cadence (extends #786)

Consumer-driven: the producer schedules **touch 1** (`now + 2d`); on each **successful** send the dispatch schedules the **next** touch (send-relative: `now + 3d`, then `now + 7d`), stopping at 3. Skips are classified — durable ineligibility ends the cadence; activation skips (`template_not_approved`/`no_template`) keep the row re-evaluable so a lead isn't burned before Meta approves the templates. Legacy #786 rows (`cadenceId` null) are one-and-done, never advanced, no backfill.

## Task 1 (PR-3): Cadence policy primitives in `@switchboard/schemas`

Pure, dependency-free constants + helpers so both the producer (core) and dispatch (api) share one source of truth for cadence timing, the dedupe-key format, and skip classification.

**Files:**

- Modify: `packages/schemas/src/scheduled-follow-up.ts` (append exports after the existing `ProactiveSkipReasonSchema`)
- Test: `packages/schemas/src/scheduled-follow-up.test.ts` (extend)

- [ ] **Step 1: Write the failing tests.** Append to `scheduled-follow-up.test.ts`:

```ts
import {
  CADENCE_TOUCH1_DELAY_MS,
  NEXT_TOUCH_GAP_DAYS,
  MAX_CADENCE_TOUCHES,
  MIN_NEXT_TOUCH_GAP_MS,
  ACTIVATION_RETRY_INTERVAL_MS,
  ACTIVATION_MAX_OVERDUE_MS,
  buildFollowUpDedupeKey,
  classifyCadenceSkip,
} from "./scheduled-follow-up.js";

describe("cadence primitives", () => {
  it("exposes the +2/+5/+12 cadence constants", () => {
    expect(CADENCE_TOUCH1_DELAY_MS).toBe(2 * 24 * 60 * 60 * 1000);
    expect(NEXT_TOUCH_GAP_DAYS).toEqual({ 1: 3, 2: 7 });
    expect(MAX_CADENCE_TOUCHES).toBe(3);
    expect(MIN_NEXT_TOUCH_GAP_MS).toBe(48 * 60 * 60 * 1000);
    expect(ACTIVATION_RETRY_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(ACTIVATION_MAX_OVERDUE_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("buildFollowUpDedupeKey is day-bucketed and touch-suffixed", () => {
    const dueAt = new Date("2026-06-04T09:30:00.000Z");
    expect(buildFollowUpDedupeKey("org_1", "c_1", dueAt, 1)).toBe(
      "followup:org_1:c_1:2026-06-04:t1",
    );
    expect(buildFollowUpDedupeKey("org_1", "c_1", dueAt, 2)).toBe(
      "followup:org_1:c_1:2026-06-04:t2",
    );
  });

  it("classifyCadenceSkip: only template_not_approved/no_template are re-evaluable", () => {
    expect(classifyCadenceSkip("template_not_approved")).toBe("activation");
    expect(classifyCadenceSkip("no_template")).toBe("activation");
    for (const durable of [
      "consent_revoked",
      "consent_pending",
      "no_optin",
      "marketing_blocked",
      "unsupported_channel",
      "unknown",
    ]) {
      expect(classifyCadenceSkip(durable)).toBe("durable");
    }
  });
});
```

- [ ] **Step 2: Run; verify FAIL.** Run: `pnpm --filter @switchboard/schemas test -- scheduled-follow-up` → FAIL (exports undefined).

- [ ] **Step 3: Implement.** Append to `packages/schemas/src/scheduled-follow-up.ts`:

```ts
/** Touch 1 fires +2d after the lead defers (the "+2" in +2/+5/+12). */
export const CADENCE_TOUCH1_DELAY_MS = 2 * 24 * 60 * 60 * 1000;
/** Send-relative gap to the NEXT touch, keyed by the just-sent touchNumber. */
export const NEXT_TOUCH_GAP_DAYS: Record<number, number> = { 1: 3, 2: 7 };
/** Stop after 3 touches. */
export const MAX_CADENCE_TOUCHES = 3;
/** Never schedule the next touch sooner than 48h out (compression floor). */
export const MIN_NEXT_TOUCH_GAP_MS = 48 * 60 * 60 * 1000;
/** Relaxed re-eval interval for an activation skip (template not yet approved). */
export const ACTIVATION_RETRY_INTERVAL_MS = 60 * 60 * 1000;
/** Past this much overdue, an unsent activation-skipped touch terminates as stale. */
export const ACTIVATION_MAX_OVERDUE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Stable, day-bucketed dedupe key for a cadence touch. The `:t${touchNumber}`
 * suffix makes touches collision-proof even when two land on the same calendar
 * day; the day bucket keeps it idempotent across cron retries within a day.
 */
export function buildFollowUpDedupeKey(
  organizationId: string,
  contactId: string,
  dueAt: Date,
  touchNumber: number,
): string {
  const dayBucket = dueAt.toISOString().slice(0, 10);
  return `followup:${organizationId}:${contactId}:${dayBucket}:t${touchNumber}`;
}

const ACTIVATION_SKIP_REASONS = new Set<string>(["template_not_approved", "no_template"]);

/**
 * Cadence skip taxonomy. Only activation skips (template pending Meta approval)
 * keep a row re-evaluable; everything else — durable ineligibility AND any
 * unrecognised reason — terminates the cadence (fail-closed; never loops).
 */
export function classifyCadenceSkip(reason: string): "durable" | "activation" {
  return ACTIVATION_SKIP_REASONS.has(reason) ? "activation" : "durable";
}
```

- [ ] **Step 4: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/schemas test -- scheduled-follow-up && pnpm --filter @switchboard/schemas typecheck` → PASS. Then rebuild so downstream packages see it: `pnpm --filter @switchboard/schemas build`.

- [ ] **Step 5: Commit.**

```bash
git add packages/schemas/src/scheduled-follow-up.ts packages/schemas/src/scheduled-follow-up.test.ts
git commit -m "feat(followup): cadence policy primitives (constants, dedupe-key, skip taxonomy)"
```

---

## Task 2 (PR-3): Follow-up store layer — cadence columns, projection, markDeferred, next-touch builder

**Files:**

- Modify: `packages/db/prisma/schema.prisma:2034` (`ScheduledFollowUp` += 2 columns)
- Create: `packages/db/prisma/migrations/20260602090000_add_followup_cadence_columns/migration.sql`
- Modify: `packages/core/src/scheduled-follow-up/scheduled-follow-up-store.ts` (input + projection + interface)
- Create: `packages/core/src/scheduled-follow-up/cadence.ts` (`buildNextCadenceTouch`) + barrel export in `packages/core/src/scheduled-follow-up/index.ts`
- Test: `packages/core/src/scheduled-follow-up/cadence.test.ts`
- Modify: `packages/db/src/stores/prisma-scheduled-follow-up-store.ts` (rename const, create, findDue, markDeferred)
- Test: `packages/db/src/stores/__tests__/prisma-scheduled-follow-up-store.test.ts`

- [ ] **Step 1: Add the schema columns.** In `schema.prisma`, inside `model ScheduledFollowUp` (after `nextRetryAt DateTime?`):

```prisma
  touchNumber          Int       @default(1)
  cadenceId            String?
```

- [ ] **Step 2: Hand-write the migration** (must match Prisma's expected DDL so `db:check-drift` is clean; additive, no index). Create `migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ScheduledFollowUp" ADD COLUMN "touchNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ScheduledFollowUp" ADD COLUMN "cadenceId" TEXT;
```

Run `pnpm db:generate` so the Prisma client picks up the new fields (if Postgres is reachable, also run `pnpm db:check-drift`; if not, note that drift validation is deferred to CI — the DDL above is the standard Prisma mapping for `Int @default(1)` / `String?`).

- [ ] **Step 3: Extend the store types (write the failing core test first).** Create `packages/core/src/scheduled-follow-up/cadence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildNextCadenceTouch } from "./cadence.js";
import type { DueScheduledFollowUp } from "./scheduled-follow-up-store.js";

const NOW = new Date("2026-06-04T00:00:00.000Z");
function row(overrides: Partial<DueScheduledFollowUp> = {}): DueScheduledFollowUp {
  return {
    id: "fu_1",
    organizationId: "org_1",
    contactId: "c_1",
    conversationThreadId: "th_1",
    sessionId: "th_1",
    deploymentId: "dep_1",
    workUnitId: "wu_1",
    channel: "whatsapp",
    jurisdiction: "SG",
    reason: "hesitation",
    note: null,
    templateIntentClass: "re-engagement-offer",
    attempts: 0,
    dueAt: new Date("2026-06-02T00:00:00.000Z"),
    touchNumber: 1,
    cadenceId: "cad_1",
    ...overrides,
  };
}

describe("buildNextCadenceTouch", () => {
  it("touch 1 → touch 2 at now+3d with inherited fields", () => {
    const next = buildNextCadenceTouch(row(), NOW);
    expect(next).not.toBeNull();
    expect(next!.touchNumber).toBe(2);
    expect(next!.cadenceId).toBe("cad_1");
    expect(next!.dueAt).toEqual(new Date("2026-06-07T00:00:00.000Z"));
    expect(next!.dedupeKey).toBe("followup:org_1:c_1:2026-06-07:t2");
    expect(next!.deploymentId).toBe("dep_1");
    expect(next!.templateIntentClass).toBe("re-engagement-offer");
  });

  it("touch 2 → touch 3 at now+7d", () => {
    const next = buildNextCadenceTouch(row({ touchNumber: 2 }), NOW);
    expect(next!.touchNumber).toBe(3);
    expect(next!.dueAt).toEqual(new Date("2026-06-11T00:00:00.000Z"));
    expect(next!.dedupeKey).toBe("followup:org_1:c_1:2026-06-11:t3");
  });

  it("touch 3 → null (cadence complete)", () => {
    expect(buildNextCadenceTouch(row({ touchNumber: 3 }), NOW)).toBeNull();
  });

  it("legacy row (cadenceId null) → null (never advances)", () => {
    expect(buildNextCadenceTouch(row({ cadenceId: null }), NOW)).toBeNull();
  });
});
```

- [ ] **Step 4: Run; verify FAIL.** Run: `pnpm --filter @switchboard/core test -- cadence` → FAIL (`./cadence.js` + types missing).

- [ ] **Step 5: Extend `scheduled-follow-up-store.ts`.** Add `touchNumber` + `cadenceId` to `CreateScheduledFollowUpInput`; expand `DueScheduledFollowUp` with the carry-over + decision fields; add `markDeferred` to the interface:

```ts
export interface CreateScheduledFollowUpInput {
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  sessionId: string | null;
  deploymentId: string | null;
  workUnitId: string | null;
  channel: string;
  jurisdiction: string | null;
  reason: string;
  note: string | null;
  templateIntentClass: string;
  dueAt: Date;
  dedupeKey: string;
  touchNumber: number;
  cadenceId: string | null;
}

export interface DueScheduledFollowUp {
  id: string;
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  sessionId: string | null;
  deploymentId: string | null;
  workUnitId: string | null;
  channel: string;
  jurisdiction: string | null;
  reason: string;
  note: string | null;
  templateIntentClass: string;
  attempts: number;
  dueAt: Date;
  touchNumber: number;
  cadenceId: string | null;
}
```

In the `ScheduledFollowUpStore` interface, add after `markSkipped`:

```ts
  /** Activation skip (e.g. template pending approval): stay pending + re-eval
   * later WITHOUT consuming a send attempt or advancing the cadence. */
  markDeferred(id: string, reason: string, nextRetryAt: Date): Promise<void>;
```

- [ ] **Step 6: Create `cadence.ts`.** `packages/core/src/scheduled-follow-up/cadence.ts`:

```ts
import {
  NEXT_TOUCH_GAP_DAYS,
  MAX_CADENCE_TOUCHES,
  MIN_NEXT_TOUCH_GAP_MS,
  buildFollowUpDedupeKey,
} from "@switchboard/schemas";
import type {
  CreateScheduledFollowUpInput,
  DueScheduledFollowUp,
} from "./scheduled-follow-up-store.js";

/**
 * Given a just-SENT cadence touch, build the next touch's create input — or
 * null if the cadence is complete or this is a legacy one-and-done row.
 * Send-relative: anchored on `now` (≈ the row's just-written sentAt), so a
 * delayed send STRETCHES the cadence, never compresses it. Day-bucketed dedupe
 * key keeps it idempotent across cron retries.
 */
export function buildNextCadenceTouch(
  row: DueScheduledFollowUp,
  now: Date,
): CreateScheduledFollowUpInput | null {
  if (row.cadenceId === null) return null;
  if (row.touchNumber >= MAX_CADENCE_TOUCHES) return null;
  const gapDays = NEXT_TOUCH_GAP_DAYS[row.touchNumber];
  if (gapDays === undefined) return null;
  const gapMs = gapDays * 24 * 60 * 60 * 1000;
  const nextDueAt = new Date(now.getTime() + Math.max(gapMs, MIN_NEXT_TOUCH_GAP_MS));
  const touchNumber = row.touchNumber + 1;
  return {
    organizationId: row.organizationId,
    contactId: row.contactId,
    conversationThreadId: row.conversationThreadId,
    sessionId: row.sessionId,
    deploymentId: row.deploymentId,
    workUnitId: row.workUnitId,
    channel: row.channel,
    jurisdiction: row.jurisdiction,
    reason: row.reason,
    note: row.note,
    templateIntentClass: row.templateIntentClass,
    dueAt: nextDueAt,
    dedupeKey: buildFollowUpDedupeKey(row.organizationId, row.contactId, nextDueAt, touchNumber),
    touchNumber,
    cadenceId: row.cadenceId,
  };
}
```

Add to `packages/core/src/scheduled-follow-up/index.ts`: `export * from "./cadence.js";`

- [ ] **Step 7: Run; verify core PASS.** Run: `pnpm --filter @switchboard/core test -- cadence && pnpm --filter @switchboard/core typecheck` → PASS. Rebuild: `pnpm --filter @switchboard/core build`.

- [ ] **Step 8: Write the failing db-store tests.** In `prisma-scheduled-follow-up-store.test.ts`: (a) update the existing `create` test to pass + assert `touchNumber`/`cadenceId`; (b) update the `findDue` test's expected `select` to the expanded projection; (c) add a `markDeferred` test:

```ts
it("create persists touchNumber and cadenceId", async () => {
  prisma.scheduledFollowUp.create.mockResolvedValue({ id: "fu_1" });
  await store.create({
    organizationId: "org_1",
    contactId: "c_1",
    conversationThreadId: "th_1",
    sessionId: "th_1",
    deploymentId: "dep_1",
    workUnitId: "wu_1",
    channel: "whatsapp",
    jurisdiction: "SG",
    reason: "hesitation",
    note: null,
    templateIntentClass: "re-engagement-offer",
    dueAt: new Date("2026-06-04T00:00:00.000Z"),
    dedupeKey: "followup:org_1:c_1:2026-06-04:t1",
    touchNumber: 1,
    cadenceId: "cad_1",
  });
  expect(prisma.scheduledFollowUp.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ touchNumber: 1, cadenceId: "cad_1", status: "pending" }),
      select: { id: true },
    }),
  );
});

it("findDue projects the cadence + carry-over fields", async () => {
  prisma.scheduledFollowUp.findMany.mockResolvedValue([]);
  await store.findDue(new Date("2026-06-04T00:00:00.000Z"), 100);
  const call = prisma.scheduledFollowUp.findMany.mock.calls[0]![0];
  expect(call.select).toEqual({
    id: true,
    organizationId: true,
    contactId: true,
    conversationThreadId: true,
    sessionId: true,
    deploymentId: true,
    workUnitId: true,
    channel: true,
    jurisdiction: true,
    reason: true,
    note: true,
    templateIntentClass: true,
    attempts: true,
    dueAt: true,
    touchNumber: true,
    cadenceId: true,
  });
  expect(call.where.attempts).toEqual({ lt: 3 });
});

it("markDeferred keeps the row pending without consuming an attempt", async () => {
  prisma.scheduledFollowUp.update.mockResolvedValue({});
  const at = new Date("2026-06-04T01:00:00.000Z");
  await store.markDeferred("fu_1", "template_not_approved", at);
  expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
    where: { id: "fu_1" },
    data: { status: "pending", skipReason: "template_not_approved", nextRetryAt: at },
  });
});
```

- [ ] **Step 9: Run; verify FAIL.** Run: `pnpm --filter @switchboard/db test -- prisma-scheduled-follow-up-store` → FAIL.

- [ ] **Step 10: Implement the db changes.** In `prisma-scheduled-follow-up-store.ts`: rename the constant `MAX_ATTEMPTS` → `MAX_SEND_ATTEMPTS` (line 8 + its use in `findDue`); in `create`'s `data` add `touchNumber: input.touchNumber, cadenceId: input.cadenceId`; in `findDue`'s `select` add `sessionId, deploymentId, workUnitId, jurisdiction, note, dueAt, touchNumber, cadenceId` (all `true`); add the method:

```ts
  async markDeferred(id: string, reason: string, nextRetryAt: Date): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: { status: "pending", skipReason: reason, nextRetryAt },
    });
  }
```

- [ ] **Step 11: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/db test -- prisma-scheduled-follow-up-store && pnpm --filter @switchboard/db typecheck` → PASS. Rebuild: `pnpm --filter @switchboard/db build`.

- [ ] **Step 12: Commit.**

```bash
git add packages/db/prisma packages/core/src/scheduled-follow-up packages/db/src/stores
git commit -m "feat(followup): add cadence columns, expanded due projection, and markDeferred"
```

---

## Task 3 (PR-3): Producer — start a cadence (touch 1 at +2d)

Every follow-up Alex schedules now starts a 3-touch cadence: `touchNumber=1`, a fresh `cadenceId` (episode id), `dueAt = now + 2d` (fixed; the `delay` enum input is kept for back-compat but **superseded for timing**), and a `:t1` dedupe key.

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/schedule-follow-up.ts`
- Test: `packages/core/src/skill-runtime/tools/schedule-follow-up.test.ts`

- [ ] **Step 1: Update the producer tests to the cadence contract.** In `schedule-follow-up.test.ts`: inject a deterministic id generator, and change the success assertion to the fixed +2d due date + `:t1` key + cadence fields. Replace the existing `makeDeps`/success assertions:

```ts
function makeDeps() {
  return {
    followUpStore: {
      create: vi.fn().mockResolvedValue({ id: "fu_1" }),
      findPendingForContact: vi.fn().mockResolvedValue(null),
    },
    now: () => new Date("2026-06-01T00:00:00.000Z"),
    genId: () => "cad_1",
  };
}
```

```ts
it("schedules cadence touch 1 at now+2d with a fresh cadenceId", async () => {
  const deps = makeDeps();
  const tool = createScheduleFollowUpToolFactory(deps)();
  const res = await tool.run({ reason: "hesitation", delay: "in_1_week" }, CTX);
  expect(res.status).toBe("success");
  expect(deps.followUpStore.create).toHaveBeenCalledWith(
    expect.objectContaining({
      touchNumber: 1,
      cadenceId: "cad_1",
      dueAt: new Date("2026-06-03T00:00:00.000Z"),
      dedupeKey: "followup:org_1:contact_1:2026-06-03:t1",
      templateIntentClass: "re-engagement-offer",
    }),
  );
  expect(res.data).toEqual({
    followUpId: "fu_1",
    scheduledFor: "2026-06-03T00:00:00.000Z",
    status: "scheduled",
  });
});
```

(Note: the assertion proves `delay:"in_1_week"` is ignored — the due date is +2d, not +7d.)

- [ ] **Step 2: Run; verify FAIL.** Run: `pnpm --filter @switchboard/core test -- schedule-follow-up` → FAIL (no `touchNumber`/`cadenceId`; dueAt still delay-driven).

- [ ] **Step 3: Implement.** In `schedule-follow-up.ts`:
  - Import the cadence delay + dedupe-key builder from schemas: `import { CADENCE_TOUCH1_DELAY_MS, buildFollowUpDedupeKey } from "@switchboard/schemas";` (keep the existing `FOLLOW_UP_DELAY_MS`/type imports — `delay` stays a required, validated input even though timing no longer uses it).
  - Add `genId` to the deps type (`genId?: () => string`) and resolve it: `const genId = deps.genId ?? (() => randomUUID());` (import `randomUUID` from `node:crypto`).
  - Replace the `dueAt`/`dedupeKey` computation:

```ts
const cadenceId = genId();
const dueAt = new Date(now().getTime() + CADENCE_TOUCH1_DELAY_MS);
const dedupeKey = buildFollowUpDedupeKey(ctx.orgId, contactId, dueAt, 1);
```

- In the `create({...})` call, add `touchNumber: 1, cadenceId,`. (Leave the rate-guard `findPendingForContact` short-circuit unchanged — it correctly prevents a second concurrent cadence per contact; dispatch-side `create` bypasses it, so touches 2/3 are unaffected.)

- [ ] **Step 4: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/core test -- schedule-follow-up && pnpm --filter @switchboard/core typecheck` → PASS. Rebuild: `pnpm --filter @switchboard/core build`.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/tools/schedule-follow-up.ts packages/core/src/skill-runtime/tools/schedule-follow-up.test.ts
git commit -m "feat(followup): producer starts a 3-touch cadence (touch 1 at +2d)"
```

---

## Task 4 (PR-3): Dispatch — skip taxonomy + next-touch scheduling + wiring

On a successful send the dispatch schedules the next touch (idempotent via the day-bucket dedupe key + a P2002 catch). On a skip it branches: durable → terminal `markSkipped` (cadence ends); activation → `markDeferred` (re-evaluable) unless past the 14-day overdue cap → terminal `stale_unsent`. Only `sent:true` advances. Legacy `cadenceId`-null rows never advance.

**Files:**

- Modify: `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts`
- Create/extend test: `apps/api/src/services/cron/scheduled-follow-up-dispatch.test.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts` (wire `createFollowUp` + `markDeferred` deps)

> Confirm the api package name first: `node -p "require('./apps/api/package.json').name"` → use that in `--filter` (this plan assumes `@switchboard/api`).

- [ ] **Step 1: Write the failing dispatch tests.** In `scheduled-follow-up-dispatch.test.ts` (create if absent; mirror the existing api cron test style — a fake `step` whose `run` just awaits the fn, and `vi.fn()` deps). Cover the five spec cases:

```ts
import { describe, expect, it, vi } from "vitest";
import { executeScheduledFollowUpDispatch } from "./scheduled-follow-up-dispatch.js";
import type { DueScheduledFollowUp } from "@switchboard/core";

const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
const NOW = new Date("2026-06-04T00:00:00.000Z");
function due(o: Partial<DueScheduledFollowUp> = {}): DueScheduledFollowUp {
  return {
    id: "fu_1",
    organizationId: "org_1",
    contactId: "c_1",
    conversationThreadId: "th_1",
    sessionId: "th_1",
    deploymentId: "dep_1",
    workUnitId: "wu_1",
    channel: "whatsapp",
    jurisdiction: "SG",
    reason: "hesitation",
    note: null,
    templateIntentClass: "re-engagement-offer",
    attempts: 0,
    dueAt: new Date("2026-06-02T00:00:00.000Z"),
    touchNumber: 1,
    cadenceId: "cad_1",
    ...o,
  };
}
function deps(over: Record<string, unknown> = {}) {
  return {
    failure: {} as never,
    findDueFollowUps: vi.fn().mockResolvedValue([due()]),
    submitFollowUpSend: vi
      .fn()
      .mockResolvedValue({ ok: true, result: { outputs: { sent: true } } }),
    createFollowUp: vi.fn().mockResolvedValue({ id: "fu_2" }),
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
    markDeferred: vi.fn(),
    now: () => NOW,
    ...over,
  };
}

describe("cadence dispatch", () => {
  it("sent + touch 1 → markSent then creates touch 2 at now+3d", async () => {
    const d = deps();
    await executeScheduledFollowUpDispatch(step, d as never);
    expect(d.markSent).toHaveBeenCalledWith("fu_1");
    expect(d.createFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        touchNumber: 2,
        cadenceId: "cad_1",
        dueAt: new Date("2026-06-07T00:00:00.000Z"),
        dedupeKey: "followup:org_1:c_1:2026-06-07:t2",
      }),
    );
  });

  it("sent + touch 3 → no touch 4", async () => {
    const d = deps({ findDueFollowUps: vi.fn().mockResolvedValue([due({ touchNumber: 3 })]) });
    await executeScheduledFollowUpDispatch(step, d as never);
    expect(d.markSent).toHaveBeenCalled();
    expect(d.createFollowUp).not.toHaveBeenCalled();
  });

  it("legacy row (cadenceId null) sent → no advance", async () => {
    const d = deps({ findDueFollowUps: vi.fn().mockResolvedValue([due({ cadenceId: null })]) });
    await executeScheduledFollowUpDispatch(step, d as never);
    expect(d.createFollowUp).not.toHaveBeenCalled();
  });

  it("durable skip (consent_revoked) → terminal markSkipped, no advance", async () => {
    const d = deps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "consent_revoked" } },
      }),
    });
    await executeScheduledFollowUpDispatch(step, d as never);
    expect(d.markSkipped).toHaveBeenCalledWith("fu_1", "consent_revoked");
    expect(d.markDeferred).not.toHaveBeenCalled();
    expect(d.createFollowUp).not.toHaveBeenCalled();
  });

  it("activation skip (template_not_approved) within window → markDeferred (re-evaluable)", async () => {
    const d = deps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
      }),
    });
    await executeScheduledFollowUpDispatch(step, d as never);
    expect(d.markDeferred).toHaveBeenCalledWith(
      "fu_1",
      "template_not_approved",
      new Date("2026-06-04T01:00:00.000Z"),
    );
    expect(d.markSkipped).not.toHaveBeenCalled();
  });

  it("activation skip past the 14d overdue cap → terminal stale_unsent", async () => {
    const d = deps({
      findDueFollowUps: vi
        .fn()
        .mockResolvedValue([due({ dueAt: new Date("2026-05-01T00:00:00.000Z") })]),
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
      }),
    });
    await executeScheduledFollowUpDispatch(step, d as never);
    expect(d.markSkipped).toHaveBeenCalledWith("fu_1", "stale_unsent");
    expect(d.markDeferred).not.toHaveBeenCalled();
  });

  it("next-touch create that hits the unique constraint is swallowed (idempotent)", async () => {
    const d = deps({ createFollowUp: vi.fn().mockRejectedValue({ code: "P2002" }) });
    await expect(executeScheduledFollowUpDispatch(step, d as never)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run; verify FAIL.** Run: `pnpm --filter @switchboard/api test -- scheduled-follow-up-dispatch` → FAIL.

- [ ] **Step 3: Implement the dispatch changes.**
  - Rename this file's own `MAX_ATTEMPTS` (`:8`) → `MAX_SEND_ATTEMPTS` (and its use in `computeNextRetry`).
  - Add imports: `import { buildNextCadenceTouch, type CreateScheduledFollowUpInput } from "@switchboard/core";` and `import { classifyCadenceSkip, ACTIVATION_RETRY_INTERVAL_MS, ACTIVATION_MAX_OVERDUE_MS } from "@switchboard/schemas";`.
  - Extend `ScheduledFollowUpDispatchDeps` with:

```ts
createFollowUp: (input: CreateScheduledFollowUpInput) => Promise<{ id: string }>;
markDeferred: (id: string, reason: string, nextRetryAt: Date) => Promise<void>;
```

- Add a module-level guard:

```ts
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
```

- Replace the `sent === true` branch:

```ts
if (outputs.sent === true) {
  await deps.markSent(followUp.id);
  sent++;
  const next = buildNextCadenceTouch(followUp, now());
  if (next) {
    try {
      await deps.createFollowUp(next);
    } catch (err) {
      // Same-day-bucket next touch already exists (cron-retry idempotency).
      if (!isUniqueConstraintError(err)) throw err;
    }
  }
  return;
}
```

- Replace the `sent === false` branch:

```ts
if (outputs.sent === false) {
  const reason = outputs.skipReason ?? "unknown";
  if (classifyCadenceSkip(reason) === "activation") {
    const overdueMs = now().getTime() - followUp.dueAt.getTime();
    if (overdueMs > ACTIVATION_MAX_OVERDUE_MS) {
      await deps.markSkipped(followUp.id, "stale_unsent");
    } else {
      await deps.markDeferred(
        followUp.id,
        reason,
        new Date(now().getTime() + ACTIVATION_RETRY_INTERVAL_MS),
      );
    }
  } else {
    await deps.markSkipped(followUp.id, reason);
  }
  skipped++;
  return;
}
```

- [ ] **Step 4: Run; verify PASS.** Run: `pnpm --filter @switchboard/api test -- scheduled-follow-up-dispatch` → PASS.

- [ ] **Step 5: Wire the new deps in `inngest.ts`.** In the `scheduledFollowUpDispatchDeps` block (`:540-552`), add:

```ts
    createFollowUp: (input) => followUpStore.create(input),
    markDeferred: (id, reason, nextRetryAt) => followUpStore.markDeferred(id, reason, nextRetryAt),
```

- [ ] **Step 6: Typecheck the app.** Run: `pnpm --filter @switchboard/api typecheck` → PASS (the dispatch deps object is now complete).

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/services/cron/scheduled-follow-up-dispatch.ts apps/api/src/services/cron/scheduled-follow-up-dispatch.test.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(followup): advance cadence on send + classify skips (durable vs activation)"
```

---

# PR-4 — Delta B: Appointment reminders (clones the #786 send path)

An hourly, booking-driven cron finds confirmed bookings in `[now+23h, now+25h]`, creates a `ScheduledReminder` (strict dedupe), and submits a dedicated `conversation.reminder.send` workflow that reuses `evaluateProactiveSendEligibility` with `intentClass:"appointment-reminder"` (utility template → the marketing-block flag is irrelevant). Date/time are rendered from `booking.startsAt` in the booking's own `timezone`. Reminders are **single-attempt** (time-critical; strict dedupe prevents double-sends); a failed send is recorded, not retried.

## Task 5 (PR-4): Reminder primitives — schemas status/dedupe + core date/time formatter

**Files:**

- Create: `packages/schemas/src/scheduled-reminder.ts`
- Test: `packages/schemas/src/scheduled-reminder.test.ts`
- Modify: `packages/schemas/src/index.ts` (export the new module)
- Create: `packages/core/src/notifications/reminder-template-vars.ts`
- Test: `packages/core/src/notifications/reminder-template-vars.test.ts`

- [ ] **Step 1: Write the failing schemas test.** `packages/schemas/src/scheduled-reminder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ScheduledReminderStatusSchema, buildReminderDedupeKey } from "./scheduled-reminder.js";

describe("scheduled-reminder primitives", () => {
  it("status enum", () => {
    expect(ScheduledReminderStatusSchema.options).toEqual(["pending", "sent", "skipped", "failed"]);
  });
  it("dedupe key is booking + exact startsAt (reschedule-safe)", () => {
    const at = new Date("2026-05-13T02:00:00.000Z");
    expect(buildReminderDedupeKey("bk_1", at)).toBe("reminder:bk_1:2026-05-13T02:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run; verify FAIL.** Run: `pnpm --filter @switchboard/schemas test -- scheduled-reminder` → FAIL.

- [ ] **Step 3: Implement `scheduled-reminder.ts`.**

```ts
import { z } from "zod";

export const ScheduledReminderStatusSchema = z.enum(["pending", "sent", "skipped", "failed"]);
export type ScheduledReminderStatus = z.infer<typeof ScheduledReminderStatusSchema>;

/**
 * Reschedule-safe dedupe key. Keyed on the EXACT startsAt — if a booking moves,
 * the key changes and a fresh reminder fires for the new time. (bookingId alone
 * would suppress the reminder for the rescheduled slot.)
 */
export function buildReminderDedupeKey(bookingId: string, startsAt: Date): string {
  return `reminder:${bookingId}:${startsAt.toISOString()}`;
}
```

Add to `packages/schemas/src/index.ts`: `export * from "./scheduled-reminder.js";`

- [ ] **Step 4: Write the failing formatter test.** `packages/core/src/notifications/reminder-template-vars.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatReminderDateTime } from "./reminder-template-vars.js";

describe("formatReminderDateTime", () => {
  it("renders date + time in the clinic timezone (SG, +8)", () => {
    // 02:00 UTC == 10:00 AM in Asia/Singapore on 13 May 2026
    const out = formatReminderDateTime(new Date("2026-05-13T02:00:00.000Z"), "Asia/Singapore");
    expect(out.date).toBe("13 May 2026");
    expect(out.time).toBe("10:00 AM");
  });
  it("respects a different timezone (MY shares +8)", () => {
    const out = formatReminderDateTime(new Date("2026-05-13T01:30:00.000Z"), "Asia/Kuala_Lumpur");
    expect(out.date).toBe("13 May 2026");
    expect(out.time).toBe("9:30 AM");
  });
});
```

- [ ] **Step 5: Run; verify FAIL.** Run: `pnpm --filter @switchboard/core test -- reminder-template-vars` → FAIL.

- [ ] **Step 6: Implement `reminder-template-vars.ts`** (raw `Intl.DateTimeFormat`, normalizing the narrow no-break space Node emits before AM/PM — mirrors the `time-folio.ts` pattern):

```ts
/**
 * Render an appointment's date + time for the WhatsApp reminder template, in the
 * clinic's timezone. `date` → "13 May 2026"; `time` → "10:00 AM". A wrong-tz
 * reminder is worse than none, so the timezone is always explicit.
 */
export function formatReminderDateTime(
  startsAt: Date,
  timezone: string,
): { date: string; time: string } {
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const norm = (s: string): string => s.replace(/[  ]/g, " ");
  return { date: norm(dateFmt.format(startsAt)), time: norm(timeFmt.format(startsAt)) };
}
```

- [ ] **Step 7: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/schemas test -- scheduled-reminder && pnpm --filter @switchboard/core test -- reminder-template-vars && pnpm --filter @switchboard/core typecheck`. Rebuild both: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build`.

- [ ] **Step 8: Commit.**

```bash
git add packages/schemas/src/scheduled-reminder.ts packages/schemas/src/scheduled-reminder.test.ts packages/schemas/src/index.ts packages/core/src/notifications/reminder-template-vars.ts packages/core/src/notifications/reminder-template-vars.test.ts
git commit -m "feat(reminders): scheduled-reminder primitives + clinic-tz date/time formatter"
```

---

## Task 6 (PR-4): `ScheduledReminder` queue — schema, store interface, store impl

Mirrors `ScheduledFollowUp` but lean: no `attempts`/`nextRetryAt` (single-attempt), no `dueAt`-based dispatch (the cron is booking-driven). Delivery state stays off the `Booking` entity.

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (new `ScheduledReminder` model)
- Create: `packages/db/prisma/migrations/20260602093000_add_scheduled_reminder/migration.sql`
- Create: `packages/core/src/scheduled-reminder/scheduled-reminder-store.ts` + `packages/core/src/scheduled-reminder/index.ts`
- Modify: `packages/core/src/index.ts` (export the barrel)
- Create: `packages/db/src/stores/prisma-scheduled-reminder-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-scheduled-reminder-store.test.ts`
- Modify: `packages/db/src/index.ts` (export the impl)

- [ ] **Step 1: Add the Prisma model.** In `schema.prisma` (place near `ScheduledFollowUp`):

```prisma
/// Idempotent queue for appointment reminders (~24h pre-booking). Delivery state
/// lives here, not on Booking. Single-attempt: no attempts/nextRetryAt.
model ScheduledReminder {
  id                  String    @id @default(uuid())
  organizationId      String
  contactId           String
  bookingId           String
  startsAt            DateTime
  timezone            String
  channel             String    @default("whatsapp")
  templateIntentClass String
  status              String    @default("pending")
  skipReason          String?
  lastError           String?
  sentAt              DateTime?
  dedupeKey           String    @unique
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([bookingId])
}
```

- [ ] **Step 2: Hand-write the migration.** `migration.sql` (index/constraint names match Prisma's auto-naming; all ≤63 chars):

```sql
-- CreateTable
CREATE TABLE "ScheduledReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "templateIntentClass" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledReminder_dedupeKey_key" ON "ScheduledReminder"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledReminder_bookingId_idx" ON "ScheduledReminder"("bookingId");
```

Run `pnpm db:generate` (and `pnpm db:check-drift` if Postgres is up; else note CI will validate).

- [ ] **Step 3: Create the store interface.** `packages/core/src/scheduled-reminder/scheduled-reminder-store.ts`:

```ts
export interface CreateScheduledReminderInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  startsAt: Date;
  timezone: string;
  channel: string;
  templateIntentClass: string;
  dedupeKey: string;
}

/** Existing-row probe used by the cron to decide skip/create/resubmit. */
export interface ScheduledReminderProbe {
  id: string;
  status: string;
}

/**
 * Idempotent reminder queue. The reminder cron is the only producer/consumer.
 * Single-attempt: markFailed is terminal (no retry).
 */
export interface ScheduledReminderStore {
  create(input: CreateScheduledReminderInput): Promise<{ id: string }>;
  findByDedupeKey(dedupeKey: string): Promise<ScheduledReminderProbe | null>;
  markSent(id: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
```

`packages/core/src/scheduled-reminder/index.ts`: `export * from "./scheduled-reminder-store.js";`
Add to `packages/core/src/index.ts`: `export * from "./scheduled-reminder/index.js";`

- [ ] **Step 4: Write the failing db-store test.** `packages/db/src/stores/__tests__/prisma-scheduled-reminder-store.test.ts` (mirror the follow-up store test's mock-Prisma pattern):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaScheduledReminderStore } from "../prisma-scheduled-reminder-store.js";

function makePrisma() {
  return { scheduledReminder: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() } };
}

describe("PrismaScheduledReminderStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaScheduledReminderStore;
  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaScheduledReminderStore(prisma as never);
  });

  it("create persists pending row", async () => {
    prisma.scheduledReminder.create.mockResolvedValue({ id: "rm_1" });
    const out = await store.create({
      organizationId: "org_1",
      contactId: "c_1",
      bookingId: "bk_1",
      startsAt: new Date("2026-05-13T02:00:00.000Z"),
      timezone: "Asia/Singapore",
      channel: "whatsapp",
      templateIntentClass: "appointment-reminder",
      dedupeKey: "reminder:bk_1:2026-05-13T02:00:00.000Z",
    });
    expect(out).toEqual({ id: "rm_1" });
    expect(prisma.scheduledReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending" }),
        select: { id: true },
      }),
    );
  });

  it("findByDedupeKey returns id+status or null", async () => {
    prisma.scheduledReminder.findUnique.mockResolvedValue({ id: "rm_1", status: "sent" });
    expect(await store.findByDedupeKey("k")).toEqual({ id: "rm_1", status: "sent" });
    expect(prisma.scheduledReminder.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: "k" },
      select: { id: true, status: true },
    });
    prisma.scheduledReminder.findUnique.mockResolvedValue(null);
    expect(await store.findByDedupeKey("k")).toBeNull();
  });

  it("markSent / markSkipped / markFailed set terminal state", async () => {
    prisma.scheduledReminder.update.mockResolvedValue({});
    await store.markSent("rm_1");
    expect(prisma.scheduledReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rm_1" },
        data: expect.objectContaining({ status: "sent" }),
      }),
    );
    await store.markSkipped("rm_1", "template_not_approved");
    expect(prisma.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: "rm_1" },
      data: { status: "skipped", skipReason: "template_not_approved" },
    });
    await store.markFailed("rm_1", "boom");
    expect(prisma.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: "rm_1" },
      data: { status: "failed", lastError: "boom" },
    });
  });
});
```

- [ ] **Step 5: Run; verify FAIL.** Run: `pnpm --filter @switchboard/db test -- prisma-scheduled-reminder-store` → FAIL.

- [ ] **Step 6: Implement `prisma-scheduled-reminder-store.ts`.**

```ts
import type { PrismaClient } from "@prisma/client";
import type {
  CreateScheduledReminderInput,
  ScheduledReminderProbe,
  ScheduledReminderStore,
} from "@switchboard/core";

export class PrismaScheduledReminderStore implements ScheduledReminderStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScheduledReminderInput): Promise<{ id: string }> {
    const row = await this.prisma.scheduledReminder.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        bookingId: input.bookingId,
        startsAt: input.startsAt,
        timezone: input.timezone,
        channel: input.channel,
        templateIntentClass: input.templateIntentClass,
        dedupeKey: input.dedupeKey,
        status: "pending",
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findByDedupeKey(dedupeKey: string): Promise<ScheduledReminderProbe | null> {
    return this.prisma.scheduledReminder.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: "skipped", skipReason: reason },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.scheduledReminder.update({
      where: { id },
      data: { status: "failed", lastError: error },
    });
  }
}
```

Add to `packages/db/src/index.ts`: `export * from "./stores/prisma-scheduled-reminder-store.js";` (match the existing export style — verify whether the file uses `export *` or named re-exports and follow it).

- [ ] **Step 7: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/db test -- prisma-scheduled-reminder-store && pnpm --filter @switchboard/core build && pnpm --filter @switchboard/db typecheck`. Rebuild: `pnpm --filter @switchboard/db build`.

- [ ] **Step 8: Commit.**

```bash
git add packages/db/prisma packages/core/src/scheduled-reminder packages/core/src/index.ts packages/db/src/stores/prisma-scheduled-reminder-store.ts packages/db/src/stores/__tests__/prisma-scheduled-reminder-store.test.ts packages/db/src/index.ts
git commit -m "feat(reminders): add ScheduledReminder queue (schema, store interface, impl)"
```

---

## Task 7 (PR-4): `PrismaBookingStore.findUpcomingConfirmed` (cross-org window query)

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `prisma-booking-store.test.ts`:

```ts
it("findUpcomingConfirmed: confirmed-only, cross-org, [start,end) window", async () => {
  (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "bk_1",
      organizationId: "org_1",
      contactId: "c_1",
      startsAt: new Date("2026-05-13T02:00:00.000Z"),
      timezone: "Asia/Singapore",
      attendeeName: "Mei",
    },
  ]);
  const start = new Date("2026-05-12T00:00:00.000Z");
  const end = new Date("2026-05-12T02:00:00.000Z");
  const rows = await store.findUpcomingConfirmed(start, end);
  const call = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(call.where).toEqual({ status: "confirmed", startsAt: { gte: start, lt: end } });
  expect(call.where.organizationId).toBeUndefined(); // cross-org
  expect(rows[0]).toEqual({
    id: "bk_1",
    organizationId: "org_1",
    contactId: "c_1",
    startsAt: new Date("2026-05-13T02:00:00.000Z"),
    timezone: "Asia/Singapore",
    attendeeName: "Mei",
  });
});
```

- [ ] **Step 2: Run; verify FAIL.** Run: `pnpm --filter @switchboard/db test -- prisma-booking-store` → FAIL.

- [ ] **Step 3: Implement** (add after `listByDate`; relies on the existing `@@index([status])` to narrow to confirmed, then the `startsAt` range — adequate for pilot volume; a composite `[status,startsAt]` index is a future optimization, deliberately not added to keep this migration-free):

```ts
  async findUpcomingConfirmed(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<
    Array<{
      id: string;
      organizationId: string;
      contactId: string;
      startsAt: Date;
      timezone: string;
      attendeeName: string | null;
    }>
  > {
    const rows = await this.prisma.booking.findMany({
      where: { status: "confirmed", startsAt: { gte: windowStart, lt: windowEnd } },
      orderBy: { startsAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      contactId: r.contactId,
      startsAt: r.startsAt,
      timezone: r.timezone,
      attendeeName: r.attendeeName,
    }));
  }
```

- [ ] **Step 4: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/db test -- prisma-booking-store && pnpm --filter @switchboard/db typecheck`. Rebuild: `pnpm --filter @switchboard/db build`.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "feat(reminders): add PrismaBookingStore.findUpcomingConfirmed window query"
```

---

## Task 8 (PR-4): `conversation.reminder.send` workflow + submit-request builder

A dedicated clone of the follow-up send path (the spec rejects generalizing over two examples). Reuses `evaluateProactiveSendEligibility`; fills the 4-var utility template; renders date/time from `startsAt` in the booking's timezone (passed in the params).

**Files:**

- Create: `apps/api/src/services/workflows/reminder-send-request.ts`
- Create: `apps/api/src/services/workflows/conversation-reminder-send-workflow.ts`
- Test: `apps/api/src/services/workflows/conversation-reminder-send-workflow.test.ts`

- [ ] **Step 1: Create the submit-request builder** `reminder-send-request.ts` (clone of `followup-send-request.ts`; same seeded actor; distinct intent + idempotency namespace):

```ts
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";

export interface ReminderSendSubmitInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  startsAt: string; // ISO
  timezone: string;
  channel: string;
  reminderId: string;
}

/**
 * Build the canonical submit request for an appointment reminder. Cron-initiated
 * work is a TRACE ROOT, so it carries the seeded `system` principal directly
 * (bare "system" id → "default" IdentitySpec via ensureSystemIdentity). A bespoke
 * `system:<x>` id would hard-deny — use the seeded one verbatim.
 */
export function buildReminderSendSubmitRequest(
  input: ReminderSendSubmitInput,
  deployment: { deploymentId: string; skillSlug: string } | null,
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: "conversation.reminder.send",
    parameters: {
      contactId: input.contactId,
      bookingId: input.bookingId,
      startsAt: input.startsAt,
      timezone: input.timezone,
      channel: input.channel,
      reminderId: input.reminderId,
    },
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `reminder-send:${input.reminderId}`,
    targetHint: deployment
      ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
      : undefined,
  };
}
```

- [ ] **Step 2: Write the failing workflow tests.** `conversation-reminder-send-workflow.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildConversationReminderSendWorkflow } from "./conversation-reminder-send-workflow.js";

const TEMPLATE = {
  name: "appointment_reminder_sg_v1",
  metaTemplateName: "alex_appointment_reminder_sg_v1",
  intentClass: "appointment-reminder",
  jurisdiction: "SG",
  templateCategory: "utility",
  approvalStatus: "approved",
  body: "",
  variables: [],
} as const;

function ctx(over = {}) {
  return {
    consentGrantedAt: new Date("2026-01-01T00:00:00Z"),
    consentRevokedAt: null,
    pdpaJurisdiction: "SG",
    messagingOptIn: true,
    lastWhatsAppInboundAt: new Date("2026-05-12T12:00:00Z"),
    jurisdiction: "SG",
    leadName: "Mei",
    businessName: "Glow Clinic",
    phone: "+6591234567",
    ...over,
  };
}
function workUnit(params = {}) {
  return {
    organizationId: "org_1",
    parameters: {
      contactId: "c_1",
      bookingId: "bk_1",
      startsAt: "2026-05-13T02:00:00.000Z",
      timezone: "Asia/Singapore",
      channel: "whatsapp",
      reminderId: "rm_1",
      ...params,
    },
  };
}

describe("conversation.reminder.send", () => {
  it("skips unsupported channel", async () => {
    const wf = buildConversationReminderSendWorkflow({
      getSendContext: vi.fn(),
      allowMarketingTemplate: false,
      selectTemplateFn: () => TEMPLATE,
    });
    const res = await wf.execute(workUnit({ channel: "sms" }) as never);
    expect(res.outputs).toEqual({ sent: false, skipReason: "unsupported_channel" });
  });

  it("skips when not eligible (e.g. draft template)", async () => {
    const wf = buildConversationReminderSendWorkflow({
      getSendContext: vi.fn().mockResolvedValue(ctx()),
      allowMarketingTemplate: false,
      selectTemplateFn: () => ({ ...TEMPLATE, approvalStatus: "draft" }),
    });
    const res = await wf.execute(workUnit() as never);
    expect(res.outputs).toEqual({ sent: false, skipReason: "template_not_approved" });
  });

  it("missing phone → clean skip (single-attempt; not a retryable failure)", async () => {
    const wf = buildConversationReminderSendWorkflow({
      getSendContext: vi.fn().mockResolvedValue(ctx({ phone: null })),
      allowMarketingTemplate: false,
      selectTemplateFn: () => TEMPLATE,
    });
    const res = await wf.execute(workUnit() as never);
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: false, skipReason: "missing_contact_phone" });
  });

  it("eligible + WA configured → sends 4-var template with tz-rendered date/time", async () => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "tok";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "pn_1";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.X" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const wf = buildConversationReminderSendWorkflow({
      getSendContext: vi.fn().mockResolvedValue(ctx()),
      allowMarketingTemplate: false,
      selectTemplateFn: () => TEMPLATE,
    });
    const res = await wf.execute(workUnit() as never);
    expect(res.outputs).toEqual({ sent: true, messageId: "wamid.X" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "Mei" },
      { type: "text", text: "Glow Clinic" },
      { type: "text", text: "13 May 2026" },
      { type: "text", text: "10:00 AM" },
    ]);
    vi.unstubAllGlobals();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
  });
});
```

- [ ] **Step 3: Run; verify FAIL.** Run: `pnpm --filter @switchboard/api test -- conversation-reminder-send-workflow` → FAIL.

- [ ] **Step 4: Implement `conversation-reminder-send-workflow.ts`** (clone of the follow-up workflow; 4 params; tz date/time; missing-phone is a clean skip so a phoneless contact isn't retried):

```ts
import type { WorkflowHandler } from "@switchboard/core/platform";
import { evaluateProactiveSendEligibility, formatReminderDateTime } from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";

const REMINDER_INTENT_CLASS: IntentClass = "appointment-reminder";

export interface ReminderSendContext {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: PdpaJurisdiction | null;
  messagingOptIn: boolean;
  lastWhatsAppInboundAt: Date | null;
  jurisdiction: "SG" | "MY" | null;
  leadName: string;
  businessName: string;
  phone: string | null;
}

export interface ConversationReminderSendDeps {
  getSendContext: (orgId: string, contactId: string) => Promise<ReminderSendContext>;
  allowMarketingTemplate: boolean;
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"];
}

interface ReminderSendParams {
  contactId: string;
  bookingId: string;
  startsAt: string;
  timezone: string;
  channel: string;
  reminderId: string;
}

export function buildConversationReminderSendWorkflow(
  deps: ConversationReminderSendDeps,
): WorkflowHandler {
  return {
    async execute(workUnit) {
      const params = workUnit.parameters as unknown as ReminderSendParams;

      if (params.channel !== "whatsapp") {
        return {
          outcome: "completed",
          summary: "Reminder skipped: unsupported channel",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const ctx = await deps.getSendContext(workUnit.organizationId, params.contactId);

      const eligibility = evaluateProactiveSendEligibility({
        contact: {
          pdpaJurisdiction: ctx.pdpaJurisdiction,
          consentGrantedAt: ctx.consentGrantedAt,
          consentRevokedAt: ctx.consentRevokedAt,
          messagingOptIn: ctx.messagingOptIn,
        },
        lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
        intentClass: REMINDER_INTENT_CLASS,
        jurisdiction: ctx.jurisdiction,
        allowMarketingTemplate: deps.allowMarketingTemplate,
        selectTemplateFn: deps.selectTemplateFn,
      });

      if (!eligibility.eligible) {
        return {
          outcome: "completed",
          summary: `Reminder skipped: ${eligibility.reason}`,
          outputs: { sent: false, skipReason: eligibility.reason },
        };
      }

      if (!ctx.phone) {
        // Single-attempt: record a clean skip rather than a retryable failure.
        return {
          outcome: "completed",
          summary: "Reminder skipped: contact has no phone",
          outputs: { sent: false, skipReason: "missing_contact_phone" },
        };
      }

      const accessToken = process.env["WHATSAPP_ACCESS_TOKEN"];
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        return {
          outcome: "completed",
          summary: "WhatsApp not configured; reminder skipped",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const { date, time } = formatReminderDateTime(new Date(params.startsAt), params.timezone);

      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: ctx.phone,
          type: "template",
          template: {
            name: eligibility.template.metaTemplateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: ctx.leadName },
                  { type: "text", text: ctx.businessName },
                  { type: "text", text: date },
                  { type: "text", text: time },
                ],
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        return {
          outcome: "failed",
          summary: "Reminder send failed",
          error: { code: "WHATSAPP_TEMPLATE_SEND_FAILED", message: await response.text() },
        };
      }

      const json = (await response.json()) as { messages?: Array<{ id?: string }> };
      return {
        outcome: "completed",
        summary: "Reminder sent",
        outputs: { sent: true, messageId: json.messages?.[0]?.id ?? null },
      };
    },
  };
}
```

- [ ] **Step 5: Run; verify PASS + typecheck.** Run: `pnpm --filter @switchboard/api test -- conversation-reminder-send-workflow && pnpm --filter @switchboard/api typecheck` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/services/workflows/reminder-send-request.ts apps/api/src/services/workflows/conversation-reminder-send-workflow.ts apps/api/src/services/workflows/conversation-reminder-send-workflow.test.ts
git commit -m "feat(reminders): conversation.reminder.send workflow + submit-request builder"
```

---

## Task 9 (PR-4): Reminder cron + bootstrap wiring

Hourly cron over `[now+23h, now+25h]`; per booking: probe dedupe → skip if terminally handled, else create + submit + map result. Plus the bootstrap: `getReminderSendContext`, handler-map + IntentRegistry entries, the submit closure, and the inngest deps + cron registration.

**Files:**

- Create: `apps/api/src/services/cron/appointment-reminder-dispatch.ts`
- Test: `apps/api/src/services/cron/appointment-reminder-dispatch.test.ts`
- Modify: `apps/api/src/bootstrap/contained-workflows.ts` (context, handler, registry, submit closure, return)
- Modify: `apps/api/src/bootstrap/inngest.ts` (deps + cron registration)
- Modify: `apps/api/src/app.ts` (thread `submitScheduledReminder` into inngest options — mirror `submitScheduledFollowUp`)

- [ ] **Step 1: Write the failing cron tests.** `appointment-reminder-dispatch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { executeAppointmentReminderDispatch } from "./appointment-reminder-dispatch.js";

const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
const NOW = new Date("2026-05-12T01:00:00.000Z");
function booking(o = {}) {
  return {
    id: "bk_1",
    organizationId: "org_1",
    contactId: "c_1",
    startsAt: new Date("2026-05-13T02:00:00.000Z"),
    timezone: "Asia/Singapore",
    attendeeName: "Mei",
    ...o,
  };
}
function deps(over = {}) {
  return {
    failure: {} as never,
    findUpcomingConfirmed: vi.fn().mockResolvedValue([booking()]),
    findReminderByDedupeKey: vi.fn().mockResolvedValue(null),
    createReminder: vi.fn().mockResolvedValue({ id: "rm_1" }),
    submitReminderSend: vi
      .fn()
      .mockResolvedValue({ ok: true, result: { outputs: { sent: true } } }),
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
    now: () => NOW,
    ...over,
  };
}

describe("appointment reminder dispatch", () => {
  it("queries the [now+23h, now+25h] window", async () => {
    const d = deps();
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.findUpcomingConfirmed).toHaveBeenCalledWith(
      new Date("2026-05-13T00:00:00.000Z"),
      new Date("2026-05-13T02:00:00.000Z"),
    );
  });

  it("creates a reminder (dedupe key) and marks sent", async () => {
    const d = deps();
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "bk_1",
        organizationId: "org_1",
        contactId: "c_1",
        timezone: "Asia/Singapore",
        channel: "whatsapp",
        templateIntentClass: "appointment-reminder",
        dedupeKey: "reminder:bk_1:2026-05-13T02:00:00.000Z",
      }),
    );
    expect(d.submitReminderSend).toHaveBeenCalledWith(
      expect.objectContaining({ reminderId: "rm_1", bookingId: "bk_1", channel: "whatsapp" }),
    );
    expect(d.markSent).toHaveBeenCalledWith("rm_1");
  });

  it("skips a booking already terminally handled", async () => {
    const d = deps({
      findReminderByDedupeKey: vi.fn().mockResolvedValue({ id: "rm_1", status: "sent" }),
    });
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.createReminder).not.toHaveBeenCalled();
    expect(d.submitReminderSend).not.toHaveBeenCalled();
  });

  it("maps sent:false → markSkipped(reason)", async () => {
    const d = deps({
      submitReminderSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
      }),
    });
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.markSkipped).toHaveBeenCalledWith("rm_1", "template_not_approved");
  });

  it("maps !ok → markFailed (terminal, no retry)", async () => {
    const d = deps({
      submitReminderSend: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { type: "upstream_error" } }),
    });
    await executeAppointmentReminderDispatch(step, d as never);
    expect(d.markFailed).toHaveBeenCalledWith("rm_1", "upstream_error");
  });
});
```

- [ ] **Step 2: Run; verify FAIL.** Run: `pnpm --filter @switchboard/api test -- appointment-reminder-dispatch` → FAIL.

- [ ] **Step 3: Implement `appointment-reminder-dispatch.ts`** (mirrors the follow-up cron's structure: Inngest fn + a testable executor; `buildReminderDedupeKey` from schemas; window = `[now+23h, now+25h]`; P2002-tolerant create):

```ts
import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { buildReminderDedupeKey } from "@switchboard/schemas";

const inngestClient = new Inngest({ id: "switchboard" });

const WINDOW_LOWER_MS = 23 * 60 * 60 * 1000;
const WINDOW_UPPER_MS = 25 * 60 * 60 * 1000;

export interface UpcomingBooking {
  id: string;
  organizationId: string;
  contactId: string;
  startsAt: Date;
  timezone: string;
  attendeeName: string | null;
}

export interface ReminderSendSubmitInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  startsAt: string;
  timezone: string;
  channel: string;
  reminderId: string;
}

export interface AppointmentReminderDispatchDeps {
  failure: AsyncFailureContext;
  findUpcomingConfirmed: (windowStart: Date, windowEnd: Date) => Promise<UpcomingBooking[]>;
  findReminderByDedupeKey: (dedupeKey: string) => Promise<{ id: string; status: string } | null>;
  createReminder: (input: {
    organizationId: string;
    contactId: string;
    bookingId: string;
    startsAt: Date;
    timezone: string;
    channel: string;
    templateIntentClass: string;
    dedupeKey: string;
  }) => Promise<{ id: string }>;
  submitReminderSend: (input: ReminderSendSubmitInput) => Promise<SubmitWorkResponse>;
  markSent: (id: string) => Promise<void>;
  markSkipped: (id: string, reason: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

const TERMINAL = new Set(["sent", "skipped", "failed"]);

export async function executeAppointmentReminderDispatch(
  step: StepTools,
  deps: AppointmentReminderDispatchDeps,
): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const windowStart = new Date(now.getTime() + WINDOW_LOWER_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_UPPER_MS);
  const bookings = await step.run("find-upcoming-confirmed", () =>
    deps.findUpcomingConfirmed(windowStart, windowEnd),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const b of bookings) {
    await step.run(`reminder-${b.id}-${b.startsAt.toISOString()}`, async () => {
      const dedupeKey = buildReminderDedupeKey(b.id, b.startsAt);
      const existing = await deps.findReminderByDedupeKey(dedupeKey);
      if (existing && TERMINAL.has(existing.status)) return;

      let reminderId = existing?.id;
      if (!reminderId) {
        try {
          reminderId = (
            await deps.createReminder({
              organizationId: b.organizationId,
              contactId: b.contactId,
              bookingId: b.id,
              startsAt: b.startsAt,
              timezone: b.timezone,
              channel: "whatsapp",
              templateIntentClass: "appointment-reminder",
              dedupeKey,
            })
          ).id;
        } catch (err) {
          if (isUniqueConstraintError(err)) return; // race: another tick created it
          throw err;
        }
      }

      const response = await deps.submitReminderSend({
        organizationId: b.organizationId,
        contactId: b.contactId,
        bookingId: b.id,
        startsAt: b.startsAt.toISOString(),
        timezone: b.timezone,
        channel: "whatsapp",
        reminderId,
      });

      if (!response.ok) {
        await deps.markFailed(reminderId, response.error.type);
        failed++;
        return;
      }
      const outputs = (response.result.outputs ?? {}) as { sent?: boolean; skipReason?: string };
      if (outputs.sent === true) {
        await deps.markSent(reminderId);
        sent++;
        return;
      }
      if (outputs.sent === false) {
        await deps.markSkipped(reminderId, outputs.skipReason ?? "unknown");
        skipped++;
        return;
      }
      await deps.markFailed(reminderId, "no_terminal_outcome");
      failed++;
    });
  }

  return { processed: bookings.length, sent, skipped, failed };
}

export function createAppointmentReminderDispatchCron(deps: AppointmentReminderDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "appointment-reminder-dispatch",
      name: "Appointment Reminder Dispatch",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "appointment-reminder-dispatch",
          eventDomain: "appointment-reminder",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      return executeAppointmentReminderDispatch(step as unknown as StepTools, deps);
    },
  );
}
```

- [ ] **Step 4: Run; verify cron PASS.** Run: `pnpm --filter @switchboard/api test -- appointment-reminder-dispatch` → PASS.

- [ ] **Step 5: Wire the bootstrap in `contained-workflows.ts`.**
  - Build the reminder handler (mirror `followUpSendHandler`), with a `getReminderSendContext` that resolves the thread by the `(contactId, organizationId)` compound unique key (Booking has no threadId):

```ts
const reminderSendHandler = buildConversationReminderSendWorkflow({
  getSendContext: async (orgId, contactId) => {
    const prisma = prismaClient as import("@switchboard/db").PrismaClient;
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId: orgId },
      select: {
        name: true,
        phone: true,
        messagingOptIn: true,
        pdpaJurisdiction: true,
        consentGrantedAt: true,
        consentRevokedAt: true,
      },
    });
    const org = await prisma.organizationConfig.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    const thread = await prisma.conversationThread.findUnique({
      where: { contactId_organizationId: { contactId, organizationId: orgId } },
      select: { lastWhatsAppInboundAt: true },
    });
    return {
      consentGrantedAt: contact?.consentGrantedAt ?? null,
      consentRevokedAt: contact?.consentRevokedAt ?? null,
      pdpaJurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
      messagingOptIn: contact?.messagingOptIn ?? false,
      lastWhatsAppInboundAt: thread?.lastWhatsAppInboundAt ?? null,
      jurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
      leadName: contact?.name ?? "there",
      businessName: org?.name ?? "our clinic",
      phone: contact?.phone ?? null,
    };
  },
  // Utility template → marketing-block is irrelevant; keep false.
  allowMarketingTemplate: false,
});
```

- Add to the `handlers` Map: `["conversation.reminder.send", reminderSendHandler],`
- Add to `workflowIntents` (verbatim shape of the follow-up entry):

```ts
    {
      intent: "conversation.reminder.send",
      workflowId: "conversation.reminder.send",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["schedule"],
    },
```

- Add the submit closure next to `submitScheduledFollowUp` and return it:

```ts
const submitScheduledReminder = async (
  input: ReminderSendSubmitInput,
): Promise<SubmitWorkResponse> => {
  const deployment = await resolveDeploymentForIntent(
    deploymentResolver,
    input.organizationId,
    "conversation.reminder.send",
  );
  return platformIngress.submit(buildReminderSendSubmitRequest(input, deployment));
};

return { instantFormAdapter, submitScheduledFollowUp, submitScheduledReminder };
```

Add the imports at the top of the file: `buildConversationReminderSendWorkflow` (from the workflow), `buildReminderSendSubmitRequest` + `ReminderSendSubmitInput` (from `reminder-send-request.ts`).

- [ ] **Step 6: Wire `inngest.ts`.** Construct the reminder store + booking store, build the deps, register the cron (mirror the follow-up block at `:538-552` + `:819`):

```ts
const scheduledReminderStore = new PrismaScheduledReminderStore(app.prisma);
const bookingStore = new PrismaBookingStore(app.prisma);
const appointmentReminderDispatchDeps: AppointmentReminderDispatchDeps = {
  failure: asyncFailure,
  findUpcomingConfirmed: (start, end) => bookingStore.findUpcomingConfirmed(start, end),
  findReminderByDedupeKey: (k) => scheduledReminderStore.findByDedupeKey(k),
  createReminder: (input) => scheduledReminderStore.create(input),
  submitReminderSend: (input) => {
    if (!options.submitScheduledReminder) {
      throw new Error("submitScheduledReminder not wired");
    }
    return options.submitScheduledReminder(input);
  },
  markSent: (id) => scheduledReminderStore.markSent(id),
  markSkipped: (id, reason) => scheduledReminderStore.markSkipped(id, reason),
  markFailed: (id, error) => scheduledReminderStore.markFailed(id, error),
};
```

Add `createAppointmentReminderDispatchCron(appointmentReminderDispatchDeps),` to the Inngest functions array (near `:819`). Add the imports (`PrismaScheduledReminderStore`, `PrismaBookingStore` — check if `PrismaBookingStore` is already imported; reuse if so — and the cron's `createAppointmentReminderDispatchCron`/`AppointmentReminderDispatchDeps`). Extend the inngest `options` type with `submitScheduledReminder?: (input: ReminderSendSubmitInput) => Promise<SubmitWorkResponse>` (mirror `submitScheduledFollowUp`).

- [ ] **Step 7: Thread `submitScheduledReminder` through `app.ts`.** Where `submitScheduledFollowUp` is taken from `bootstrapContainedWorkflows(...)`'s result and passed into the inngest options, also pull and pass `submitScheduledReminder` (grep `submitScheduledFollowUp` in `app.ts` and mirror every occurrence).

- [ ] **Step 8: Typecheck + the api suite.** Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test -- "reminder"`. Expected PASS (workflow + cron). Fix any wiring type gaps the typecheck surfaces.

- [ ] **Step 9: Commit.**

```bash
git add apps/api/src/services/cron/appointment-reminder-dispatch.ts apps/api/src/services/cron/appointment-reminder-dispatch.test.ts apps/api/src/bootstrap/contained-workflows.ts apps/api/src/bootstrap/inngest.ts apps/api/src/app.ts
git commit -m "feat(reminders): hourly appointment-reminder cron + bootstrap wiring"
```

---

## Self-Review

- **Spec coverage — Delta A (cadence):** §2 #1 columns → Task 2 (migration). #2 send-relative timing + 48h floor → Task 1 constants + Task 2 `buildNextCadenceTouch`. #3 producer touch-1 → Task 3. #4 dispatch `scheduleNextTouch` + legacy guard → Task 4 (sent branch). #5 skip taxonomy (durable terminal / activation re-evaluable / max-age `stale_unsent`) → Task 1 `classifyCadenceSkip` + Task 4 (skip branch) + `markDeferred` (Task 2). #6 rename `MAX_ATTEMPTS`→`MAX_SEND_ATTEMPTS` + `MAX_CADENCE_TOUCHES` + `:t${n}` dedupe + legacy one-and-done → Tasks 1/2/4. ✅
- **Spec coverage — Delta B (reminders):** §3 #1 `findUpcomingConfirmed` → Task 7. #2 `ScheduledReminder` queue + reschedule-safe `reminder:${bookingId}:${startsAt}` dedupe (bookingId indexed not unique) → Tasks 5/6. #3 hourly `[now+23h,now+25h]` cron + create-then-submit + result mapping → Task 9. #4 dedicated `conversation.reminder.send` clone + `evaluateProactiveSendEligibility(intentClass:"appointment-reminder")` + tz date/time + registry/IntentRegistry/actor → Tasks 5/8/9. ✅
- **Deliberate deviations from the spec (all documented):** (a) `cadenceId` is a fresh episode UUID, not literally touch-1's row id — preserves every stated purpose (episode linkage, in-cadence flag, legacy distinction) without a post-create write. (b) Send-relative anchor is the dispatch clock `now` (≈ the just-written `sentAt`) rather than a re-read `sentAt`; day-bucket dedupe + P2002 catch give cron-retry idempotency without changing `markSent`'s signature. (c) Reminders are single-attempt (no `attempts`/`nextRetryAt`/retry loop) — time-critical + strict dedupe; a transient failure is recorded `failed`, not retried. (d) No new `Booking` index — `@@index([status])` covers the pilot-scale window scan; composite index deferred. (e) `delay` enum kept in the producer input but superseded for timing (fixed +2d). (f) Skip taxonomy applies uniformly to legacy rows (re-evaluable activation skips) but legacy rows still never _advance_.
- **Placeholder scan:** every code step has real code. The only "verify/adjust" notes are package-filter name and the `db/src/index.ts` export style — both deterministic checks, not invented content.
- **Type consistency:** `DueScheduledFollowUp` (expanded in Task 2) is consumed identically by `buildNextCadenceTouch` (Task 2) and the dispatch (Task 4). `CreateScheduledFollowUpInput` (+`touchNumber`,`cadenceId`) is produced by Task 3 + `buildNextCadenceTouch` and consumed by the store (Task 2). `ScheduledReminderStore`/`CreateScheduledReminderInput` (Task 6) match the cron deps + impl (Tasks 6/9). `ReminderSendSubmitInput` is defined in both `reminder-send-request.ts` (Task 8) and the cron (Task 9) with identical shape — they must stay in sync (the cron's `submitReminderSend` dep is satisfied by the closure built from `buildReminderSendSubmitRequest`). `formatReminderDateTime` (Task 5) is used in Task 8. `buildReminderDedupeKey` (Task 5) is used in Task 9. ✅

---

## Final Integration & Verification

- [ ] **Full build + typecheck + affected suites.** From the worktree root:

```bash
pnpm build
pnpm typecheck
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/api test
```

All green. (Run the full `pnpm test` if time permits; at minimum the four packages above.)

- [ ] **Format + lint (CI runs prettier; local lint may not).** `pnpm format:check` (or `pnpm format` then re-stage) and `pnpm lint`. Re-`git add` anything lint-staged reformats.

- [ ] **Migration drift.** If Postgres is reachable: `pnpm db:check-drift` (expect clean — both migrations are standard Prisma DDL). If not reachable, note that CI validates drift; the two `migration.sql` files are hand-matched to Prisma's mapping.

- [ ] **Branch hygiene.** `git branch --show-current` → `feat/alex-cadence-reminders`; `git status --short` clean; `git log --oneline main..HEAD` shows the cadence commit group then the reminder commit group.

- [ ] **Finish the branch.** Use **superpowers:finishing-a-development-branch** → open **one PR** to `main`, body summarizing both deltas, the fail-closed/draft-template activation gate, the live prereqs (a deployment must resolve for `conversation.reminder.send`, mirroring `conversation.followup.send`; templates flip to `approved` at Meta approval), and the documented deviations above.

## Live prerequisites (ops, post-merge — not code)

1. **Deployment resolution:** `resolveDeploymentForIntent(..., "conversation.reminder.send")` must resolve (mirrors `conversation.followup.send`). If the Alex deployment doesn't already cover new intents, seed/extend it — else reminders submit with `targetHint: undefined` (same behavior as follow-up; confirm in the deployed env).
2. **Template approval:** `appointment_reminder_{sg,my}_v1` (utility) and the cadence re-engagement template are `draft`. Until Meta approves them, sends soft-skip (`template_not_approved`); the cadence's activation taxonomy keeps leads re-evaluable, reminders simply skip (single-shot, time-critical). Already on the launch critical path.
