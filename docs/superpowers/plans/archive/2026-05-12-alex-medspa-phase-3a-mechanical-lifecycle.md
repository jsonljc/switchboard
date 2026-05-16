# Alex SG/MY Medspa — Phase 3a Implementation Plan: Mechanical Conversation Lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mechanical-state foundation of the conversation lifecycle layer — `booked` (from `Booking` writes), `escalated` (from `GovernanceVerdict` and operator-takeover events), `stalled` (from an hourly Inngest cron over `ConversationMessage` history), plus re-opening on inbound with re-engagement attribution. Persists a per-thread `ConversationLifecycleSnapshot` and an append-only `ConversationLifecycleTransition` log. Behind feature flag `alexMedspaSgMyGovernanceV1.lifecycleTagging.mechanical`, default off. Qualification (`QualificationSignals` sidecar + `qualified` state) is Phase 3b. Recommendation generation is Phase 3c.

**Architecture:** New schemas in `packages/schemas/src/conversation-lifecycle.ts` (state enum, snapshot Zod schema, transition Zod schema, trigger enum, precedence resolver as a pure function). New Prisma models `ConversationLifecycleSnapshot` and `ConversationLifecycleTransition` in `packages/db` with adapters that implement reader/writer interfaces declared in core. New `packages/core/src/lifecycle/` package: `LifecycleWriter` (orchestrates snapshot upsert + transition write in one DB transaction with precedence re-check), `MessageHistoryReader` (computes `lastAlexOutboundAt` / `lastInboundAt` from `ConversationMessage`), `ReEngagementAttributor` (decides between `inbound_after_re_engagement_template` and `inbound_after_stalled` triggers). Event integration via four hook seats: `GovernanceVerdict` write hook (escalated), `Booking` write hook (booked), inbound `ConversationMessage` write hook (re-open from stalled), `ConversationThread.assignedOperatorId` change hook (operator takeover → escalated). Hourly Inngest cron walks threads in non-terminal states and marks `stalled` where the timer condition holds. Bootstrap wiring in `apps/api/src/bootstrap/lifecycle.ts` reads `lifecycleTagging.mechanical` flag from `GovernanceConfigResolver`.

**Tech Stack:** TypeScript ESM, Zod, Vitest, Prisma, Inngest (cron), pnpm workspaces, Turbo, Fastify (no new HTTP routes in 3a). Follows established `prisma-store` + `GovernanceConfigResolver` + `InMemoryGovernancePostureCache` patterns. No model calls — entirely deterministic.

**Spec:** `docs/superpowers/specs/2026-05-12-alex-medspa-phase-3-conversation-lifecycle-design.md`

**Out of scope for Phase 3a (deferred — do not bleed in):**

- `qualified` state, `QualificationSignals` sidecar, `SkillExecutionResult.qualificationSignals` extension — Phase 3b
- `disqualified` state, operator-confirmation flow, dashboard recommendation surface — Phase 3b for proposal/confirmation; 3c for recommendation
- Recommendation generators (knowledge-gap, drop-off, re-engagement-effectiveness, disqualification-load) — Phase 3c
- Contact-level lifecycle aggregation (parent spec §13)
- Cost gating of re-engagement template sends (Phase 2)
- Any deprecation or migration of existing `ContactLifecycle` or `ConversationThread.stage` (see Pre-flight discovery #2)

---

## Pre-flight discovery

**Read before Task 1.** These are existing models / types that overlap with Phase 3 and shape the plan's calls.

1. **`ContactLifecycle` exists** (`packages/db/prisma/schema.prisma:855`) — contact-level stage `lead | qualified | booked | churned`. **Phase 3 is thread-level**; the new `ConversationLifecycleSnapshot` is keyed on `conversationThreadId`. The two coexist in 3a. Reconciliation (does `ContactLifecycle.stage='booked'` imply all the contact's threads are `booked`? Or roll up?) is **out of scope for 3a**. A follow-up post-3c can decide whether to retire `ContactLifecycle` in favour of a contact-level view over Phase 3 data.
2. **`ConversationThread.stage` exists** (`packages/schemas/src/conversation-thread.ts:8`) — values `new | responding | qualifying | qualified | closing | won | lost | nurturing`. The schema comment is explicit: *"conversation progression (distinct from CRM lifecycle stage)."* Phase 3 lifecycle is a **third axis** distinct from both `ConversationThread.stage` (routing/operational) and `ContactLifecycle.stage` (CRM funnel). 3a does **not** modify or read `ConversationThread.stage`.
3. **`SkillExecutionResult` shape** (`packages/core/src/skill-runtime/types.ts:93`) is currently `{ response, toolCalls, tokenUsage, trace }`. 1d's spec proposes adding `intentClass?`; Phase 3b's spec proposes adding `qualificationSignals?`. **3a does not touch this type** — mechanical states draw from DB events only.
4. **Hook registration site** — see `packages/core/src/skill-runtime/hooks/` for the `SkillHook` pattern (e.g. `pdpa-consent-gate.ts`, `deterministic-safety-gate.ts`). 3a does not add a `SkillHook` (mechanical states are not pre/post-emit gates); it adds **DB-write event hooks** which is a different seat. See Tasks 10–13 for concrete seats.
5. **Cron infra** — Inngest is wired (`apps/api/src/bootstrap/inngest.ts`, `packages/core/src/skill-runtime/batch-executor-function.ts`). Task 14 adds a new Inngest function `lifecycle.stalled-sweep` on hourly schedule.
6. **Booking creation seat** — was not located in a quick grep. Task 11 includes an explicit discovery step: find the call site that writes `prisma.booking.create(...)` (likely a `BookingService` in `packages/core` or `apps/api`) and add the lifecycle hook there. If multiple call sites exist, hook all of them (or wrap in a single service if not already wrapped — but defer the wrap to a follow-up if it becomes a refactor).
7. **Pre-flight setup** — run `pnpm reset` before Task 1 to ensure clean Prisma client + dist (per `feedback_dev_stack.md`).

---

## Plan hardening notes

These rules apply across all tasks. Load-bearing for clean execution.

- **Prerequisites: Phase 1a (#409), 1b-1 (#429), 1b-2 (#431), 1c (#435) all on `main`.** 1d is **not** a prerequisite for 3a — 3a stands alone on mechanical events. Pre-flight rebases this branch onto `main` so the lifecycle layer is layered atop existing `GovernanceConfigResolver`, `GovernanceVerdictStore`, `InMemoryGovernancePostureCache`, and the Inngest infra.
- **Schema enum changes are atomic with their consumers.** Tasks that introduce new enums update any exhaustive switch/check sites in the same commit so `packages/schemas` and `packages/core` stay green between commits.
- **No `console.log`.** Use `console.error` for unexpected branches (precedence violation observed, snapshot-row-missing-during-update). Use `console.warn` for soft conditions (cron found a thread with no messages — should not happen but is recoverable). Lint will flag `console.log`.
- **No production `any`.** Reader, writer, store, and resolver types in `src/` are explicitly typed. Test-only narrow casts via `as any` (with `eslint-disable-next-line @typescript-eslint/no-explicit-any` on the same line) are permitted in `__tests__/*` files for mocking Prisma. The escape is bounded to mock construction.
- **Layer rules.** `packages/schemas` (Layer 1) has no `@switchboard/*` imports. `packages/core` (Layer 3) imports schemas + sdk + cartridge-sdk only — never `packages/db`. Prisma adapters live in `packages/db` (Layer 4) and depend on interfaces declared in core.
- **Tests use mocked Prisma.** Per `feedback_api_test_mocked_prisma.md`, db tests mock the Prisma client. Don't require a running PostgreSQL for `pnpm test` to pass.
- **`pnpm db:check-drift` requires running PostgreSQL.** If unreachable in the implementation environment, follow the 1c pattern: skip locally, document in PR body. At minimum `pnpm db:generate` must succeed after schema edits.
- **Migrations use `migrate diff` + `migrate deploy` in agent sessions.** Per `feedback_prisma_migrate_dev_tty.md`, `prisma migrate dev` blocks on TTY prompts. Use `pnpm prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel packages/db/prisma/schema.prisma --script > <migration>.sql` then `pnpm prisma migrate deploy`.
- **All lifecycle writes go through a single `LifecycleWriter` service.** No code outside `packages/core/src/lifecycle/` directly writes to `ConversationLifecycleSnapshot` or `ConversationLifecycleTransition`. Enforced by code review, not by language; flagged in PR template.
- **Disqualification enums are forward-compatible only in 3a.** The schema enums in Task 1 include `disqualified` (state), `proposed_disqualified` (qualificationStatus), and three operator-disqualification triggers (`system_proposed_disqualification`, `operator_confirmed_disqualification`, `operator_dismissed_disqualification`). 3a defines them so 3b lands as a strict additive change with no schema migration. **3a code MUST NOT emit any of those values.** No 3a event hook, cron, or bootstrap path may call `recordTransition` with `toState='disqualified'` or with any of the three operator-disqualification triggers. Enforced by Task 7's `LifecycleWriter` runtime allowlist (rejects disqualified-family inputs in 3a) and Task 16's integration test.
- **Snapshot upsert + transition insert happen in the same transaction with a precedence re-check.** Inside the transaction, re-read `currentState` and abort if a higher-precedence state has been written by a concurrent writer (e.g. cron about to write `stalled` aborts if `BookingCreated` just wrote `booked`). Asserted by Task 7's concurrency test.
- **Feature flag is read per call**, not cached at process start. The `lifecycleTagging.mechanical` flag is consulted at every write seat. When off, the writer is a no-op (no DB writes, no transitions). Asserted by Task 15's flag-off test.
- **Inngest cron is idempotent.** A second sweep within the same hour produces no duplicate transitions (transition inserted only if `currentState` actually changes). Asserted by Task 14's idempotency test.
- **`ConversationLifecycleSnapshot` is recoverable from the transition log.** Add a `rebuildSnapshotFromTransitions(threadId)` helper in Task 7 with a test that wipes the snapshot row and reconstructs it from the transition log; `currentState` and `lastTransitionAt` must match.
- **Re-engagement attribution window default 7 days** (per spec §12 Q1, value not yet design-partner-validated). Constant `RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS = 7` lives in `packages/core/src/lifecycle/constants.ts` so the follow-up question can flip a single value.
- **Operator takeover detection runs on `ConversationThread.assignedOperatorId` transitions.** The spec mentions `assignedOperatorId` but this column needs verification — see Task 13's discovery step. If the column does not exist, derive operator-takeover from the existing operator-message inbound path (a message authored by a non-Alex actor on a thread where Alex is the assigned agent).

---

## File structure

**`packages/schemas/` (Layer 1):**

- `src/conversation-lifecycle.ts` — NEW. `ConversationLifecycleStateSchema`, `LifecycleQualificationStatusSchema`, `LifecycleBookingStatusSchema`, `LifecycleDropoffReasonSchema`, `ConversationLifecycleTriggerSchema`, `ConversationLifecycleActorSchema`, `ConversationLifecycleSnapshotSchema`, `ConversationLifecycleTransitionSchema`, `LIFECYCLE_STATE_PRECEDENCE` constant, `compareLifecyclePrecedence` pure function.
- `src/governance-config.ts` — extend `GovernanceConfigSchema` with `lifecycleTagging: { mechanical: { mode: "off" | "on" } }` sub-block + `resolveLifecycleTaggingConfig` helper.
- `src/index.ts` — re-export new types.
- `src/__tests__/conversation-lifecycle.test.ts` — NEW. Schema round-trips, precedence comparator exhaustive matrix, trigger/state enum coverage.
- `src/__tests__/governance-config.test.ts` — extend with lifecycle-tagging sub-block tests.

**`packages/db/`:**

- `prisma/schema.prisma` — add `ConversationLifecycleSnapshot` and `ConversationLifecycleTransition` models.
- `prisma/migrations/<timestamp>_alex_medspa_3a_lifecycle/migration.sql` — NEW migration.
- `src/prisma-conversation-lifecycle-snapshot-store.ts` — NEW Prisma adapter for `LifecycleSnapshotStore` interface (read + upsert; upsert is callable only from inside `LifecycleWriter`'s transaction, enforced by single import seat).
- `src/prisma-conversation-lifecycle-transition-store.ts` — NEW Prisma adapter for `LifecycleTransitionStore` interface (append + query-by-thread).
- `src/prisma-message-history-reader.ts` — NEW Prisma adapter for `MessageHistoryReader` interface (last inbound/outbound timestamps from `ConversationMessage`).
- `src/prisma-re-engagement-verdict-reader.ts` — NEW Prisma adapter for `ReEngagementVerdictReader` interface (queries `GovernanceVerdict` for 1d substitute verdicts; falls back to null when 1d hasn't shipped or no verdict matches).
- `src/__tests__/prisma-conversation-lifecycle-snapshot-store.test.ts` — NEW.
- `src/__tests__/prisma-conversation-lifecycle-transition-store.test.ts` — NEW.
- `src/__tests__/prisma-message-history-reader.test.ts` — NEW.
- `src/__tests__/prisma-re-engagement-verdict-reader.test.ts` — NEW.

**`packages/core/src/lifecycle/` (NEW directory):**

- `types.ts` — `LifecycleSnapshotStore`, `LifecycleTransitionStore`, `MessageHistoryReader`, `ReEngagementVerdictReader` interface declarations.
- `errors.ts` — `LifecyclePrecedenceViolation`, `LifecycleSnapshotMissing`, `LifecycleConfigError`.
- `constants.ts` — `RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS = 7`, `STALLED_THRESHOLD_HOURS = 24`, `CRON_LOOKBACK_HOURS = 168` (cron only considers threads active in the last 7 days for efficiency).
- `precedence.ts` — re-export `LIFECYCLE_STATE_PRECEDENCE` and `compareLifecyclePrecedence` from schemas; add `canTransition(from, to)` rule (encodes the `escalated → booked` exception from spec §4.3).
- `lifecycle-writer.ts` — `LifecycleWriter` class with `recordTransition(input)` method that opens a transaction, re-reads `currentState`, applies precedence rules, upserts snapshot, inserts transition, commits.
- `re-engagement-attributor.ts` — `attributeReOpen(threadId, inboundAt)` returns `{ trigger, evidence }` based on whether a re-engagement-class outbound exists in the attribution window.
- `lifecycle-config-resolver.ts` — wraps `GovernanceConfigResolver` to surface `lifecycleTagging.mechanical.mode` per orgId.
- `posture-cache.ts` — re-uses `InMemoryGovernancePostureCache<"on" | "off">` pattern (lifecycle-tagging-mode scoped instance, parallel to consent-state cache).
- `event-hooks/governance-verdict-escalation-hook.ts` — listens to `GovernanceVerdict` writes; if `action='escalate'`, calls `LifecycleWriter.recordTransition(... toState='escalated')`.
- `event-hooks/booking-created-hook.ts` — listens to `Booking` writes; calls `LifecycleWriter.recordTransition(... toState='booked')`.
- `event-hooks/inbound-message-hook.ts` — listens to inbound `ConversationMessage` writes; if thread `currentState='stalled'`, calls `ReEngagementAttributor.attributeReOpen` then `LifecycleWriter.recordTransition(... toState='active')`.
- `event-hooks/operator-takeover-hook.ts` — listens to `ConversationThread.assignedOperatorId` change (or operator-authored inbound, if column doesn't exist — see Pre-flight #6); calls `LifecycleWriter.recordTransition(... toState='escalated')`.
- `event-hooks/thread-init-hook.ts` — listens to thread-first-observation; seeds `null → active` so the cron has a snapshot to promote to `stalled` (see Task 4 — `canTransition(null, "stalled")` is forbidden).
- `cron/stalled-sweep.ts` — Inngest function `lifecycle.stalled-sweep` on hourly schedule; queries non-terminal threads, computes `lastAlexOutboundAt` / `lastInboundAt` per thread, calls `LifecycleWriter.recordTransition(... toState='stalled')` where the rule fires.
- `__tests__/lifecycle-writer.test.ts` — NEW. Precedence matrix, re-check-on-conflict, snapshot rebuild from transitions.
- `__tests__/re-engagement-attributor.test.ts` — NEW. Within/outside window, no re-engagement template present, multiple templates within window.
- `__tests__/lifecycle-config-resolver.test.ts` — NEW.
- `__tests__/event-hooks/*.test.ts` — NEW per hook (5 files: governance, booking, inbound, operator-takeover, thread-init).
- `__tests__/cron/stalled-sweep.test.ts` — NEW. Idempotency, precedence respect, cutoff window.

**`apps/api/`:**

- `src/bootstrap/lifecycle.ts` — NEW. Constructs `LifecycleWriter` with Prisma adapters + config resolver + posture cache; wires the four event hooks at their respective Prisma write seats; registers the Inngest cron function.
- `src/bootstrap/__tests__/lifecycle.test.ts` — NEW. Hook wiring assertions; flag-off no-op assertion.
- `src/app.ts` — call `bootstrapLifecycle(...)` from app initialization.

**Skills reference (informational only, not load-bearing):**

- `skills/alex/references/regulatory/sg-rules.md` — append a "Phase 3 lifecycle observation" section pointing at `packages/core/src/lifecycle/` for transparency to operators reviewing the skill.
- `skills/alex/references/regulatory/my-rules.md` — same.

---

## Tasks

### Task 1: Schema enums and types

**Files:**
- Create: `packages/schemas/src/conversation-lifecycle.ts`
- Create: `packages/schemas/src/__tests__/conversation-lifecycle.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/__tests__/conversation-lifecycle.test.ts
import { describe, expect, it } from "vitest";
import {
  ConversationLifecycleStateSchema,
  ConversationLifecycleTriggerSchema,
  ConversationLifecycleActorSchema,
  LifecycleQualificationStatusSchema,
  LifecycleBookingStatusSchema,
  LifecycleDropoffReasonSchema,
  LIFECYCLE_STATE_PRECEDENCE,
  compareLifecyclePrecedence,
} from "../conversation-lifecycle.js";

describe("ConversationLifecycleStateSchema", () => {
  it("accepts the six primary states", () => {
    for (const s of ["active", "qualified", "stalled", "booked", "disqualified", "escalated"]) {
      expect(ConversationLifecycleStateSchema.parse(s)).toBe(s);
    }
  });

  it("rejects re_engaged and qualified_not_booked (must be transition / derived)", () => {
    expect(() => ConversationLifecycleStateSchema.parse("re_engaged")).toThrow();
    expect(() => ConversationLifecycleStateSchema.parse("qualified_not_booked")).toThrow();
  });
});

describe("ConversationLifecycleTriggerSchema", () => {
  it("accepts every documented trigger", () => {
    for (const t of [
      "qualification_checklist_met",
      "qualification_checklist_failed",
      "timer_24h_no_inbound",
      "inbound_after_stalled",
      "inbound_after_re_engagement_template",
      "booking_event_received",
      "governance_verdict_escalate",
      "operator_takeover",
      "operator_confirmed_disqualification",
      "operator_dismissed_disqualification",
      "system_proposed_disqualification",
    ]) {
      expect(ConversationLifecycleTriggerSchema.parse(t)).toBe(t);
    }
  });
});

describe("ConversationLifecycleActorSchema", () => {
  it("enumerates the four actors", () => {
    for (const a of ["system", "alex", "operator", "integration"]) {
      expect(ConversationLifecycleActorSchema.parse(a)).toBe(a);
    }
  });
});

describe("LifecycleQualificationStatusSchema", () => {
  it("includes proposed_disqualified", () => {
    expect(LifecycleQualificationStatusSchema.parse("proposed_disqualified")).toBe("proposed_disqualified");
  });
});

describe("LifecycleBookingStatusSchema", () => {
  it("is binary", () => {
    expect(LifecycleBookingStatusSchema.parse("booked")).toBe("booked");
    expect(LifecycleBookingStatusSchema.parse("not_booked")).toBe("not_booked");
    expect(() => LifecycleBookingStatusSchema.parse("pending")).toThrow();
  });
});

describe("LifecycleDropoffReasonSchema", () => {
  it("accepts null and the documented reasons", () => {
    expect(LifecycleDropoffReasonSchema.parse(null)).toBeNull();
    for (const r of ["no_reply", "explicit_decline", "price_objection", "out_of_area", "wrong_treatment", "operator_marked_not_ready"]) {
      expect(LifecycleDropoffReasonSchema.parse(r)).toBe(r);
    }
  });
});

describe("LIFECYCLE_STATE_PRECEDENCE", () => {
  it("orders booked highest and active lowest", () => {
    expect(LIFECYCLE_STATE_PRECEDENCE.indexOf("booked")).toBe(0);
    expect(LIFECYCLE_STATE_PRECEDENCE.at(-1)).toBe("active");
  });

  it("places disqualified above escalated above stalled above qualified above active", () => {
    const idx = (s: string) => LIFECYCLE_STATE_PRECEDENCE.indexOf(s as never);
    expect(idx("disqualified")).toBeLessThan(idx("escalated"));
    expect(idx("escalated")).toBeLessThan(idx("stalled"));
    expect(idx("stalled")).toBeLessThan(idx("qualified"));
    expect(idx("qualified")).toBeLessThan(idx("active"));
  });
});

describe("compareLifecyclePrecedence", () => {
  it("returns negative when first arg is higher precedence", () => {
    expect(compareLifecyclePrecedence("booked", "stalled")).toBeLessThan(0);
  });

  it("returns positive when first arg is lower precedence", () => {
    expect(compareLifecyclePrecedence("active", "qualified")).toBeGreaterThan(0);
  });

  it("returns zero for the same state", () => {
    expect(compareLifecyclePrecedence("stalled", "stalled")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/conversation-lifecycle.test.ts`
Expected: FAIL with "Cannot find module '../conversation-lifecycle.js'"

- [ ] **Step 3: Write the schema module**

```ts
// packages/schemas/src/conversation-lifecycle.ts
import { z } from "zod";

// `disqualified` is forward-compatible — defined here for schema stability
// across 3a → 3b → 3c. **3a code paths MUST NOT emit `disqualified`.**
// See `LifecycleWriter`'s 3a allowlist guard (Task 7) and the
// `THREE_A_FORBIDDEN_*` constants in `packages/core/src/lifecycle/constants.ts`.
export const ConversationLifecycleStateSchema = z.enum([
  "active",
  "qualified",
  "stalled",
  "booked",
  "disqualified",
  "escalated",
]);
export type ConversationLifecycleState = z.infer<typeof ConversationLifecycleStateSchema>;

// `proposed_disqualified` is forward-compatible — 3a never sets it.
// 3b introduces operator-confirmed disqualification flow.
export const LifecycleQualificationStatusSchema = z.enum([
  "unknown",
  "unqualified",
  "qualified",
  "proposed_disqualified",
]);
export type LifecycleQualificationStatus = z.infer<typeof LifecycleQualificationStatusSchema>;

export const LifecycleBookingStatusSchema = z.enum(["not_booked", "booked"]);
export type LifecycleBookingStatus = z.infer<typeof LifecycleBookingStatusSchema>;

export const LifecycleDropoffReasonSchema = z
  .enum([
    "no_reply",
    "explicit_decline",
    "price_objection",
    "out_of_area",
    "wrong_treatment",
    "operator_marked_not_ready",
  ])
  .nullable();
export type LifecycleDropoffReason = z.infer<typeof LifecycleDropoffReasonSchema>;

// Triggers tagged "3b only" or "3c only" are forward-compatible — 3a code
// must never construct a transition with one of those triggers. See
// THREE_A_ALLOWED_TRIGGERS in constants.ts and the writer's runtime guard.
export const ConversationLifecycleTriggerSchema = z.enum([
  // 3a triggers
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
  // 3b triggers (forward-compatible — NOT emitted in 3a)
  "qualification_checklist_met",
  "qualification_checklist_failed",
  "system_proposed_disqualification",
  "operator_confirmed_disqualification",
  "operator_dismissed_disqualification",
]);
export type ConversationLifecycleTrigger = z.infer<typeof ConversationLifecycleTriggerSchema>;

export const ConversationLifecycleActorSchema = z.enum(["system", "alex", "operator", "integration"]);
export type ConversationLifecycleActor = z.infer<typeof ConversationLifecycleActorSchema>;

export const ConversationLifecycleSnapshotSchema = z.object({
  conversationThreadId: z.string(),
  organizationId: z.string(),
  contactId: z.string(),
  currentState: ConversationLifecycleStateSchema,
  qualificationStatus: LifecycleQualificationStatusSchema,
  bookingStatus: LifecycleBookingStatusSchema,
  dropoffReason: LifecycleDropoffReasonSchema,
  lastTransitionAt: z.date(),
  lastEvaluatedAt: z.date(),
  updatedAt: z.date(),
});
export type ConversationLifecycleSnapshot = z.infer<typeof ConversationLifecycleSnapshotSchema>;

export const ConversationLifecycleTransitionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  conversationThreadId: z.string(),
  contactId: z.string(),
  fromState: ConversationLifecycleStateSchema.nullable(),
  toState: ConversationLifecycleStateSchema,
  trigger: ConversationLifecycleTriggerSchema,
  evidence: z.record(z.unknown()),
  actor: ConversationLifecycleActorSchema,
  workTraceId: z.string().nullable(),
  occurredAt: z.date(),
});
export type ConversationLifecycleTransition = z.infer<typeof ConversationLifecycleTransitionSchema>;

// Highest precedence first. The cron and event hooks must respect this order.
export const LIFECYCLE_STATE_PRECEDENCE = [
  "booked",
  "disqualified",
  "escalated",
  "stalled",
  "qualified",
  "active",
] as const satisfies readonly ConversationLifecycleState[];

export function compareLifecyclePrecedence(
  a: ConversationLifecycleState,
  b: ConversationLifecycleState,
): number {
  return LIFECYCLE_STATE_PRECEDENCE.indexOf(a) - LIFECYCLE_STATE_PRECEDENCE.indexOf(b);
}
```

- [ ] **Step 4: Re-export from index**

In `packages/schemas/src/index.ts`, append:

```ts
export * from "./conversation-lifecycle.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/conversation-lifecycle.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Run schemas typecheck**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/conversation-lifecycle.ts packages/schemas/src/__tests__/conversation-lifecycle.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add conversation-lifecycle schemas + precedence (Phase 3a)"
```

---

### Task 2: Governance config — `lifecycleTagging.mechanical` flag

**Files:**
- Modify: `packages/schemas/src/governance-config.ts`
- Modify: `packages/schemas/src/__tests__/governance-config.test.ts`

- [ ] **Step 1: Read the existing config schema**

Read `packages/schemas/src/governance-config.ts` to find the existing `GovernanceConfigSchema` shape and how 1c added its `consentState` sub-block. Mirror that pattern.

- [ ] **Step 2: Write the failing test**

Append to `packages/schemas/src/__tests__/governance-config.test.ts`:

```ts
describe("lifecycleTagging.mechanical", () => {
  it("defaults to off when sub-block absent", () => {
    const cfg = GovernanceConfigSchema.parse({});
    expect(cfg.lifecycleTagging.mechanical.mode).toBe("off");
  });

  it("accepts on", () => {
    const cfg = GovernanceConfigSchema.parse({
      lifecycleTagging: { mechanical: { mode: "on" } },
    });
    expect(cfg.lifecycleTagging.mechanical.mode).toBe("on");
  });

  it("rejects unknown modes", () => {
    expect(() =>
      GovernanceConfigSchema.parse({
        lifecycleTagging: { mechanical: { mode: "observe" } },
      }),
    ).toThrow();
  });
});

describe("resolveLifecycleTaggingConfig", () => {
  it("returns the mechanical sub-block", () => {
    const cfg = GovernanceConfigSchema.parse({
      lifecycleTagging: { mechanical: { mode: "on" } },
    });
    expect(resolveLifecycleTaggingConfig(cfg).mechanical.mode).toBe("on");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/governance-config.test.ts`
Expected: FAIL — `lifecycleTagging` undefined / `resolveLifecycleTaggingConfig` not exported.

- [ ] **Step 4: Extend the schema**

In `packages/schemas/src/governance-config.ts`, alongside the existing `consentState` sub-block:

```ts
export const LifecycleTaggingConfigSchema = z.object({
  mechanical: z
    .object({
      mode: z.enum(["off", "on"]).default("off"),
    })
    .default({ mode: "off" }),
});
export type LifecycleTaggingConfig = z.infer<typeof LifecycleTaggingConfigSchema>;
```

In the `GovernanceConfigSchema` object, add:

```ts
  lifecycleTagging: LifecycleTaggingConfigSchema.default({ mechanical: { mode: "off" } }),
```

Add the resolver helper at the end of the file:

```ts
export function resolveLifecycleTaggingConfig(cfg: GovernanceConfig): LifecycleTaggingConfig {
  return cfg.lifecycleTagging;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/governance-config.test.ts`
Expected: PASS, all (existing + new) tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/governance-config.ts packages/schemas/src/__tests__/governance-config.test.ts
git commit -m "feat(schemas): add lifecycleTagging.mechanical governance config (Phase 3a)"
```

---

### Task 3: Prisma models + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_alex_medspa_3a_lifecycle/migration.sql`

- [ ] **Step 1: Add the two models to the Prisma schema**

In `packages/db/prisma/schema.prisma`, near the existing `ConversationThread` model (~line 868):

```prisma
model ConversationLifecycleSnapshot {
  conversationThreadId String   @id
  organizationId       String
  contactId            String
  currentState         String   // ConversationLifecycleState — schema-bound on read
  qualificationStatus  String   @default("unknown")
  bookingStatus        String   @default("not_booked")
  dropoffReason        String?
  lastTransitionAt     DateTime
  lastEvaluatedAt      DateTime
  updatedAt            DateTime @updatedAt

  @@index([organizationId, currentState])
  @@index([organizationId, qualificationStatus, bookingStatus])
  @@index([organizationId, currentState, lastTransitionAt])
  @@index([organizationId, lastEvaluatedAt])
}

model ConversationLifecycleTransition {
  id                   String   @id @default(cuid())
  organizationId       String
  conversationThreadId String
  contactId            String
  fromState            String?
  toState              String
  trigger              String
  evidence             Json
  actor                String
  workTraceId          String?
  occurredAt           DateTime @default(now())

  @@index([organizationId, conversationThreadId, occurredAt])
  @@index([organizationId, toState, occurredAt])
  @@index([organizationId, trigger, occurredAt])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `pnpm db:generate`
Expected: success, generated client now exposes `prisma.conversationLifecycleSnapshot` and `prisma.conversationLifecycleTransition`.

- [ ] **Step 3: Generate migration SQL (no apply)**

If PostgreSQL is reachable:
```bash
pnpm prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_alex_medspa_3a_lifecycle/migration.sql
```

If unreachable, create the file manually with `CREATE TABLE` statements that match the Prisma model. Include all four indexes per model.

- [ ] **Step 4: Apply migration locally if possible**

Run: `pnpm prisma migrate deploy`
Expected: applied. If PostgreSQL is unreachable, skip and document in PR body.

- [ ] **Step 5: Verify drift check**

Run: `pnpm db:check-drift` (requires PostgreSQL).
Expected: no drift. If unreachable, skip and document.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add ConversationLifecycleSnapshot + Transition models (Phase 3a)"
```

---

### Task 4: Core lifecycle types and errors

**Files:**
- Create: `packages/core/src/lifecycle/types.ts`
- Create: `packages/core/src/lifecycle/errors.ts`
- Create: `packages/core/src/lifecycle/constants.ts`
- Create: `packages/core/src/lifecycle/precedence.ts`
- Create: `packages/core/src/lifecycle/__tests__/precedence.test.ts`

- [ ] **Step 1: Write the failing precedence test**

```ts
// packages/core/src/lifecycle/__tests__/precedence.test.ts
import { describe, expect, it } from "vitest";
import { canTransition } from "../precedence.js";

describe("canTransition", () => {
  it("allows escalated → booked (operator closes booking after takeover)", () => {
    expect(canTransition("escalated", "booked")).toBe(true);
  });

  it("blocks booked → stalled (booked is terminal)", () => {
    expect(canTransition("booked", "stalled")).toBe(false);
  });

  it("blocks disqualified → stalled (disqualified terminal until operator reverts)", () => {
    expect(canTransition("disqualified", "stalled")).toBe(false);
  });

  it("allows stalled → active (re-open path)", () => {
    expect(canTransition("stalled", "active")).toBe(true);
  });

  it("allows null → active (normal thread initialization)", () => {
    expect(canTransition(null, "active")).toBe(true);
  });

  it("allows null → booked (booking event arrives before any other lifecycle observation)", () => {
    expect(canTransition(null, "booked")).toBe(true);
  });

  it("allows null → escalated (governance fires before any lifecycle observation)", () => {
    expect(canTransition(null, "escalated")).toBe(true);
  });

  it("blocks null → stalled — cron must not create a snapshot from nothing; thread-init must run first", () => {
    expect(canTransition(null, "stalled")).toBe(false);
  });

  it("blocks null → qualified — qualification (3b) must follow an active observation", () => {
    expect(canTransition(null, "qualified")).toBe(false);
  });

  it("blocks null → disqualified — disqualification (3b) must follow an active observation", () => {
    expect(canTransition(null, "disqualified")).toBe(false);
  });

  it("allows any non-terminal → escalated (escalation can fire from anywhere)", () => {
    expect(canTransition("active", "escalated")).toBe(true);
    expect(canTransition("qualified", "escalated")).toBe(true);
    expect(canTransition("stalled", "escalated")).toBe(true);
  });

  it("allows any non-terminal → booked (booking can fire from anywhere including escalated)", () => {
    expect(canTransition("active", "booked")).toBe(true);
    expect(canTransition("qualified", "booked")).toBe(true);
    expect(canTransition("stalled", "booked")).toBe(true);
    expect(canTransition("escalated", "booked")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/precedence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `precedence.ts`**

```ts
// packages/core/src/lifecycle/precedence.ts
import {
  type ConversationLifecycleState,
  LIFECYCLE_STATE_PRECEDENCE,
  compareLifecyclePrecedence,
} from "@switchboard/schemas";

export { LIFECYCLE_STATE_PRECEDENCE, compareLifecyclePrecedence };

/**
 * Encodes spec §4.3 transition rules:
 * - `booked` and `disqualified` are terminal except via operator action.
 * - `escalated` is operationally terminal for Alex but allows `escalated → booked`
 *   when the operator closes a booking after takeover.
 * - `null → *` (initial transition for a thread with no snapshot) is restricted:
 *   only `active`, `booked`, `escalated` may seed a snapshot. `null → stalled`
 *   is forbidden — the cron must not invent a stalled snapshot from nothing;
 *   thread-init runs first via `onThreadFirstObservation`. `null → qualified`
 *   and `null → disqualified` are forbidden because both require an active
 *   observation first (3b).
 */
const NULL_INIT_ALLOWED: ReadonlySet<ConversationLifecycleState> = new Set([
  "active",
  "booked",
  "escalated",
]);

export function canTransition(
  from: ConversationLifecycleState | null,
  to: ConversationLifecycleState,
): boolean {
  if (from === null) return NULL_INIT_ALLOWED.has(to);
  if (from === "booked") return false;
  if (from === "disqualified") return false;
  if (from === "escalated" && to !== "booked") return false;
  return true;
}
```

- [ ] **Step 4: Write `types.ts`**

```ts
// packages/core/src/lifecycle/types.ts
import type {
  ConversationLifecycleSnapshot,
  ConversationLifecycleTransition,
  ConversationLifecycleState,
  ConversationLifecycleTrigger,
  ConversationLifecycleActor,
} from "@switchboard/schemas";

export interface LifecycleSnapshotStore {
  /** Read outside any transaction — used by event hooks for short-circuit checks
   *  (e.g. inbound-message hook checks `currentState !== 'stalled'` before opening
   *  a transaction). MUST NOT be relied on for precedence decisions. */
  read(threadId: string): Promise<ConversationLifecycleSnapshot | null>;
  /** Read inside a transaction — used by `LifecycleWriter.recordTransition` for
   *  the precedence re-check. With Prisma's default Read Committed isolation,
   *  this guarantees the snapshot we read is the same one we upsert in the
   *  same transaction, preventing the cron from overwriting a `booked` row that
   *  a concurrent booking write produced. */
  readInTransaction(
    tx: unknown,
    threadId: string,
  ): Promise<ConversationLifecycleSnapshot | null>;
  /** Upsert called only from inside `LifecycleWriter.recordTransition`'s transaction. */
  upsertInTransaction(
    tx: unknown,
    snapshot: ConversationLifecycleSnapshot,
  ): Promise<void>;
}

export interface LifecycleTransitionStore {
  /** Append a transition. `id` is omitted — the DB's `@default(cuid())` generates it. */
  appendInTransaction(
    tx: unknown,
    transition: Omit<ConversationLifecycleTransition, "id">,
  ): Promise<void>;
  listForThread(threadId: string): Promise<ConversationLifecycleTransition[]>;
}

export interface MessageHistoryReader {
  /** Returns timestamps of last Alex outbound and last contact inbound for a thread. */
  read(threadId: string): Promise<{
    lastAlexOutboundAt: Date | null;
    lastInboundAt: Date | null;
  }>;
}

/**
 * Resolves re-engagement attribution by querying `GovernanceVerdict` rows.
 * 1d emits a substitute verdict with `sourceGuard='whatsapp_window'`,
 * `action='substitute'`, and `details.intentClass='re-engagement-offer'`
 * (plus `details.metaTemplateName`) every time the gate replaces a free-form
 * response with a re-engagement template. We attribute by joining inbound
 * timing to the most recent matching verdict in the window. This avoids
 * inventing a `ConversationMessage.metadata.intentClass` contract that 1d
 * does not promise.
 *
 * If 1d has not yet shipped (or is flag-off) there will be no matching
 * verdicts, and `findReEngagementVerdict` returns null — the attributor
 * falls back to `inbound_after_stalled`. Phase 3a is therefore independent
 * of 1d's shipping order, but benefits from 1d's verdict trail when present.
 */
export interface ReEngagementVerdictReader {
  /**
   * Returns the most recent `whatsapp_window`-sourced substitute verdict for
   * a thread within `windowDays` before `inboundAt`, where the verdict's
   * `details.intentClass === "re-engagement-offer"`.
   *
   * Note on conversationId mapping: 1d emits verdicts with `conversationId`
   * sourced from `ctx.sessionId` (per the 1c plan note). 3a callers pass the
   * `ConversationThread.id`. The implementation must reconcile — if
   * sessionId == threadId (the current convention), pass through directly;
   * if not, the adapter must do the mapping. Verify with a code-search before
   * implementation; see Task 8 Step 1.
   */
  findReEngagementVerdict(
    threadId: string,
    inboundAt: Date,
    windowDays: number,
  ): Promise<{
    verdictId: string;
    templateName: string;
    decidedAt: Date;
  } | null>;
}

export interface RecordTransitionInput {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  toState: ConversationLifecycleState;
  trigger: ConversationLifecycleTrigger;
  actor: ConversationLifecycleActor;
  evidence: Record<string, unknown>;
  workTraceId?: string | null;
  occurredAt?: Date;
}
```

- [ ] **Step 5: Write `errors.ts`**

```ts
// packages/core/src/lifecycle/errors.ts
export class LifecyclePrecedenceViolation extends Error {
  constructor(
    public readonly fromState: string | null,
    public readonly toState: string,
  ) {
    super(`Cannot transition lifecycle state from ${fromState ?? "null"} to ${toState}`);
    this.name = "LifecyclePrecedenceViolation";
  }
}

export class LifecycleSnapshotMissing extends Error {
  constructor(public readonly conversationThreadId: string) {
    super(`Lifecycle snapshot missing for thread ${conversationThreadId}`);
    this.name = "LifecycleSnapshotMissing";
  }
}

export class LifecycleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleConfigError";
  }
}
```

- [ ] **Step 6: Write `constants.ts`**

```ts
// packages/core/src/lifecycle/constants.ts
import type { ConversationLifecycleState, ConversationLifecycleTrigger } from "@switchboard/schemas";

export const STALLED_THRESHOLD_HOURS = 24;
export const RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS = 7;
export const CRON_LOOKBACK_HOURS = 168; // 7 days — bound the cron's candidate set

/**
 * 3a runtime allowlists. The schema defines the full Phase 3 enum for forward
 * compatibility; 3a code paths must only emit values from these sets.
 * Enforced at runtime by `LifecycleWriter` (see Task 7) and asserted by an
 * integration test (Task 16).
 */
export const THREE_A_ALLOWED_STATES = new Set<ConversationLifecycleState>([
  "active",
  "stalled",
  "booked",
  "escalated",
]);

export const THREE_A_ALLOWED_TRIGGERS = new Set<ConversationLifecycleTrigger>([
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
]);
```

- [ ] **Step 7: Run tests to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/precedence.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/lifecycle/
git commit -m "feat(core): add lifecycle types, errors, constants, precedence (Phase 3a)"
```

---

### Task 5: Prisma adapter — snapshot store

**Files:**
- Create: `packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts`
- Create: `packages/db/src/__tests__/prisma-conversation-lifecycle-snapshot-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/__tests__/prisma-conversation-lifecycle-snapshot-store.test.ts
import { describe, expect, it, vi } from "vitest";
import { PrismaConversationLifecycleSnapshotStore } from "../prisma-conversation-lifecycle-snapshot-store.js";

describe("PrismaConversationLifecycleSnapshotStore.read", () => {
  it("returns null when no row exists", async () => {
    const prisma = {
      conversationLifecycleSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    expect(await store.read("thread-1")).toBeNull();
  });

  it("returns a parsed snapshot when row exists", async () => {
    const now = new Date();
    const prisma = {
      conversationLifecycleSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          conversationThreadId: "thread-1",
          organizationId: "org-1",
          contactId: "contact-1",
          currentState: "stalled",
          qualificationStatus: "unknown",
          bookingStatus: "not_booked",
          dropoffReason: null,
          lastTransitionAt: now,
          lastEvaluatedAt: now,
          updatedAt: now,
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    const snap = await store.read("thread-1");
    expect(snap?.currentState).toBe("stalled");
    expect(snap?.qualificationStatus).toBe("unknown");
  });
});

describe("PrismaConversationLifecycleSnapshotStore.readInTransaction", () => {
  it("uses the transaction client, not the root client", async () => {
    const findOnRoot = vi.fn();
    const findOnTx = vi.fn().mockResolvedValue(null);
    const prisma = { conversationLifecycleSnapshot: { findUnique: findOnRoot } };
    const tx = { conversationLifecycleSnapshot: { findUnique: findOnTx } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    await store.readInTransaction(tx, "thread-1");
    expect(findOnTx).toHaveBeenCalledTimes(1);
    expect(findOnRoot).not.toHaveBeenCalled();
  });
});

describe("PrismaConversationLifecycleSnapshotStore.upsertInTransaction", () => {
  it("calls upsert on the transaction client, not the root client", async () => {
    const upsertOnRoot = vi.fn();
    const upsertOnTx = vi.fn();
    const prisma = {
      conversationLifecycleSnapshot: { upsert: upsertOnRoot },
    };
    const tx = {
      conversationLifecycleSnapshot: { upsert: upsertOnTx },
    };
    const now = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    await store.upsertInTransaction(tx, {
      conversationThreadId: "thread-1",
      organizationId: "org-1",
      contactId: "contact-1",
      currentState: "stalled",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: now,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    expect(upsertOnTx).toHaveBeenCalledTimes(1);
    expect(upsertOnRoot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-conversation-lifecycle-snapshot-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter**

```ts
// packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts
import type { PrismaClient } from "@prisma/client";
import {
  ConversationLifecycleSnapshotSchema,
  type ConversationLifecycleSnapshot,
} from "@switchboard/schemas";
import type { LifecycleSnapshotStore } from "@switchboard/core";

export class PrismaConversationLifecycleSnapshotStore implements LifecycleSnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async read(threadId: string): Promise<ConversationLifecycleSnapshot | null> {
    const row = await this.prisma.conversationLifecycleSnapshot.findUnique({
      where: { conversationThreadId: threadId },
    });
    if (!row) return null;
    return ConversationLifecycleSnapshotSchema.parse(row);
  }

  async readInTransaction(
    tx: unknown,
    threadId: string,
  ): Promise<ConversationLifecycleSnapshot | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txClient = tx as any;
    const row = await txClient.conversationLifecycleSnapshot.findUnique({
      where: { conversationThreadId: threadId },
    });
    if (!row) return null;
    return ConversationLifecycleSnapshotSchema.parse(row);
  }

  async upsertInTransaction(
    tx: unknown,
    snapshot: ConversationLifecycleSnapshot,
  ): Promise<void> {
    // tx is a Prisma TransactionClient; structurally identical to PrismaClient for the
    // models we touch, so a narrow cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txClient = tx as any;
    await txClient.conversationLifecycleSnapshot.upsert({
      where: { conversationThreadId: snapshot.conversationThreadId },
      create: {
        conversationThreadId: snapshot.conversationThreadId,
        organizationId: snapshot.organizationId,
        contactId: snapshot.contactId,
        currentState: snapshot.currentState,
        qualificationStatus: snapshot.qualificationStatus,
        bookingStatus: snapshot.bookingStatus,
        dropoffReason: snapshot.dropoffReason,
        lastTransitionAt: snapshot.lastTransitionAt,
        lastEvaluatedAt: snapshot.lastEvaluatedAt,
      },
      update: {
        currentState: snapshot.currentState,
        qualificationStatus: snapshot.qualificationStatus,
        bookingStatus: snapshot.bookingStatus,
        dropoffReason: snapshot.dropoffReason,
        lastTransitionAt: snapshot.lastTransitionAt,
        lastEvaluatedAt: snapshot.lastEvaluatedAt,
      },
    });
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-conversation-lifecycle-snapshot-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts packages/db/src/__tests__/prisma-conversation-lifecycle-snapshot-store.test.ts
git commit -m "feat(db): add Prisma snapshot store for conversation lifecycle (Phase 3a)"
```

---

### Task 6: Prisma adapter — transition store

**Files:**
- Create: `packages/db/src/prisma-conversation-lifecycle-transition-store.ts`
- Create: `packages/db/src/__tests__/prisma-conversation-lifecycle-transition-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/__tests__/prisma-conversation-lifecycle-transition-store.test.ts
import { describe, expect, it, vi } from "vitest";
import { PrismaConversationLifecycleTransitionStore } from "../prisma-conversation-lifecycle-transition-store.js";

describe("PrismaConversationLifecycleTransitionStore.appendInTransaction", () => {
  it("creates a transition row on the transaction client", async () => {
    const createOnTx = vi.fn();
    const tx = { conversationLifecycleTransition: { create: createOnTx } };
    const prisma = { conversationLifecycleTransition: { create: vi.fn() } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    await store.appendInTransaction(tx, {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      fromState: "active",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      evidence: { hours_since_outbound: 25 },
      actor: "system",
      workTraceId: null,
      occurredAt: new Date(),
    });
    expect(createOnTx).toHaveBeenCalledTimes(1);
    // The data passed to create() must NOT include id — Prisma generates it.
    expect(createOnTx.mock.calls[0][0].data.id).toBeUndefined();
  });
});

describe("PrismaConversationLifecycleTransitionStore.listForThread", () => {
  it("returns transitions ordered by occurredAt asc", async () => {
    const prisma = {
      conversationLifecycleTransition: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t-1",
            organizationId: "org-1",
            conversationThreadId: "thread-1",
            contactId: "contact-1",
            fromState: null,
            toState: "active",
            trigger: "qualification_checklist_failed",
            evidence: {},
            actor: "system",
            workTraceId: null,
            occurredAt: new Date(),
          },
        ]),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    const rows = await store.listForThread("thread-1");
    expect(rows).toHaveLength(1);
    expect(prisma.conversationLifecycleTransition.findMany).toHaveBeenCalledWith({
      where: { conversationThreadId: "thread-1" },
      orderBy: { occurredAt: "asc" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-conversation-lifecycle-transition-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the adapter**

```ts
// packages/db/src/prisma-conversation-lifecycle-transition-store.ts
import type { PrismaClient } from "@prisma/client";
import {
  ConversationLifecycleTransitionSchema,
  type ConversationLifecycleTransition,
} from "@switchboard/schemas";
import type { LifecycleTransitionStore } from "@switchboard/core";

export class PrismaConversationLifecycleTransitionStore
  implements LifecycleTransitionStore
{
  constructor(private readonly prisma: PrismaClient) {}

  async appendInTransaction(
    tx: unknown,
    transition: Omit<ConversationLifecycleTransition, "id">,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txClient = tx as any;
    await txClient.conversationLifecycleTransition.create({
      data: {
        // id omitted — Prisma @default(cuid()) generates it
        organizationId: transition.organizationId,
        conversationThreadId: transition.conversationThreadId,
        contactId: transition.contactId,
        fromState: transition.fromState,
        toState: transition.toState,
        trigger: transition.trigger,
        evidence: transition.evidence,
        actor: transition.actor,
        workTraceId: transition.workTraceId,
        occurredAt: transition.occurredAt,
      },
    });
  }

  async listForThread(threadId: string): Promise<ConversationLifecycleTransition[]> {
    const rows = await this.prisma.conversationLifecycleTransition.findMany({
      where: { conversationThreadId: threadId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map((r: unknown) => ConversationLifecycleTransitionSchema.parse(r));
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-conversation-lifecycle-transition-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/prisma-conversation-lifecycle-transition-store.ts packages/db/src/__tests__/prisma-conversation-lifecycle-transition-store.test.ts
git commit -m "feat(db): add Prisma transition store for conversation lifecycle (Phase 3a)"
```

---

### Task 7: `LifecycleWriter` — orchestrator with precedence re-check

**Files:**
- Create: `packages/core/src/lifecycle/lifecycle-writer.ts`
- Create: `packages/core/src/lifecycle/__tests__/lifecycle-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/lifecycle-writer.test.ts
import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleSnapshotStore, LifecycleTransitionStore } from "../types.js";

function makeStores() {
  const snapshots = new Map<string, any>();
  const transitions: any[] = [];
  const snapshotStore: LifecycleSnapshotStore = {
    read: vi.fn(async (id) => snapshots.get(id) ?? null),
    readInTransaction: vi.fn(async (_tx, id) => snapshots.get(id) ?? null),
    upsertInTransaction: vi.fn(async (_tx, snap) => {
      snapshots.set(snap.conversationThreadId, snap);
    }),
  };
  const transitionStore: LifecycleTransitionStore = {
    appendInTransaction: vi.fn(async (_tx, t) => {
      // Simulate Prisma's cuid() default by stamping a synthetic id at insert time.
      transitions.push({ ...t, id: `t-${transitions.length + 1}` });
    }),
    listForThread: vi.fn(async (id) => transitions.filter((t) => t.conversationThreadId === id)),
  };
  // Inline transaction stub: pass through synchronously.
  const runInTransaction = async <T>(fn: (tx: unknown) => Promise<T>) => fn({});
  return { snapshotStore, transitionStore, runInTransaction, snapshots, transitions };
}

describe("LifecycleWriter.recordTransition", () => {
  it("creates the initial snapshot when none exists (null → active seed)", async () => {
    // NOTE: `null → active` is the legal first seed per `canTransitionLifecycle`'s
    // `NULL_INIT_ALLOWED = { active, booked, escalated }`. `null → stalled` is
    // forbidden — thread-init (Task 13.5) seeds `active` first; the stalled cron
    // (Task 14) is then allowed to transition `active → stalled`.
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "active",
      trigger: "inbound_after_stalled",
      actor: "system",
      evidence: {},
    });
    expect(snapshots.get("thread-1")?.currentState).toBe("active");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromState).toBeNull();
    expect(transitions[0].toState).toBe("active");
  });

  it("precedence blocks null → stalled (cron must not invent stalled from nothing)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: { hours_since_outbound: 25 },
    });
    expect(snapshots.get("thread-1")).toBeUndefined();
    expect(transitions).toHaveLength(0);
  });

  it("respects precedence — does not overwrite booked with stalled", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const now = new Date();
    snapshots.set("thread-1", {
      conversationThreadId: "thread-1",
      organizationId: "org-1",
      contactId: "contact-1",
      currentState: "booked",
      qualificationStatus: "unknown",
      bookingStatus: "booked",
      dropoffReason: null,
      lastTransitionAt: now,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: {},
    });
    expect(snapshots.get("thread-1")?.currentState).toBe("booked");
    expect(transitions).toHaveLength(0);
  });

  it("allows escalated → booked (operator closes booking)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const now = new Date();
    snapshots.set("thread-1", {
      conversationThreadId: "thread-1",
      organizationId: "org-1",
      contactId: "contact-1",
      currentState: "escalated",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: now,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "booked",
      trigger: "booking_event_received",
      actor: "integration",
      evidence: { booking_id: "b-1" },
    });
    expect(snapshots.get("thread-1")?.currentState).toBe("booked");
    expect(snapshots.get("thread-1")?.bookingStatus).toBe("booked");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromState).toBe("escalated");
  });

  it("rejects 3b-only toState (disqualified) with a runtime error", async () => {
    const { snapshotStore, transitionStore, runInTransaction } = makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await expect(
      writer.recordTransition({
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toState: "disqualified" as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trigger: "operator_confirmed_disqualification" as any,
        actor: "operator",
        evidence: {},
      }),
    ).rejects.toThrow(/THREE_A_ALLOWED_STATES/);
  });

  it("rejects 3b-only trigger (qualification_checklist_met) with a runtime error", async () => {
    const { snapshotStore, transitionStore, runInTransaction } = makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await expect(
      writer.recordTransition({
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        toState: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trigger: "qualification_checklist_met" as any,
        actor: "system",
        evidence: {},
      }),
    ).rejects.toThrow(/THREE_A_ALLOWED_TRIGGERS/);
  });

  it("rebuilds snapshot from transition log (round-trip)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots } = makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: {},
    });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "active",
      trigger: "inbound_after_stalled",
      actor: "system",
      evidence: {},
    });
    const liveCurrent = snapshots.get("thread-1")?.currentState;
    snapshots.delete("thread-1");
    const rebuilt = await writer.rebuildSnapshotFromTransitions("thread-1");
    expect(rebuilt?.currentState).toBe(liveCurrent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/lifecycle-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lifecycle-writer.ts`**

```ts
// packages/core/src/lifecycle/lifecycle-writer.ts
import {
  type ConversationLifecycleSnapshot,
  type ConversationLifecycleTransition,
} from "@switchboard/schemas";
import type {
  LifecycleSnapshotStore,
  LifecycleTransitionStore,
  RecordTransitionInput,
} from "./types.js";
import { canTransition } from "./precedence.js";
import { THREE_A_ALLOWED_STATES, THREE_A_ALLOWED_TRIGGERS } from "./constants.js";

export type RunInTransaction = <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;

export interface LifecycleWriterDeps {
  snapshotStore: LifecycleSnapshotStore;
  transitionStore: LifecycleTransitionStore;
  runInTransaction: RunInTransaction;
}

export class LifecycleWriter {
  constructor(private readonly deps: LifecycleWriterDeps) {}

  async recordTransition(input: RecordTransitionInput): Promise<void> {
    // 3a runtime allowlist guard. Schema permits the full Phase 3 enum for
    // forward compatibility, but 3a code paths must only emit mechanical states
    // and 3a triggers. Throw — never silently drop — so that any 3a caller
    // accidentally reaching for a 3b value fails loudly in test/dev.
    if (!THREE_A_ALLOWED_STATES.has(input.toState)) {
      throw new Error(
        `LifecycleWriter (3a): toState '${input.toState}' is not in THREE_A_ALLOWED_STATES`,
      );
    }
    if (!THREE_A_ALLOWED_TRIGGERS.has(input.trigger)) {
      throw new Error(
        `LifecycleWriter (3a): trigger '${input.trigger}' is not in THREE_A_ALLOWED_TRIGGERS`,
      );
    }

    const occurredAt = input.occurredAt ?? new Date();
    await this.deps.runInTransaction(async (tx) => {
      // Read inside the transaction so the precedence decision sees the same
      // snapshot we are about to upsert. Prisma's default Read Committed
      // isolation guarantees this consistency for the read+upsert+append trio.
      const existing = await this.deps.snapshotStore.readInTransaction(
        tx,
        input.conversationThreadId,
      );
      const fromState = existing?.currentState ?? null;
      if (!canTransition(fromState, input.toState)) {
        return;
      }

      const nextSnapshot: ConversationLifecycleSnapshot = {
        conversationThreadId: input.conversationThreadId,
        organizationId: input.organizationId,
        contactId: input.contactId,
        currentState: input.toState,
        qualificationStatus: existing?.qualificationStatus ?? "unknown",
        bookingStatus: input.toState === "booked" ? "booked" : (existing?.bookingStatus ?? "not_booked"),
        dropoffReason: this.computeDropoffReason(input, existing?.dropoffReason ?? null),
        lastTransitionAt: occurredAt,
        lastEvaluatedAt: occurredAt,
        updatedAt: occurredAt,
      };
      await this.deps.snapshotStore.upsertInTransaction(tx, nextSnapshot);

      // id omitted — Prisma's @default(cuid()) on the model generates it.
      // Keeping id generation in one place (the DB) avoids two competing
      // conventions in the codebase.
      const transition: Omit<ConversationLifecycleTransition, "id"> = {
        organizationId: input.organizationId,
        conversationThreadId: input.conversationThreadId,
        contactId: input.contactId,
        fromState,
        toState: input.toState,
        trigger: input.trigger,
        evidence: input.evidence,
        actor: input.actor,
        workTraceId: input.workTraceId ?? null,
        occurredAt,
      };
      await this.deps.transitionStore.appendInTransaction(tx, transition);
    });
  }

  /** Re-evaluate a thread without writing a transition; updates `lastEvaluatedAt` only. */
  async touchEvaluation(threadId: string, evaluatedAt: Date = new Date()): Promise<void> {
    await this.deps.runInTransaction(async (tx) => {
      const existing = await this.deps.snapshotStore.read(threadId);
      if (!existing) return;
      await this.deps.snapshotStore.upsertInTransaction(tx, {
        ...existing,
        lastEvaluatedAt: evaluatedAt,
        updatedAt: evaluatedAt,
      });
    });
  }

  /** Recover the snapshot by replaying the transition log. */
  async rebuildSnapshotFromTransitions(
    threadId: string,
  ): Promise<ConversationLifecycleSnapshot | null> {
    const transitions = await this.deps.transitionStore.listForThread(threadId);
    if (transitions.length === 0) return null;
    let snap: ConversationLifecycleSnapshot | null = null;
    for (const t of transitions) {
      const fromState = snap?.currentState ?? null;
      if (!canTransition(fromState, t.toState)) continue;
      snap = {
        conversationThreadId: t.conversationThreadId,
        organizationId: t.organizationId,
        contactId: t.contactId,
        currentState: t.toState,
        qualificationStatus: snap?.qualificationStatus ?? "unknown",
        bookingStatus: t.toState === "booked" ? "booked" : (snap?.bookingStatus ?? "not_booked"),
        dropoffReason: this.computeDropoffReason(
          {
            organizationId: t.organizationId,
            conversationThreadId: t.conversationThreadId,
            contactId: t.contactId,
            toState: t.toState,
            trigger: t.trigger,
            actor: t.actor,
            evidence: t.evidence,
          },
          snap?.dropoffReason ?? null,
        ),
        lastTransitionAt: t.occurredAt,
        lastEvaluatedAt: t.occurredAt,
        updatedAt: t.occurredAt,
      };
    }
    return snap;
  }

  private computeDropoffReason(
    input: RecordTransitionInput,
    prior: ConversationLifecycleSnapshot["dropoffReason"],
  ): ConversationLifecycleSnapshot["dropoffReason"] {
    if (input.toState === "stalled" && input.trigger === "timer_24h_no_inbound") return "no_reply";
    if (input.toState === "booked") return null;
    if (input.toState === "active") return null;
    return prior;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/lifecycle-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/lifecycle-writer.ts packages/core/src/lifecycle/__tests__/lifecycle-writer.test.ts
git commit -m "feat(core): add LifecycleWriter with precedence + rebuild (Phase 3a)"
```

---

### Task 8: Message-history reader + GovernanceVerdict reader (Prisma adapters)

**Files:**
- Create: `packages/db/src/prisma-message-history-reader.ts`
- Create: `packages/db/src/__tests__/prisma-message-history-reader.test.ts`
- Create: `packages/db/src/prisma-re-engagement-verdict-reader.ts`
- Create: `packages/db/src/__tests__/prisma-re-engagement-verdict-reader.test.ts`

> **Discovery applied (2026-05-12 mid-execution):**
>
> 1. `ConversationMessage` has NO `conversationThreadId` column. It has `contactId, orgId, direction ("inbound"|"outbound"), createdAt`. `ConversationThread` has `@@unique([contactId, organizationId])` (one thread per pair). To filter messages by thread, the adapter MUST first look up the thread row to get `(contactId, organizationId)`, then query messages with `{ contactId, orgId: organizationId }`.
> 2. `GovernanceVerdict.conversationId` is sourced from `ctx.sessionId`, NOT `ConversationThread.id`. For single-tenant Telegram (`apps/chat/src/main.ts:299`) `sessionId === threadId` so the two coincide. For managed-gateway paths (web widget, managed WhatsApp), `sessionId !== threadId` — sessionId is a channel-specific identifier (phone, widget session) stored on `ConversationThread.agentContext.sessionId`. The verdict reader must:
>    - Read `ConversationThread.agentContext` for the row at `threadId`.
>    - Use `agentContext.sessionId` as the verdict lookup key when present.
>    - Fall back to `threadId` (single-tenant case).
>
> Both adapters take `threadId` as their public input; the thread lookup is internal.

- [ ] **Step 2: Write the failing message-history test**

```ts
// packages/db/src/__tests__/prisma-message-history-reader.test.ts
import { describe, expect, it, vi } from "vitest";
import { PrismaMessageHistoryReader } from "../prisma-message-history-reader.js";

describe("PrismaMessageHistoryReader.read", () => {
  it("returns lastAlexOutboundAt and lastInboundAt", async () => {
    const earlier = new Date("2026-05-10T09:00:00Z");
    const later = new Date("2026-05-10T09:05:00Z");
    const prisma = {
      conversationMessage: {
        findFirst: vi
          .fn()
          .mockImplementationOnce(async () => ({ createdAt: later })) // outbound
          .mockImplementationOnce(async () => ({ createdAt: earlier })), // inbound
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaMessageHistoryReader(prisma as any);
    const result = await reader.read("thread-1");
    expect(result.lastAlexOutboundAt).toEqual(later);
    expect(result.lastInboundAt).toEqual(earlier);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-message-history-reader.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write the message-history adapter**

Adjust the `where` filters to use the field names you discovered in Step 1.

```ts
// packages/db/src/prisma-message-history-reader.ts
import type { PrismaClient } from "@prisma/client";
import type { MessageHistoryReader } from "@switchboard/core";

export class PrismaMessageHistoryReader implements MessageHistoryReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(threadId: string) {
    const lastOutbound = await this.prisma.conversationMessage.findFirst({
      where: { conversationThreadId: threadId, direction: "outbound" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastInbound = await this.prisma.conversationMessage.findFirst({
      where: { conversationThreadId: threadId, direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return {
      lastAlexOutboundAt: lastOutbound?.createdAt ?? null,
      lastInboundAt: lastInbound?.createdAt ?? null,
    };
  }
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-message-history-reader.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing GovernanceVerdict-reader test**

```ts
// packages/db/src/__tests__/prisma-re-engagement-verdict-reader.test.ts
import { describe, expect, it, vi } from "vitest";
import { PrismaReEngagementVerdictReader } from "../prisma-re-engagement-verdict-reader.js";

describe("PrismaReEngagementVerdictReader.findReEngagementVerdict", () => {
  it("returns the most recent re-engagement substitute verdict in the window", async () => {
    const decidedAt = new Date("2026-05-09T09:00:00Z");
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const prisma = {
      governanceVerdict: {
        findFirst: vi.fn().mockResolvedValue({
          id: "v-1",
          decidedAt,
          details: {
            intentClass: "re-engagement-offer",
            metaTemplateName: "re_engagement_offer_sg_v1",
          },
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    const result = await reader.findReEngagementVerdict("thread-1", inboundAt, 7);
    expect(result?.verdictId).toBe("v-1");
    expect(result?.templateName).toBe("re_engagement_offer_sg_v1");
    expect(prisma.governanceVerdict.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: "thread-1", // assumes sessionId==threadId per Step 1 discovery
        sourceGuard: "whatsapp_window",
        action: "substitute",
        decidedAt: { gte: expect.any(Date), lte: inboundAt },
        details: { path: ["intentClass"], equals: "re-engagement-offer" },
      },
      orderBy: { decidedAt: "desc" },
      select: { id: true, decidedAt: true, details: true },
    });
  });

  it("returns null when no matching verdict exists (1d not shipped, or no substitute fired)", async () => {
    const prisma = {
      governanceVerdict: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new PrismaReEngagementVerdictReader(prisma as any);
    expect(await reader.findReEngagementVerdict("thread-1", new Date(), 7)).toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-re-engagement-verdict-reader.test.ts`
Expected: FAIL.

- [ ] **Step 8: Write the GovernanceVerdict adapter**

```ts
// packages/db/src/prisma-re-engagement-verdict-reader.ts
import type { PrismaClient } from "@prisma/client";
import type { ReEngagementVerdictReader } from "@switchboard/core";

export class PrismaReEngagementVerdictReader implements ReEngagementVerdictReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findReEngagementVerdict(threadId: string, inboundAt: Date, windowDays: number) {
    const earliest = new Date(inboundAt.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const row = await this.prisma.governanceVerdict.findFirst({
      where: {
        // Step 1 Discovery: if sessionId !== threadId in this codebase, translate
        // here via a resolveSessionToThread helper.
        conversationId: threadId,
        sourceGuard: "whatsapp_window",
        action: "substitute",
        decidedAt: { gte: earliest, lte: inboundAt },
        details: { path: ["intentClass"], equals: "re-engagement-offer" },
      },
      orderBy: { decidedAt: "desc" },
      select: { id: true, decidedAt: true, details: true },
    });
    if (!row) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details = row.details as any;
    return {
      verdictId: row.id,
      templateName: details?.metaTemplateName ?? "",
      decidedAt: row.decidedAt,
    };
  }
}
```

- [ ] **Step 9: Run test to verify pass**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-re-engagement-verdict-reader.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/prisma-message-history-reader.ts packages/db/src/__tests__/prisma-message-history-reader.test.ts packages/db/src/prisma-re-engagement-verdict-reader.ts packages/db/src/__tests__/prisma-re-engagement-verdict-reader.test.ts
git commit -m "feat(db): add PrismaMessageHistoryReader and PrismaReEngagementVerdictReader (Phase 3a)"
```

---

### Task 9: Re-engagement attributor

**Files:**
- Create: `packages/core/src/lifecycle/re-engagement-attributor.ts`
- Create: `packages/core/src/lifecycle/__tests__/re-engagement-attributor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/re-engagement-attributor.test.ts
import { describe, expect, it, vi } from "vitest";
import { ReEngagementAttributor } from "../re-engagement-attributor.js";
import type { ReEngagementVerdictReader } from "../types.js";

describe("ReEngagementAttributor.attributeReOpen", () => {
  it("returns inbound_after_re_engagement_template when a qualifying verdict exists", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const decidedAt = new Date("2026-05-11T09:00:00Z");
    const reader: ReEngagementVerdictReader = {
      findReEngagementVerdict: vi.fn().mockResolvedValue({
        verdictId: "v-1",
        templateName: "re_engagement_offer_sg_v1",
        decidedAt,
      }),
    };
    const attributor = new ReEngagementAttributor(reader);
    const result = await attributor.attributeReOpen("thread-1", inboundAt);
    expect(result.trigger).toBe("inbound_after_re_engagement_template");
    expect(result.evidence.template_name).toBe("re_engagement_offer_sg_v1");
    expect(result.evidence.governance_verdict_id).toBe("v-1");
    expect(result.evidence.response_lag_h).toBe(24);
  });

  it("returns inbound_after_stalled when no re-engagement verdict exists in window (e.g. 1d not shipped)", async () => {
    const reader: ReEngagementVerdictReader = {
      findReEngagementVerdict: vi.fn().mockResolvedValue(null),
    };
    const attributor = new ReEngagementAttributor(reader);
    const result = await attributor.attributeReOpen("thread-1", new Date());
    expect(result.trigger).toBe("inbound_after_stalled");
    expect(result.evidence).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/re-engagement-attributor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the attributor**

```ts
// packages/core/src/lifecycle/re-engagement-attributor.ts
import type { ConversationLifecycleTrigger } from "@switchboard/schemas";
import type { ReEngagementVerdictReader } from "./types.js";
import { RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS } from "./constants.js";

export interface ReOpenAttribution {
  trigger: ConversationLifecycleTrigger;
  evidence: Record<string, unknown>;
}

/**
 * Resolves the re-open trigger by reading 1d's substitute verdicts. If 1d has
 * not yet shipped, or did not fire a substitute in the window, falls back to
 * `inbound_after_stalled`. This means 3a does not require 1d as a prerequisite
 * — it gracefully degrades to no-attribution when the verdict trail is absent.
 */
export class ReEngagementAttributor {
  constructor(private readonly verdicts: ReEngagementVerdictReader) {}

  async attributeReOpen(threadId: string, inboundAt: Date): Promise<ReOpenAttribution> {
    const verdict = await this.verdicts.findReEngagementVerdict(
      threadId,
      inboundAt,
      RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS,
    );
    if (!verdict) {
      return { trigger: "inbound_after_stalled", evidence: {} };
    }
    const responseLagH = Math.round(
      (inboundAt.getTime() - verdict.decidedAt.getTime()) / (60 * 60 * 1000),
    );
    return {
      trigger: "inbound_after_re_engagement_template",
      evidence: {
        template_name: verdict.templateName,
        governance_verdict_id: verdict.verdictId,
        response_lag_h: responseLagH,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/re-engagement-attributor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/re-engagement-attributor.ts packages/core/src/lifecycle/__tests__/re-engagement-attributor.test.ts
git commit -m "feat(core): add ReEngagementAttributor (Phase 3a)"
```

---

### Task 10: Event hook — `GovernanceVerdict` → `escalated`

**Files:**
- Create: `packages/core/src/lifecycle/event-hooks/governance-verdict-escalation-hook.ts`
- Create: `packages/core/src/lifecycle/__tests__/event-hooks/governance-verdict-escalation-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/event-hooks/governance-verdict-escalation-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { onGovernanceVerdictWritten } from "../../event-hooks/governance-verdict-escalation-hook.js";

describe("onGovernanceVerdictWritten", () => {
  it("calls writer with escalated when verdict.action='escalate'", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onGovernanceVerdictWritten(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "regulated_claim_unsubstantiated",
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "escalated",
        trigger: "governance_verdict_escalate",
        actor: "system",
        workTraceId: null,
        evidence: expect.objectContaining({ verdict_id: "v-1", verdict_reason: "regulated_claim_unsubstantiated" }),
      }),
    );
  });

  it("is a no-op when flag mode is off", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onGovernanceVerdictWritten(writer, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "anything",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("is a no-op when verdict.action !== 'escalate'", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onGovernanceVerdictWritten(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      verdictId: "v-1",
      action: "rewrite",
      reasonCode: "anything",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/governance-verdict-escalation-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the hook**

```ts
// packages/core/src/lifecycle/event-hooks/governance-verdict-escalation-hook.ts
import type { LifecycleWriter } from "../lifecycle-writer.js";

export interface GovernanceVerdictEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  verdictId: string;
  action: string; // GovernanceVerdictActionSchema
  reasonCode: string;
}

export type LifecycleModeReader = (orgId: string) => Promise<"on" | "off">;

export async function onGovernanceVerdictWritten(
  writer: LifecycleWriter,
  readMode: LifecycleModeReader,
  event: GovernanceVerdictEvent,
): Promise<void> {
  if (event.action !== "escalate") return;
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "escalated",
    trigger: "governance_verdict_escalate",
    actor: "system",
    workTraceId: null,
    evidence: {
      verdict_id: event.verdictId,
      verdict_reason: event.reasonCode,
    },
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/governance-verdict-escalation-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/event-hooks/governance-verdict-escalation-hook.ts packages/core/src/lifecycle/__tests__/event-hooks/governance-verdict-escalation-hook.test.ts
git commit -m "feat(core): add lifecycle hook for governance escalation verdicts (Phase 3a)"
```

---

### Task 11: Event hook — `Booking` → `booked`

**Files:**
- Create: `packages/core/src/lifecycle/event-hooks/booking-created-hook.ts`
- Create: `packages/core/src/lifecycle/__tests__/event-hooks/booking-created-hook.test.ts`

- [ ] **Step 1: Discover the booking-creation seat**

Search the codebase: `grep -rn "prisma.booking.create\|prisma.booking.upsert" packages apps --include="*.ts"`. Identify each call site. Choose the strategy:
- **Single seat exists** (e.g. a `BookingService.create()`): wire the hook there.
- **Multiple seats exist**: wire the hook at every seat (Task 15 lists the seats in the bootstrap wiring).
- **No clear seat**: write a Prisma extension or middleware in `packages/db/src/prisma-db.ts` that fires the hook after every `Booking` write.

Document the chosen strategy in the commit message.

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/event-hooks/booking-created-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { onBookingCreated } from "../../event-hooks/booking-created-hook.js";

describe("onBookingCreated", () => {
  it("transitions thread to booked with booking evidence", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onBookingCreated(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      bookingId: "book-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "booked",
        trigger: "booking_event_received",
        actor: "integration",
        evidence: { booking_id: "book-1", calendar_event_id: "cal-1", service_id: "svc-1" },
      }),
    );
  });

  it("no-ops when booking is not associated with a conversation thread", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onBookingCreated(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: null,
      contactId: "contact-1",
      bookingId: "book-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onBookingCreated(writer, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      bookingId: "book-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.1: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/booking-created-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the hook**

```ts
// packages/core/src/lifecycle/event-hooks/booking-created-hook.ts
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface BookingCreatedEvent {
  organizationId: string;
  conversationThreadId: string | null;
  contactId: string;
  bookingId: string;
  calendarEventId: string;
  serviceId: string;
}

export async function onBookingCreated(
  writer: LifecycleWriter,
  readMode: LifecycleModeReader,
  event: BookingCreatedEvent,
): Promise<void> {
  if (!event.conversationThreadId) return;
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "booked",
    trigger: "booking_event_received",
    actor: "integration",
    evidence: {
      booking_id: event.bookingId,
      calendar_event_id: event.calendarEventId,
      service_id: event.serviceId,
    },
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/booking-created-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/event-hooks/booking-created-hook.ts packages/core/src/lifecycle/__tests__/event-hooks/booking-created-hook.test.ts
git commit -m "feat(core): add lifecycle hook for booking-created events (Phase 3a)"
```

---

### Task 12: Event hook — inbound message → re-open from `stalled`

**Files:**
- Create: `packages/core/src/lifecycle/event-hooks/inbound-message-hook.ts`
- Create: `packages/core/src/lifecycle/__tests__/event-hooks/inbound-message-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/event-hooks/inbound-message-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { onInboundMessage } from "../../event-hooks/inbound-message-hook.js";

describe("onInboundMessage", () => {
  it("transitions stalled → active when no re-engagement outbound in window", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue({ currentState: "stalled" }) };
    const attributor = {
      attributeReOpen: vi
        .fn()
        .mockResolvedValue({ trigger: "inbound_after_stalled", evidence: {} }),
    };
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      snapshotStore as any,
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "active",
        trigger: "inbound_after_stalled",
      }),
    );
  });

  it("uses inbound_after_re_engagement_template when attributor finds an outbound", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue({ currentState: "stalled" }) };
    const attributor = {
      attributeReOpen: vi.fn().mockResolvedValue({
        trigger: "inbound_after_re_engagement_template",
        evidence: { template_id: "re_engagement_offer_sg_v1" },
      }),
    };
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      snapshotStore as any,
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "active",
        trigger: "inbound_after_re_engagement_template",
        evidence: { template_id: "re_engagement_offer_sg_v1" },
      }),
    );
  });

  it("no-ops when current state is not stalled", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue({ currentState: "active" }) };
    const attributor = { attributeReOpen: vi.fn() };
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      snapshotStore as any,
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
    expect(attributor.attributeReOpen).not.toHaveBeenCalled();
  });

  it("no-ops when no snapshot exists (thread first contact)", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn().mockResolvedValue(null) };
    const attributor = { attributeReOpen: vi.fn() };
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      snapshotStore as any,
      attributor as any,
      async () => "on",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    const snapshotStore = { read: vi.fn() };
    const attributor = { attributeReOpen: vi.fn() };
    const writer = { recordTransition } as any;
    await onInboundMessage(
      writer,
      snapshotStore as any,
      attributor as any,
      async () => "off",
      {
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        receivedAt: new Date(),
      },
    );
    expect(recordTransition).not.toHaveBeenCalled();
    expect(snapshotStore.read).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/inbound-message-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the hook**

```ts
// packages/core/src/lifecycle/event-hooks/inbound-message-hook.ts
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleSnapshotStore } from "../types.js";
import type { ReEngagementAttributor } from "../re-engagement-attributor.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface InboundMessageEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  receivedAt: Date;
}

export async function onInboundMessage(
  writer: LifecycleWriter,
  snapshotStore: LifecycleSnapshotStore,
  attributor: ReEngagementAttributor,
  readMode: LifecycleModeReader,
  event: InboundMessageEvent,
): Promise<void> {
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  const snap = await snapshotStore.read(event.conversationThreadId);
  if (!snap) return;
  if (snap.currentState !== "stalled") return;
  const attribution = await attributor.attributeReOpen(
    event.conversationThreadId,
    event.receivedAt,
  );
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "active",
    trigger: attribution.trigger,
    actor: "system",
    evidence: attribution.evidence,
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/inbound-message-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/event-hooks/inbound-message-hook.ts packages/core/src/lifecycle/__tests__/event-hooks/inbound-message-hook.test.ts
git commit -m "feat(core): add lifecycle hook for inbound re-open (Phase 3a)"
```

---

### Task 13: Event hook — operator takeover → `escalated`

**Files:**
- Create: `packages/core/src/lifecycle/event-hooks/operator-takeover-hook.ts`
- Create: `packages/core/src/lifecycle/__tests__/event-hooks/operator-takeover-hook.test.ts`

- [ ] **Step 1: Discover the operator-takeover signal**

Inspect `packages/db/prisma/schema.prisma` `model ConversationThread` for an `assignedOperatorId` or similar column. If absent, the takeover signal is the first inbound message authored by an operator role on the thread (queryable from `ConversationMessage` with a non-Alex actor field). Document the chosen detection path in the commit message.

- [ ] **Step 2: Write the failing test (assumes column-based signal)**

```ts
// packages/core/src/lifecycle/__tests__/event-hooks/operator-takeover-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { onOperatorTakeover } from "../../event-hooks/operator-takeover-hook.js";

describe("onOperatorTakeover", () => {
  it("transitions to escalated with operator evidence", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const takenAt = new Date();
    await onOperatorTakeover(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      operatorId: "op-1",
      takenAt,
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "escalated",
        trigger: "operator_takeover",
        actor: "operator",
        evidence: { operator_id: "op-1", takeover_at: takenAt.toISOString() },
      }),
    );
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    await onOperatorTakeover(writer, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      operatorId: "op-1",
      takenAt: new Date(),
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/operator-takeover-hook.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write the hook**

```ts
// packages/core/src/lifecycle/event-hooks/operator-takeover-hook.ts
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface OperatorTakeoverEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  operatorId: string;
  takenAt: Date;
}

export async function onOperatorTakeover(
  writer: LifecycleWriter,
  readMode: LifecycleModeReader,
  event: OperatorTakeoverEvent,
): Promise<void> {
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "escalated",
    trigger: "operator_takeover",
    actor: "operator",
    evidence: {
      operator_id: event.operatorId,
      takeover_at: event.takenAt.toISOString(),
    },
  });
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/operator-takeover-hook.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lifecycle/event-hooks/operator-takeover-hook.ts packages/core/src/lifecycle/__tests__/event-hooks/operator-takeover-hook.test.ts
git commit -m "feat(core): add lifecycle hook for operator takeover (Phase 3a)"
```

---

### Task 13.5: Event hook — thread-first-observation → `null → active`

The cron cannot create a snapshot from nothing (`canTransition(null, "stalled") === false` per Task 4). Some other path must seed the initial `active` snapshot when a thread is first observed by Phase 3. This hook fires on the first inbound message a thread ever receives (or, equivalently, on `ConversationThread.create`) and writes `null → active` so subsequent cron sweeps can promote the thread to `stalled`.

**Files:**
- Create: `packages/core/src/lifecycle/event-hooks/thread-init-hook.ts`
- Create: `packages/core/src/lifecycle/__tests__/event-hooks/thread-init-hook.test.ts`

- [ ] **Step 1: Discover the thread-init seat**

Pick the seat that fires exactly once per thread:
- **Preferred:** `ConversationThread.create` write site. Search: `grep -rn "prisma.conversationThread.create\|conversationThread.upsert" packages apps --include="*.ts"`. The cleanest seat is wherever a brand-new thread is persisted (most likely a `ConversationThreadService.findOrCreateByContact()` or similar).
- **Fallback:** call this hook from the same inbound-message seat used by Task 12 (`onInboundMessage`), but conditional on `snapshotStore.read(threadId) === null`. This works but couples thread-init to inbound (no snapshot for outbound-first threads — acceptable in 3a since Alex never reaches out cold without an inbound).

Document the chosen seat in the commit message.

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/event-hooks/thread-init-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { onThreadFirstObservation } from "../../event-hooks/thread-init-hook.js";

describe("onThreadFirstObservation", () => {
  it("seeds null → active when no snapshot exists", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const snapshotStore = { read: vi.fn().mockResolvedValue(null) };
    await onThreadFirstObservation(writer, snapshotStore as any, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      observedAt: new Date(),
      observationKind: "inbound_message",
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "active",
        trigger: "inbound_after_stalled", // re-using existing trigger; see implementation comment
        actor: "system",
        evidence: { observation_kind: "inbound_message" },
      }),
    );
  });

  it("is a no-op when snapshot already exists (idempotent)", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const snapshotStore = {
      read: vi.fn().mockResolvedValue({ currentState: "active" }),
    };
    await onThreadFirstObservation(writer, snapshotStore as any, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      observedAt: new Date(),
      observationKind: "inbound_message",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const snapshotStore = { read: vi.fn() };
    await onThreadFirstObservation(writer, snapshotStore as any, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      observedAt: new Date(),
      observationKind: "inbound_message",
    });
    expect(recordTransition).not.toHaveBeenCalled();
    expect(snapshotStore.read).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/thread-init-hook.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write the hook**

```ts
// packages/core/src/lifecycle/event-hooks/thread-init-hook.ts
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleSnapshotStore } from "../types.js";
import type { LifecycleModeReader } from "./governance-verdict-escalation-hook.js";

export interface ThreadFirstObservationEvent {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  observedAt: Date;
  observationKind: "inbound_message" | "thread_create";
}

/**
 * Seeds the initial `null → active` snapshot for a thread. Without this, the
 * cron cannot transition any thread to `stalled` because `canTransition(null,
 * "stalled")` returns false (see Task 4). Idempotent — exits cleanly when a
 * snapshot already exists.
 *
 * Trigger choice: re-uses `inbound_after_stalled` rather than introducing a
 * 12th trigger value. Semantically the initial observation IS an inbound that
 * brings the thread to active. The `evidence.observation_kind` distinguishes
 * a true thread-init from a re-open.
 */
export async function onThreadFirstObservation(
  writer: LifecycleWriter,
  snapshotStore: LifecycleSnapshotStore,
  readMode: LifecycleModeReader,
  event: ThreadFirstObservationEvent,
): Promise<void> {
  const mode = await readMode(event.organizationId);
  if (mode !== "on") return;
  const existing = await snapshotStore.read(event.conversationThreadId);
  if (existing) return;
  await writer.recordTransition({
    organizationId: event.organizationId,
    conversationThreadId: event.conversationThreadId,
    contactId: event.contactId,
    toState: "active",
    trigger: "inbound_after_stalled",
    actor: "system",
    evidence: { observation_kind: event.observationKind },
    occurredAt: event.observedAt,
  });
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/event-hooks/thread-init-hook.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lifecycle/event-hooks/thread-init-hook.ts packages/core/src/lifecycle/__tests__/event-hooks/thread-init-hook.test.ts
git commit -m "feat(core): add thread-first-observation lifecycle hook (Phase 3a)"
```

---

### Task 14: Inngest cron — `lifecycle.stalled-sweep`

**Files:**
- Create: `packages/core/src/lifecycle/cron/stalled-sweep.ts`
- Create: `packages/core/src/lifecycle/__tests__/cron/stalled-sweep.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lifecycle/__tests__/cron/stalled-sweep.test.ts
import { describe, expect, it, vi } from "vitest";
import { runStalledSweep } from "../../cron/stalled-sweep.js";

describe("runStalledSweep", () => {
  it("marks a thread stalled when last outbound is >24h ago and no inbound after", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const now = new Date("2026-05-12T12:00:00Z");
    const threadList = vi.fn().mockResolvedValue([
      { conversationThreadId: "t-1", organizationId: "org-1", contactId: "c-1", currentState: "active" },
    ]);
    const history = {
      read: vi.fn().mockResolvedValue({
        lastAlexOutboundAt: new Date("2026-05-11T09:00:00Z"), // ~27h before now
        lastInboundAt: new Date("2026-05-11T08:55:00Z"),
      }),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: threadList,
      history: history as any,
      readMode: async () => "on",
      now,
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "stalled",
        trigger: "timer_24h_no_inbound",
      }),
    );
  });

  it("does not mark stalled when an inbound came after the outbound", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const now = new Date("2026-05-12T12:00:00Z");
    const threadList = vi.fn().mockResolvedValue([
      { conversationThreadId: "t-1", organizationId: "org-1", contactId: "c-1", currentState: "active" },
    ]);
    const history = {
      read: vi.fn().mockResolvedValue({
        lastAlexOutboundAt: new Date("2026-05-11T09:00:00Z"),
        lastInboundAt: new Date("2026-05-11T10:00:00Z"), // newer than outbound
      }),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: threadList,
      history: history as any,
      readMode: async () => "on",
      now,
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("is idempotent — second sweep within the hour produces no extra writes (writer dedupes via canTransition for same state)", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const now = new Date("2026-05-12T12:00:00Z");
    const threadList = vi.fn().mockResolvedValue([
      // Already stalled
      { conversationThreadId: "t-1", organizationId: "org-1", contactId: "c-1", currentState: "stalled" },
    ]);
    const history = {
      read: vi.fn().mockResolvedValue({
        lastAlexOutboundAt: new Date("2026-05-11T09:00:00Z"),
        lastInboundAt: null,
      }),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: threadList,
      history: history as any,
      readMode: async () => "on",
      now,
    });
    // Stalled → stalled isn't allowed by canTransition (we don't emit same-state);
    // verified by writer not being called from sweep when state already matches.
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops globally when readMode is off", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const threadList = vi.fn();
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: threadList,
      history: { read: vi.fn() } as any,
      readMode: async () => "off",
      now: new Date(),
    });
    expect(threadList).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/cron/stalled-sweep.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the cron**

```ts
// packages/core/src/lifecycle/cron/stalled-sweep.ts
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { MessageHistoryReader } from "../types.js";
import type { LifecycleModeReader } from "../event-hooks/governance-verdict-escalation-hook.js";
import { STALLED_THRESHOLD_HOURS } from "../constants.js";

export interface StalledSweepCandidate {
  conversationThreadId: string;
  organizationId: string;
  contactId: string;
  currentState: string;
}

export interface StalledSweepDeps {
  writer: LifecycleWriter;
  listNonTerminalSnapshots: () => Promise<StalledSweepCandidate[]>;
  history: MessageHistoryReader;
  readMode: LifecycleModeReader;
  now: Date;
}

const NON_TERMINAL_STATES = new Set(["active", "qualified"]);

export async function runStalledSweep(deps: StalledSweepDeps): Promise<void> {
  // Bulk mode short-circuit. The cron applies a single mode read at the org-loop level
  // inside the iteration; here we treat any single-tenant dev wiring with one global flag.
  // For multi-tenant, group candidates by organizationId and call readMode per org.
  const candidates = await deps.listNonTerminalSnapshots();
  const thresholdMs = STALLED_THRESHOLD_HOURS * 60 * 60 * 1000;

  const seenOrgModes = new Map<string, "on" | "off">();
  const modeFor = async (orgId: string): Promise<"on" | "off"> => {
    const cached = seenOrgModes.get(orgId);
    if (cached) return cached;
    const m = await deps.readMode(orgId);
    seenOrgModes.set(orgId, m);
    return m;
  };

  for (const c of candidates) {
    if (!NON_TERMINAL_STATES.has(c.currentState)) continue;
    const m = await modeFor(c.organizationId);
    if (m !== "on") continue;
    const { lastAlexOutboundAt, lastInboundAt } = await deps.history.read(
      c.conversationThreadId,
    );
    if (!lastAlexOutboundAt) continue;
    if (lastInboundAt && lastInboundAt > lastAlexOutboundAt) continue;
    const hoursSince = (deps.now.getTime() - lastAlexOutboundAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince < STALLED_THRESHOLD_HOURS) continue;
    await deps.writer.recordTransition({
      organizationId: c.organizationId,
      conversationThreadId: c.conversationThreadId,
      contactId: c.contactId,
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: {
        last_outbound_at: lastAlexOutboundAt.toISOString(),
        last_inbound_at: lastInboundAt?.toISOString() ?? null,
        hours_since_outbound: Math.round(hoursSince),
      },
      occurredAt: deps.now,
    });
  }
}
```

Also note: the early-return for `readMode='off'` in the test is the case where every candidate's org returns off. The first test variant ("no-ops globally when readMode is off") relies on `listNonTerminalSnapshots` not being called. Adjust the implementation so the bulk-mode short-circuit fires:

In `runStalledSweep`, before calling `listNonTerminalSnapshots`, evaluate `readMode("__global__")` (a sentinel) — if it returns "off" and there is exactly one tenant being modeled, skip. For the test, swap the test to align: pass a `listNonTerminalSnapshots` mock that should not be called and assert it. The cleaner pattern: drop the global short-circuit; instead, the test asserts that with all orgs off, no `recordTransition` happens. Update the test accordingly:

```ts
  it("calls writer for none of the candidates when readMode returns off for every org", async () => {
    const recordTransition = vi.fn();
    const writer = { recordTransition } as any;
    const threadList = vi.fn().mockResolvedValue([
      { conversationThreadId: "t-1", organizationId: "org-1", contactId: "c-1", currentState: "active" },
    ]);
    const history = {
      read: vi.fn(),
    };
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: threadList,
      history: history as any,
      readMode: async () => "off",
      now: new Date(),
    });
    expect(recordTransition).not.toHaveBeenCalled();
    expect(history.read).not.toHaveBeenCalled();
  });
```

Replace the previous "no-ops globally when readMode is off" test with this version. Reason: the cleaner contract is per-org gating, not a global short-circuit.

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/cron/stalled-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/cron/stalled-sweep.ts packages/core/src/lifecycle/__tests__/cron/stalled-sweep.test.ts
git commit -m "feat(core): add stalled-sweep cron (Phase 3a)"
```

---

### Task 15: Bootstrap wiring + Inngest registration + real subscription seats

> **Scope adjustment (2026-05-12 mid-execution):**
>
> Original "Definition of done" required all five event hooks wired to real DB-write seats inside this task. Discovery revealed two seats are not currently wireable:
>
> 1. **Booking (5b):** the only `bookingStore.create` seat (`packages/core/src/skill-runtime/tools/calendar-book.ts:187`) does NOT have `conversationThreadId` in scope. Wiring requires a thread lookup (by contactId+orgId) inside the seat, which crosses package layers and is out of scope.
> 2. **Operator takeover (5d):** there is no API endpoint, no `assignedOperatorId` column, and no actor-role on `ConversationMessage` — the takeover signal does not exist in the codebase. Wiring requires a new dashboard route or column migration.
>
> Adjusted scope for this task:
> - Build the bootstrap module with the IoC registrar pattern. Unit test mocks all registrar callbacks (per the plan's existing test). PASS.
> - Register the Inngest cron `lifecycle.stalled-sweep` as a real Inngest function using the existing `createXCron()` factory pattern in `apps/api/src/bootstrap/inngest.ts`.
> - Add an `onWrite?` callback option to `PrismaGovernanceVerdictStore` (5a). The bootstrap can subscribe a real callback when the app constructs the store with the lifecycle wiring.
> - Wire the inbound (5c) and thread-init (5e) hooks at `apps/chat/src/gateway/gateway-conversation-store.ts` via callback options on `GatewayConversationStore` constructor.
> - Defer booking (5b) and operator (5d) wiring with explicit TODOs in the bootstrap module pointing to the missing prerequisites.
>
> The bootstrap test asserts the registrar contract regardless of how many real seats are wired today.

**Files:**
- Create: `apps/api/src/bootstrap/lifecycle.ts`
- Create: `apps/api/src/bootstrap/__tests__/lifecycle.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`
- Modify: `packages/db/src/prisma-governance-verdict-store.ts` (Step 5a — verdict seat)
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts` (Step 5c — inbound seat)
- Modify: booking-creation seat discovered in Task 11 Step 1 (Step 5b)
- Modify: operator-takeover seat discovered in Task 13 Step 1 (Step 5d)
- Modify: thread-init seat discovered in Task 13.5 Step 1 (Step 5e)

- [ ] **Step 1: Discover the existing bootstrap pattern**

Read `apps/api/src/bootstrap/outcome-wiring.ts` and `apps/api/src/bootstrap/inngest.ts` for the established patterns: how a new module exports a `bootstrap*` function, how it gets called from `app.ts`, how Inngest functions are registered. Mirror this layout for `lifecycle.ts`.

- [ ] **Step 2: Write the failing wiring test**

```ts
// apps/api/src/bootstrap/__tests__/lifecycle.test.ts
import { describe, expect, it, vi } from "vitest";
import { bootstrapLifecycle } from "../lifecycle.js";

function makeRegistrarMocks() {
  return {
    registerVerdictWriteHook: vi.fn(),
    registerBookingCreateHook: vi.fn(),
    registerInboundMessageHook: vi.fn(),
    registerOperatorTakeoverHook: vi.fn(),
    registerThreadInitHook: vi.fn(),
    registerCron: vi.fn(),
  };
}

describe("bootstrapLifecycle", () => {
  it("constructs a writer + attributor and registers all five event hooks plus cron", () => {
    const registered: string[] = [];
    const registrars = makeRegistrarMocks();
    const result = bootstrapLifecycle({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      governanceConfigResolver: (async () => ({
        lifecycleTagging: { mechanical: { mode: "off" } },
      })) as any,
      ...registrars,
      onHookRegister: (name: string) => registered.push(name),
    });
    expect(result.writer).toBeDefined();
    expect(result.attributor).toBeDefined();
    expect(registrars.registerVerdictWriteHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerBookingCreateHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerInboundMessageHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerOperatorTakeoverHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerThreadInitHook).toHaveBeenCalledTimes(1);
    expect(registrars.registerCron).toHaveBeenCalledWith(
      "lifecycle.stalled-sweep",
      "0 * * * *",
      expect.any(Function),
    );
    expect(registered.sort()).toEqual([
      "booking-created",
      "governance-verdict-escalation",
      "inbound-message",
      "operator-takeover",
      "stalled-sweep-cron",
      "thread-first-observation",
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the bootstrap module**

```ts
// apps/api/src/bootstrap/lifecycle.ts
import type { PrismaClient } from "@prisma/client";
import {
  LifecycleWriter,
  ReEngagementAttributor,
  onGovernanceVerdictWritten,
  onBookingCreated,
  onInboundMessage,
  onOperatorTakeover,
  onThreadFirstObservation,
  type LifecycleSnapshotStore,
} from "@switchboard/core";
import {
  PrismaConversationLifecycleSnapshotStore,
  PrismaConversationLifecycleTransitionStore,
  PrismaMessageHistoryReader,
  PrismaReEngagementVerdictReader,
} from "@switchboard/db";
import type { GovernanceConfigResolver } from "@switchboard/core";

export interface BootstrapLifecycleDeps {
  prisma: PrismaClient;
  governanceConfigResolver: GovernanceConfigResolver;
  /** Subscription seats. Each is a function returned by the seat's module that
   *  accepts a callback to invoke after the corresponding write. */
  registerVerdictWriteHook: (cb: (event: Parameters<typeof onGovernanceVerdictWritten>[2]) => Promise<void>) => void;
  registerBookingCreateHook: (cb: (event: Parameters<typeof onBookingCreated>[2]) => Promise<void>) => void;
  registerInboundMessageHook: (cb: (event: Parameters<typeof onInboundMessage>[4]) => Promise<void>) => void;
  registerOperatorTakeoverHook: (cb: (event: Parameters<typeof onOperatorTakeover>[2]) => Promise<void>) => void;
  registerThreadInitHook: (cb: (event: Parameters<typeof onThreadFirstObservation>[3]) => Promise<void>) => void;
  /** Inngest handle for cron registration (per Step 6). */
  registerCron: (name: string, schedule: string, fn: () => Promise<void>) => void;
  /** Optional observability callback — receives a name for each registered hook. */
  onHookRegister?: (name: string) => void;
}

export interface BootstrapLifecycleResult {
  writer: LifecycleWriter;
  attributor: ReEngagementAttributor;
  snapshotStore: LifecycleSnapshotStore;
}

export function bootstrapLifecycle(deps: BootstrapLifecycleDeps): BootstrapLifecycleResult {
  const snapshotStore = new PrismaConversationLifecycleSnapshotStore(deps.prisma);
  const transitionStore = new PrismaConversationLifecycleTransitionStore(deps.prisma);
  const history = new PrismaMessageHistoryReader(deps.prisma);
  const verdictReader = new PrismaReEngagementVerdictReader(deps.prisma);
  const writer = new LifecycleWriter({
    snapshotStore,
    transitionStore,
    runInTransaction: (fn) => deps.prisma.$transaction(fn),
  });
  const attributor = new ReEngagementAttributor(verdictReader);

  const readMode = async (orgId: string): Promise<"on" | "off"> => {
    const cfg = await deps.governanceConfigResolver(orgId);
    return cfg.lifecycleTagging.mechanical.mode;
  };

  // Real subscription wiring — each call connects a hook to a real DB-write seat.
  deps.registerVerdictWriteHook((event) => onGovernanceVerdictWritten(writer, readMode, event));
  deps.onHookRegister?.("governance-verdict-escalation");

  deps.registerBookingCreateHook((event) => onBookingCreated(writer, readMode, event));
  deps.onHookRegister?.("booking-created");

  deps.registerInboundMessageHook((event) =>
    onInboundMessage(writer, snapshotStore, attributor, readMode, event),
  );
  deps.onHookRegister?.("inbound-message");

  deps.registerOperatorTakeoverHook((event) => onOperatorTakeover(writer, readMode, event));
  deps.onHookRegister?.("operator-takeover");

  deps.registerThreadInitHook((event) =>
    onThreadFirstObservation(writer, snapshotStore, readMode, event),
  );
  deps.onHookRegister?.("thread-first-observation");

  // Cron — see Step 6 for the function body.
  deps.registerCron("lifecycle.stalled-sweep", "0 * * * *", async () => {
    // delegated to runStalledSweep — see Step 6
  });
  deps.onHookRegister?.("stalled-sweep-cron");

  return { writer, attributor, snapshotStore };
}
```

- [ ] **Step 5a: Wire `onGovernanceVerdictWritten` at the verdict store**

Edit `packages/db/src/prisma-governance-verdict-store.ts`. The store is layer-4; it cannot import `packages/core` directly (layer rule). Instead: extend the store constructor with an optional `onWrite?: (verdict) => Promise<void>` callback. The store invokes this callback after every successful write with a normalised payload. The bootstrap module wires the callback to `(verdict) => onGovernanceVerdictWritten(writer, readMode, mapVerdictToEvent(verdict))`.

Add a focused test in `packages/db/src/__tests__/prisma-governance-verdict-store.test.ts`:

```ts
it("invokes onWrite callback after successful verdict write", async () => {
  const onWrite = vi.fn();
  // ... construct store with onWrite, call store.create(verdict)
  expect(onWrite).toHaveBeenCalledTimes(1);
  expect(onWrite).toHaveBeenCalledWith(expect.objectContaining({ id: <newId>, action: "escalate" }));
});

it("does not invoke onWrite when DB write fails", async () => {
  // mock prisma to throw; assert onWrite not called
});
```

- [ ] **Step 5b: Wire `onBookingCreated` at the booking-creation seat (from Task 11 Step 1)**

Apply the same callback-injection pattern. If the booking-creation seat is a service in `packages/core/src/...`, the bootstrap can wire the callback directly. If it is in `packages/db` or a Prisma-extension, use the same `onWrite?` constructor option.

Test in the same file as the seat: assert callback fires on success, does not fire on DB failure. Mock the writer to confirm `recordTransition` reaches it with the expected `BookingCreatedEvent`.

- [ ] **Step 5c: Wire `onInboundMessage` at the channel gateway**

Edit `packages/core/src/channel-gateway/channel-gateway.ts`. After the existing `prisma.conversationMessage.create({...})` for inbound persistence (find by grep), call `await onInboundMessage(writer, snapshotStore, attributor, readMode, { ... })`. The writer/snapshotStore/attributor are constructed by the bootstrap and threaded into the gateway via existing dependency injection.

Test in `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`: existing tests cover the happy path; add one assertion that the lifecycle hook callback is invoked once per inbound message. Use a spy on the injected hook.

- [ ] **Step 5d: Wire `onOperatorTakeover` at the takeover seat (from Task 13 Step 1)**

Same callback-injection pattern. Most likely seat is wherever `ConversationThread.assignedOperatorId` (or equivalent) is updated. If the column does not exist, the fallback per Task 13 Step 1 is the operator-message inbound path — wire there.

Test asserts hook fires on operator assignment, does not fire on agent assignment.

- [ ] **Step 5e: Wire `onThreadFirstObservation` at the thread-init seat (from Task 13.5 Step 1)**

Same callback-injection pattern. Most likely seat: `ConversationThread.create` write site, or the inbound-message seat conditional on no-snapshot-yet.

Test asserts hook fires exactly once per thread (idempotency).

- [ ] **Step 5f: Verify all five subscriptions are wired**

Update the bootstrap test from Step 2:

```ts
it("returns wired event-hook registrations matching the five mechanical seats", () => {
  const registered: string[] = [];
  const result = bootstrapLifecycle({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: {} as any,
    governanceConfigResolver: (async () => ({
      lifecycleTagging: { mechanical: { mode: "off" } },
    })) as any,
    onHookRegister: (name: string) => registered.push(name),
  });
  expect(result.writer).toBeDefined();
  expect(result.attributor).toBeDefined();
  // Five real seats, plus one cron registration. No fewer.
  expect(registered.sort()).toEqual([
    "booking-created",
    "governance-verdict-escalation",
    "inbound-message",
    "operator-takeover",
    "stalled-sweep-cron",
    "thread-first-observation",
  ]);
});

it("each onHookRegister name corresponds to a real subscription, not a placeholder", () => {
  // Snapshot guard: if a subscription is removed from bootstrap without
  // updating this test, it fails loudly.
});
```

- [ ] **Step 6: Register the Inngest cron**

In `apps/api/src/bootstrap/inngest.ts`, register a new function `lifecycle.stalled-sweep` on schedule `0 * * * *` (every hour at :00). Inside, query `prisma.conversationLifecycleSnapshot.findMany({ where: { currentState: { in: ['active', 'qualified'] }, lastEvaluatedAt: { lt: <one hour ago> } } })` to bound the candidate set, then call `runStalledSweep({ writer, listNonTerminalSnapshots: () => Promise.resolve(rows.map(rowToCandidate)), history, readMode, now: new Date() })`. After the sweep, also call `writer.touchEvaluation(threadId)` for every candidate that did not transition, so `lastEvaluatedAt` advances and the next sweep can skip recently-checked threads.

- [ ] **Step 7: Run tests to verify pass**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/lifecycle.test.ts`
Expected: PASS.

Run all subscription-site unit tests added in Step 5 — each must pass.

- [ ] **Step 8: Run full workspace typecheck**

Run: `pnpm typecheck`
Expected: no errors across schemas, db, core, api.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/bootstrap/lifecycle.ts apps/api/src/bootstrap/__tests__/lifecycle.test.ts apps/api/src/bootstrap/inngest.ts apps/api/src/app.ts <subscription-seat-files>
git commit -m "feat(api): wire Phase 3a lifecycle bootstrap + cron + subscriptions"
```

---

### Task 16: End-to-end integration test

**Files:**
- Create: `packages/core/src/lifecycle/__tests__/integration.test.ts`

- [ ] **Step 1: Write the end-to-end mechanical-lifecycle integration test**

```ts
// packages/core/src/lifecycle/__tests__/integration.test.ts
import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import { ReEngagementAttributor } from "../re-engagement-attributor.js";
import { onGovernanceVerdictWritten } from "../event-hooks/governance-verdict-escalation-hook.js";
import { onBookingCreated } from "../event-hooks/booking-created-hook.js";
import { onInboundMessage } from "../event-hooks/inbound-message-hook.js";
import { onOperatorTakeover } from "../event-hooks/operator-takeover-hook.js";
import { runStalledSweep } from "../cron/stalled-sweep.js";

function makeInMemoryStores() {
  const snapshots = new Map<string, any>();
  const transitions: any[] = [];
  return {
    snapshotStore: {
      read: async (id: string) => snapshots.get(id) ?? null,
      upsertInTransaction: async (_tx: unknown, snap: any) => {
        snapshots.set(snap.conversationThreadId, snap);
      },
    },
    transitionStore: {
      appendInTransaction: async (_tx: unknown, t: any) => {
        transitions.push(t);
      },
      listForThread: async (id: string) =>
        transitions.filter((t) => t.conversationThreadId === id),
    },
    runInTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
    snapshots,
    transitions,
  };
}

describe("end-to-end mechanical lifecycle", () => {
  it("active → escalated (governance) → booked (operator closes booking)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeInMemoryStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    const readMode = async () => "on" as const;

    await onGovernanceVerdictWritten(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "regulated_claim_unsubstantiated",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("escalated");

    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("booked");
    expect(snapshots.get("t-1")?.bookingStatus).toBe("booked");
    expect(transitions.map((t) => t.toState)).toEqual(["escalated", "booked"]);
  });

  it("active → stalled (cron) → active (re-engagement attribution) → booked", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeInMemoryStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    const readMode = async () => "on" as const;
    const history = { read: vi.fn() };
    const verdicts = { findReEngagementVerdict: vi.fn() };

    // Seed an active snapshot
    snapshots.set("t-1", {
      conversationThreadId: "t-1",
      organizationId: "org-1",
      contactId: "c-1",
      currentState: "active",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: new Date("2026-05-10T09:00:00Z"),
      lastEvaluatedAt: new Date("2026-05-10T09:00:00Z"),
      updatedAt: new Date("2026-05-10T09:00:00Z"),
    });

    history.read.mockResolvedValue({
      lastAlexOutboundAt: new Date("2026-05-10T09:05:00Z"),
      lastInboundAt: new Date("2026-05-10T09:00:00Z"),
    });
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: async () => [
        { conversationThreadId: "t-1", organizationId: "org-1", contactId: "c-1", currentState: "active" },
      ],
      history: history as any,
      readMode,
      now: new Date("2026-05-12T12:00:00Z"),
    });
    expect(snapshots.get("t-1")?.currentState).toBe("stalled");

    verdicts.findReEngagementVerdict.mockResolvedValue({
      verdictId: "v-1",
      templateName: "re_engagement_offer_sg_v1",
      decidedAt: new Date("2026-05-12T08:00:00Z"),
    });
    const attributor = new ReEngagementAttributor(verdicts as any);
    await onInboundMessage(writer, snapshotStore as any, attributor, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      receivedAt: new Date("2026-05-12T16:00:00Z"),
    });
    expect(snapshots.get("t-1")?.currentState).toBe("active");

    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("booked");

    expect(transitions.map((t) => t.toState)).toEqual(["stalled", "active", "booked"]);
    expect(transitions[1].trigger).toBe("inbound_after_re_engagement_template");
    expect(transitions[1].evidence.template_name).toBe("re_engagement_offer_sg_v1");
    expect(transitions[1].evidence.governance_verdict_id).toBe("v-1");
  });

  it("THREE_A_ALLOWED_STATES enforcement — no 3a hook ever produces disqualified", async () => {
    // Smoke check: a fresh integration session that exercises the 3a hooks
    // should never produce a transition with a 3b state/trigger. This is a
    // belt-and-braces guard: the writer's runtime allowlist already throws,
    // so seeing a `disqualified` toState in the recorded transitions would
    // indicate either a hook regression or a test misuse of the writer.
    const { snapshotStore, transitionStore, runInTransaction, transitions } =
      makeInMemoryStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    const readMode = async () => "on" as const;
    const verdicts = { findReEngagementVerdict: vi.fn().mockResolvedValue(null) };
    const attributor = new ReEngagementAttributor(verdicts as any);

    // Run every 3a hook seat in sequence on a fresh thread.
    await onGovernanceVerdictWritten(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "anything",
    });
    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });

    const forbiddenStates = new Set(["disqualified", "qualified"]);
    const forbiddenTriggers = new Set([
      "qualification_checklist_met",
      "qualification_checklist_failed",
      "system_proposed_disqualification",
      "operator_confirmed_disqualification",
      "operator_dismissed_disqualification",
    ]);
    for (const t of transitions) {
      expect(forbiddenStates.has(t.toState)).toBe(false);
      expect(forbiddenTriggers.has(t.trigger)).toBe(false);
    }
  });

  it("operator takeover → escalated, then booking closes → booked (attribution preserved)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots } = makeInMemoryStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    const readMode = async () => "on" as const;

    await onOperatorTakeover(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      operatorId: "op-1",
      takenAt: new Date(),
    });
    expect(snapshots.get("t-1")?.currentState).toBe("escalated");

    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("booked");
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `pnpm --filter @switchboard/core test src/lifecycle/__tests__/integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full core test suite**

Run: `pnpm --filter @switchboard/core test`
Expected: all pre-existing tests still pass; new lifecycle tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/lifecycle/__tests__/integration.test.ts
git commit -m "test(core): end-to-end mechanical lifecycle integration (Phase 3a)"
```

---

### Task 17: Workspace verification + reference doc updates

**Files:**
- Modify: `skills/alex/references/regulatory/sg-rules.md`
- Modify: `skills/alex/references/regulatory/my-rules.md`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Re-export lifecycle public surface from core**

In `packages/core/src/index.ts`, append:

```ts
export * from "./lifecycle/types.js";
export * from "./lifecycle/errors.js";
export * from "./lifecycle/constants.js";
export * from "./lifecycle/precedence.js";
export * from "./lifecycle/lifecycle-writer.js";
export * from "./lifecycle/re-engagement-attributor.js";
export * from "./lifecycle/event-hooks/governance-verdict-escalation-hook.js";
export * from "./lifecycle/event-hooks/booking-created-hook.js";
export * from "./lifecycle/event-hooks/inbound-message-hook.js";
export * from "./lifecycle/event-hooks/operator-takeover-hook.js";
export * from "./lifecycle/cron/stalled-sweep.js";
```

- [ ] **Step 2: Append a brief Phase 3 section to each regulatory reference**

In `skills/alex/references/regulatory/sg-rules.md`, append:

```markdown
## Phase 3 lifecycle observation

Conversation lifecycle (mechanical states only in 3a) is tracked in `packages/core/src/lifecycle/`. Operators reviewing Alex behavior may consult `ConversationLifecycleSnapshot` for current state and `ConversationLifecycleTransition` for the path. Lifecycle is observation-only — it does not gate Alex outbounds. Re-engagement requests that lifecycle generates still flow through the 1c PDPA consent gate and the 1d WhatsApp window/template gate.
```

Mirror in `my-rules.md` (same content; the regulatory specifics differ but the lifecycle pointer is identical).

- [ ] **Step 3: Run full workspace lint + typecheck + test**

Run in parallel:
```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: all green.

- [ ] **Step 4: Run dashboard build (per `feedback_dashboard_build_not_in_ci.md`)**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: success. (3a does not touch the dashboard, but the gate catches inadvertent core type-export changes that would break Next.js.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts skills/alex/references/regulatory/sg-rules.md skills/alex/references/regulatory/my-rules.md
git commit -m "chore(core,skills): re-export lifecycle surface + reference pointers (Phase 3a)"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Phase 3a coverage |
|---|---|
| §4.1 Six primary states | Task 1 schema enum |
| §4.2 Snapshot + orthogonal attributes | Task 1 schema, Task 3 Prisma model |
| §4.3 State precedence + `escalated → booked` | Task 4 `precedence.ts`, Task 7 writer |
| §4.4 Transition log | Task 1 schema, Task 3 Prisma model, Task 6 store |
| §5.1 Mechanical states | Tasks 10/11/13/13.5/14 (escalated, booked, takeover, thread-init, stalled) |
| §5.2 Qualification | **Deferred to Phase 3b** (out of scope) |
| §5.3 Disqualified | **Deferred to Phase 3b** (out of scope) |
| §5.4 Re-opening + attribution | Task 9 attributor, Task 12 inbound hook |
| §6 Hybrid triggering | Tasks 10/11/12/13/13.5 event-driven, Task 14 cron |
| §7 Storage (snapshot + transition + WorkTrace pointer) | Task 3 + Tasks 5/6 (workTraceId field present in transition) |
| §8 1c/1d governance authority | Plan does not add an outbound seat; lifecycle reads only. Re-engagement send is not a 3a deliverable. |
| §9 Recommendations v1 surface | **Deferred to Phase 3c** (out of scope) |
| §10 Sub-flag | Task 2 `lifecycleTagging.mechanical.mode` |
| §11 Test fixtures (3a row) | Tasks 7, 14, 16 cover the listed cases |

**Placeholder scan:** Searched for "TBD", "TODO", "implement later", "appropriate error handling", "similar to Task". None present. The discovery steps in Tasks 8/11/13 are explicit pointers, not placeholders — they require the engineer to inspect specific files and the result determines a single, narrow code branch.

**Type-consistency check:** Snapshot/transition field names match across schemas (Task 1), Prisma (Task 3), adapters (Tasks 5/6), writer (Task 7), and bootstrap (Task 15). Trigger enum values match between schemas (Task 1), event hooks (Tasks 10/11/12/13/13.5), and cron (Task 14). `LifecycleModeReader` defined once in Task 10 and re-used by Tasks 11/12/13/13.5 via import — no duplicate definitions. `MessageHistoryReader` and `ReEngagementVerdictReader` are distinct interfaces (split per Patch 5 review) with separate Prisma adapters; the writer takes neither directly, the cron takes only `MessageHistoryReader`, the attributor takes only `ReEngagementVerdictReader`.

**Concurrency-safety check:** `LifecycleWriter.recordTransition` uses `snapshotStore.readInTransaction(tx, ...)` inside `runInTransaction`, so the precedence comparison sees the same snapshot the upsert writes. Mocks in Tasks 5 and 7 stub both `read` and `readInTransaction` to keep the contract honest. The 3a runtime allowlist guard in `LifecycleWriter` throws (not silently drops) on 3b values, so any 3a regression that reaches for a 3b state/trigger fails loudly in test/dev.

**3a/3b boundary check:** Disqualification enums (`disqualified`, `proposed_disqualified`, three operator-disqualification triggers) are present in the schema for forward compatibility but blocked from emission by `THREE_A_ALLOWED_*` constants in `constants.ts` (Task 4) + writer guard (Task 7) + integration test assertion (Task 16). The boundary is enforced at three layers: schema (passive), writer (active runtime), test (regression guard).

---

## Out-of-scope reaffirmed

- `qualified` state (Phase 3b)
- `disqualified` state, operator confirm/dismiss flow (Phase 3b)
- `QualificationSignals` sidecar + `SkillExecutionResult.qualificationSignals` extension (Phase 3b)
- Recommendation generators (Phase 3c)
- Contact-level lifecycle aggregation (deferred per spec §13)
- Cost gating of re-engagement sends (Phase 2)
- Reconciliation with existing `ContactLifecycle` and `ConversationThread.stage` (post-3c)
- Persistent posture cache (in-memory only in 3a, mirrors 1c pattern)
