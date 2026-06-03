# Booking Lifecycle Integrity + Reschedule/Cancel (Alex PR-B) — Design

**Date:** 2026-06-03
**Branch:** `feat/alex-booking-lifecycle` (off `origin/main` `f7dc170f`)
**Audit source:** `docs/audits/2026-06-02-alex-improvement-audit/{execution-plan.md,findings.md,intent-coverage-matrix.md}` (#805)
**Stack position:** PR-B of the Alex improvement stack. **Prerequisites merged & verified:** PR-0 eval-faithfulness (#833 `92d3e70d`), PR-A live-turn correctness (#799 `c4834e16`), Phase-A honest metric/closing (#794 `c213e370`), BusinessFacts unify (#813), operator facts editor (#828).

> **Why this PR:** Booking is Alex's conversion endpoint, and today it leaks at the single most important point. The intent-coverage matrix grounds this: **21% of the curated hard-case eval set lands on the booking path, and that path is the most-broken cluster.** Three booking fixtures already _encode_ these bugs but pass green because the eval ran ungoverned with stateless mock tools. PR-0 made the store→builder→prompt seam faithful; this PR fixes the booking machinery and adds the regression net that proves it.

---

## 1. Problem statement (verified against live code)

| #    | Finding                                     | Live defect (file:line on `f7dc170f`)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0.6 | Booking never advances the funnel           | `booking.create` confirms the `Booking` row + writes a `"booked"` outbox event but **never advances `Opportunity.stage` to `"booked"`**. The deterministic producer (`registerBookingCreateHook`) is wired to `() => {}` at `apps/api/src/app.ts:715` and `apps/api/src/bootstrap/inngest.ts:705`. Funnel/attribution undercount; a booked lead is re-engageable as "open". `calendar-book.ts:296-335` is where `opportunityId` is in scope but unused for stage. |
| T0.8 | A failed booking permanently blocks re-book | `@@unique([organizationId, contactId, service, startsAt])` (`schema.prisma:1935`, migration `20260418200000`) has **no status discriminator**. A `failed` row occupies the tuple → retry raises `P2002` → `DUPLICATE_BOOKING` forever.                                                                                                                                                                                                                            |
| T1.6 | Parked booking → false "you're all set"     | `booking.create` is `external_mutation`; at `guided`/`supervised` the `GovernanceHook` parks it (`pending_approval`), but `skills/alex/SKILL.md:236-237` only has a success line ("You're all set!") and a failure line — **no `pending_approval` branch**. The model authors all confirmation prose from the re-injected tool JSON; nothing stops a false confirmation against a parked result.                                                                  |
| T2.7 | Google-path double-book                     | The live write path is `PrismaBookingStore.create` (`prisma-booking-store.ts:23`) — a bare `prisma.booking.create` with **no overlap check**. The `SLOT_CONFLICT` guard exists only inside the Local provider's factory closure (`calendar-provider-factory.ts:187`), which the live path bypasses. Two leads can confirm the same physical slot.                                                                                                                 |
| —    | Orphaned calendar event                     | If `provider.createBooking` succeeds and the confirm-tx then throws, the booking is marked `failed` and escalated but the **created calendar event is never cancelled** (`calendar-book.ts:336-350` has no compensation).                                                                                                                                                                                                                                         |
| T1.3 | No reschedule/cancel tool                   | Every appointment change is force-escalated, though `CalendarProvider.cancelBooking`/`rescheduleBooking` are implemented on all providers (`schemas/src/calendar.ts:95-96`) and `Booking.rescheduleCount` exists (`schema.prisma:1931`). The eval fixture `post-sg-hifu-reschedule` (`fixtures/gen-post-booking.jsonl:1`) demands a reschedule **without escalating** (`forbiddenTools:["escalate"]`) — Alex cannot satisfy it today.                             |

**Downstream synergy:** the appointment-reminder leg (cadence work, merged: migrations `20260602090000`/`20260602093000`) reads confirmed bookings via `findUpcomingConfirmed`. A correct booking lifecycle (confirmed status + advanced stage) is its foundation; T0.6's fix removes a class of "booked-but-looks-open" leads.

---

## 2. Locked decisions (the audit's Open decisions, decided with conviction)

**Decision #2 — Booking auto-approve posture for pilots → _in-conversation close_, via the EXISTING autonomous posture; NO new dial.**
The medspa pilot deployment is already seeded `governanceSettings: { trustLevelOverride: "autonomous" }` (`seed-marketplace.ts:739,766`) with the explicit comment _"auto-allow Alex's revenue-path tool calls (CRM writes, bookings) without per-action approval."_ Under `autonomous`, `external_mutation` → `auto-approve` (`governance.ts:31`), so **pilots already close bookings (and reschedules/cancels) in-conversation.** The `guided`-park problem (T1.6) only affects orgs left at the default posture. Therefore:

- We do **not** build a separate `bookingAutoApprove` dial (it would be JSON-blob + ~7 layers of governance-context threading for marginal value the autonomous seed already delivers — YAGNI, and it touches the governance hot path other sessions could collide with). If finer "auto-book but human-approve-cancel" granularity is ever needed, it is a clean follow-up.
- We **do** make the parked path honest (Decision is satisfied by requirement T1.6's _other_ half): the confirmation prose branches on `pending_approval`, so non-autonomous orgs get _"I've put your booking request in — the team will confirm shortly"_ instead of a false "all set" or dead air.

**Decision #3 — Pilot interaction scope includes post-booking → YES.** The matrix: _"reschedule/cancel … they will [book], the moment anyone books."_ Reschedule + cancel are firmly **in scope** for this PR.

**Reschedule/cancel governance** = identical to `booking.create`: new `external_mutation` operations, governed by the same trust posture (autonomous pilot auto-approves; others park with honest prose). The target booking is resolved **only** from trusted `ctx.contactId` (never model-supplied) — no IDOR surface.

**Idempotency / double-book key design** — pull in the minimum that closes the findings; defer the heavy machinery:

- Stage advance: idempotent via a **monotonic, no-throw `updateMany`** co-committed in the confirm-tx.
- Failed-row re-book: a **partial unique index** excluding `failed`/`cancelled`.
- Double-book: an **in-transaction overlap check guarded by a per-org `pg_advisory_xact_lock`** (precedent `prisma-ledger-storage.ts:54`). `btree_gist`/`EXCLUDE` range constraints are **not available** (only `pgcrypto` + `vector` extensions exist) and adding an extension is out of scope.
- **Deferred** (explicitly, per the plan's "Then" tier): `ContactMutex`, request-level idempotency-key wiring, operation-level eval-oracle assertions, a configurable per-booking governance dial.

---

## 3. Scope

**In scope (8 work items, layered schemas → db → core → evals):**

- **A. Stage advance** — `booking.create` co-commits `Opportunity.stage = "booked"` in the confirm-tx, idempotent + monotonic, never surfacing a stage-write issue as a booking failure. _(T0.6)_
- **B. Partial unique index** — replace the plain `Booking` unique with a partial unique excluding `failed`/`cancelled`. _(T0.8)_
- **C. Double-book overlap guard** — `PrismaBookingStore.create` wraps the insert in a tx with a per-org advisory lock + half-open overlap check → typed `SLOT_CONFLICT` → handler maps to a **retryable re-offer**. _(T2.7)_
- **D. Orphan-event compensation** — confirm-failed path best-effort cancels the created provider event before escalating.
- **E. Confirmation prose** — SKILL.md branches on `ok` / `pending_approval` / `failed`. _(T1.6)_
- **F. Reschedule + cancel** — new `booking.reschedule` + `booking.cancel` operations on the `calendar-book` tool, resolving the booking from `ctx.contactId` via a new `findUpcomingByContact`, through the same governed path, persisting `startsAt`/`endsAt`/`rescheduleCount`/`rescheduledAt`/`status` durably + a `booking.cancelled`/`booking.rescheduled` outbox event. _(T1.3)_
- **G. Counters** — co-emit booking-lifecycle counters (confirmed, failed-by-reason, stage-advanced, slot-conflict, reschedule, cancel) in the same diff.
- **H. Eval regression net** — make `mock-tools` param-aware/stateful + add the reschedule/cancel operations; add **duplicate-booking** + **reschedule** fixtures (+ baseline) and red-team-verify they bite (live LLM run + a deterministic oracle simulation).

**Non-goals / deferred:** configurable booking governance dial; `ContactMutex`/idempotency-key; `btree_gist` range-exclusion; operation-level eval oracle; multi-booking disambiguation beyond "soonest + optional service narrow"; the conversation-lifecycle snapshot hook (separate, needs `conversationThreadId` — out of scope).

**Disjointness:** touches `schemas` + `db` + `core` + `evals` + `skills/alex/SKILL.md` (Phase-5 section). **No dashboard.** Active sessions (Riley per-campaign-truth, Mira publish, wave-1 tokens) are disjoint. `SKILL.md` coordination with #794 is by-section (its objection rewrite is Phase-3; ours is Phase-5).

---

## 4. Component design

### A. Opportunity stage advance (server-side, idempotent, atomic)

Advance the opportunity **inside the existing confirm transaction** (`calendar-book.ts:297-335`), co-committed with the booking-confirm + outbox write, using the `opportunityId` already resolved at `:211-224`.

Extend the tx interface (`TransactionFn`, `calendar-book.ts:46-53`) to expose `opportunity.updateMany`, and the api wiring (`skill-mode.ts` `runTransaction`, ~`:301-311`) to pass `tx.opportunity`. Inside the tx, after the booking update:

```ts
await tx.opportunity.updateMany({
  where: {
    id: opportunityId,
    organizationId: orgId,
    stage: { notIn: STAGES_AT_OR_BEYOND_BOOKED }, // ["booked","showed","won","lost"]
  },
  data: { stage: "booked" }, // @updatedAt bumps automatically
});
getMetrics().bookingStageAdvanced.inc({ orgId });
```

**Why this satisfies "deterministic, idempotent, stage-failure ≠ booking-failure":**

- _Deterministic / server-side:_ always runs in the handler — not an LLM `stage.update` the prompt never requests. Not a route side effect.
- _Idempotent + monotonic:_ the `notIn` guard means a re-advance (same lead books twice; a retried confirm) is a no-op; we never downgrade a `showed`/`won` opportunity. `findActiveByContact` already excludes `won`/`lost`, so `opportunityId` is an active/new opp.
- _No stage-write-as-booking-failure:_ `updateMany` **never throws on `count: 0`** (unlike `updateStage`, which throws `StaleVersionError`). The opportunity is guaranteed to exist (resolved/created in the same invocation at `:211-224`), so the only failure mode is infra failure — which equally rolls back the booking-confirm, i.e. the booking genuinely did not happen (correctly retryable). There is no logical path where the stage write fails but the booking should have succeeded.
- _Atomic:_ a confirmed booking ⟺ a `booked` opportunity. No async gap, no new consumer to leave unwired (we deliberately avoid an outbox-consumer to not recreate the "built-but-unwired" failure shape the audit is about).

`STAGES_AT_OR_BEYOND_BOOKED` is exported from `schemas/src/lifecycle.ts` (next to `OpportunityStageSchema`) for reuse in tests.

### B. Partial unique index (T0.8)

Mirror the CreatorIdentity precedent (`migrations/20260428082529_pcd_registry_sp1_race_fix/migration.sql:10-14`) exactly, so `db:check-drift` (`prisma migrate diff --from-migrations --to-schema-datamodel`, `scripts/check-prisma-drift.sh:73-79`) stays green:

- **schema.prisma:** delete the `@@unique([organizationId, contactId, service, startsAt])` line (`:1935`); leave it absent (Prisma 6 cannot express a partial unique). Add a comment pointing at the migration. Keep the other `Booking` indexes.
- **New migration** `<ts>_booking_partial_unique_active/migration.sql`:
  ```sql
  ALTER TABLE "Booking" DROP CONSTRAINT "Booking_organizationId_contactId_service_startsAt_key";
  CREATE UNIQUE INDEX "Booking_org_contact_service_start_active_key"
    ON "Booking" ("organizationId", "contactId", "service", "startsAt")
    WHERE "status" NOT IN ('failed', 'cancelled');
  ```
  (Index name = 44 chars, within the 63-char cap.)

Because both sides lose the _representable_ unique and the partial index is invisible to the datamodel diff, drift stays green. The `P2002 → DUPLICATE_BOOKING` guard (`calendar-book.ts:240-258`) is preserved (a live duplicate still violates the partial unique); `findBySlot` semantics are unaffected (it queries by tuple, not the index).

### C. Double-book overlap guard (T2.7) — retryable re-offer

Move the guard onto the live durable write. In `PrismaBookingStore.create` (`prisma-booking-store.ts:23`), wrap the insert in `$transaction`:

```ts
return this.prisma.$transaction(async (tx) => {
  // Serialize check-then-insert per org (advisory lock auto-released at tx end).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${input.organizationId}))`;
  const overlap = await tx.booking.findFirst({
    where: {
      organizationId: input.organizationId,
      status: { notIn: ["failed", "cancelled"] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true },
  });
  if (overlap) throw new BookingSlotConflictError(overlap.id);
  return tx.booking.create({ data: { ...input, status: "pending_confirmation" } });
});
```

- `BookingSlotConflictError` (with `code = "SLOT_CONFLICT"`) is defined/exported in `schemas/src/calendar.ts`; `core` and `db` both import `schemas` (no layer violation). The handler detects it structurally (`isSlotConflictError(err)`, mirroring `isPrismaUniqueConstraintError`) — keeping `core` free of any `db` import.
- The half-open predicate (`existing.startsAt < new.endsAt AND existing.endsAt > new.startsAt`, exclude `failed`/`cancelled`) is the exact shape already used at `calendar-provider-factory.ts:176-185`.
- The advisory lock (namespaced constant `BOOKING_LOCK_NS` to avoid colliding with the ledger's `900_001`, keyed per-org via `hashtext`) makes the check-then-insert race-safe without `SERIALIZABLE` or a GiST extension. Per-org granularity keeps contention negligible at medspa scale.
- **Handler mapping:** in the `bookingStore.create` catch (`calendar-book.ts:239-260`), add a branch _before_ the P2002 branch: `if (isSlotConflictError(err))` → `fail("SLOT_TAKEN", "That time was just taken.", { retryable: true, modelRemediation: "Re-run slots.query and offer the lead the next available times." })` + `getMetrics().bookingSlotConflict.inc({ orgId })`. This converts a double-book into a graceful re-offer, not a dead end.

_Unit tests mock Prisma_ (CI has no Postgres), so the advisory-lock raw call + `findFirst` are mocked; the store test asserts: overlap found → throws `BookingSlotConflictError`; no overlap → inserts.

### D. Orphan-event compensation

In the confirm-failed catch (`calendar-book.ts:336-350`), before `failureHandler.handle`, best-effort cancel the just-created provider event so a confirm-tx failure doesn't leave a live-but-untracked calendar event:

```ts
if (calendarResult.calendarEventId) {
  try { await provider.cancelBooking(calendarResult.calendarEventId); }
  catch (cancelErr) { /* swallow: keep the escalation; human reconciles */ console.warn(...); }
}
```

`cancelBooking` takes the provider-side event id (Google `eventId` / `local-…`), which `calendarResult.calendarEventId` is. The escalation still opens (the booking is still `failed`), so no behavior is lost — only the orphan is cleaned when possible.

### E. Confirmation prose branch (SKILL.md)

In the Phase-4 booking section (`SKILL.md:230-248`), add a **pending_approval** branch alongside the existing success/failure lines. The model already receives the full tool-result JSON (`status`, `error.code`) re-injected; we give it an explicit branch:

```
**If calendar-book.booking.create returns status "pending_approval" (APPROVAL_REQUIRED):**
- Do NOT say "you're all set" — the slot is requested, not yet confirmed.
- "I've put your booking request in for [service] on [day] at [time] — the team will confirm it shortly and you'll get the calendar invite. Anything else in the meantime?"
- Do not call escalate; the approval is already queued by the system.
```

The success line stays gated on `status: "confirmed"`; the failure branch stays. Also add a one-line `SLOT_TAKEN` remediation under the failure branch ("offer the next available times"). No code change is required for the model to _see_ the status — the success `ok(...)` and `pendingApproval` payloads already carry `status`/`error.code`. The branch is prompt-driven; the **governed-booking-close fixture (H)** verifies Alex uses the pending prose instead of a false "all set".

### F. Reschedule + cancel (new operations on `calendar-book`)

Add `booking.reschedule` and `booking.cancel` as operations on the existing `calendar-book` tool (NOT a new tool) — keeps the SKILL.md tool list and the eval's tool-id oracle unchanged, and matches the existing `slots.query`/`booking.create` shape. Both are `effectCategory: "external_mutation"`, `idempotent: true`.

To keep `calendar-book.ts` under the 400-line warn / 600-line error bar, extract the two new operations into a sibling module `calendar-reschedule.ts` exporting `buildRescheduleOperations(ctx, deps)`, spread into the factory's `operations` map.

**Resolution (trusted, no IDOR):** the model supplies only the _new_ slot (`slotStart`,`slotEnd`,`calendarId`) for reschedule, and an optional `service` to narrow. The handler resolves the target booking purely from `ctx.contactId`:

- New store method `findUpcomingByContact(orgId, contactId)` → upcoming (`status NOT IN (cancelled,failed)`, `startsAt >= now`) ordered `startsAt asc`.
- 0 results → `fail("NO_UPCOMING_BOOKING", … , { retryable:false, modelRemediation:"Tell the lead we don't see an upcoming appointment and offer to book one." })`.
- ≥1 → operate on the **soonest**, optionally narrowed by the model-supplied `service` (verified against the contact's own bookings, so the narrow can't reach another contact). Multi-booking disambiguation beyond "soonest + service" is a documented follow-up.

**Reschedule flow** (mirror booking.create's provider-first → persist pattern):

1. resolve provider; resolve target booking from `ctx.contactId`.
2. `provider.rescheduleBooking(booking.calendarEventId, newSlot)`.
3. persist via new `BookingStore.reschedule(orgId, bookingId, {startsAt,endsAt})` → updates `startsAt`/`endsAt`, `rescheduleCount: { increment: 1 }`, `rescheduledAt: now`.
4. on provider/persist failure → best-effort + `failureHandler` + `fail(...)`. `ok({ bookingId, status:"rescheduled", startsAt, endsAt })`.

**Cancel flow:** resolve target → `provider.cancelBooking(booking.calendarEventId)` → `BookingStore.cancel(orgId, bookingId)` sets `status:"cancelled"` → `ok({ bookingId, status:"cancelled" })`. (Cancelling frees the slot for the overlap guard automatically, since `cancelled` is excluded.)

**No outbox events for reschedule/cancel** — deliberately. A reschedule changes `Booking.startsAt`, which `findUpcomingConfirmed` (the reminder consumer) reads directly; a cancel sets `status:"cancelled"`, which that query already excludes. Emitting `booking.rescheduled`/`booking.cancelled` events would be **producers with no consumer** — the exact "built-but-unwired" anti-pattern this audit is correcting. The durable row update is the complete, consumed change. (Only `booking.create` keeps its `"booked"` outbox event, which has a live consumer: conversion attribution.)

**Stage interaction:** a cancel does **not** auto-regress the opportunity stage in v1 (the lead may rebook; regressing is a separate product decision) — documented as out-of-scope. A reschedule keeps the opportunity at `booked`.

**SKILL.md Phase-5:** add a "Reschedule or cancel an existing appointment" section instructing Alex to call `calendar-book.booking.reschedule` / `booking.cancel` (never `escalate`) for appointment changes, confirm the resolved appointment back to the lead by service+date, and re-offer slots if the lead is unsure.

### G. Counters (co-emitted)

Add to `telemetry/metrics.ts` (the surface PR-A established, consumed via `getMetrics()`), registered in **both** `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts` (dual-prom registration, per `feedback_switchboard_metrics_dual_prom_constructor`):
`bookingConfirmed{orgId}`, `bookingFailed{orgId,reason}`, `bookingStageAdvanced{orgId}`, `bookingSlotConflict{orgId}`, `bookingReschedule{orgId}`, `bookingCancel{orgId}`. Each is incremented at its fix site in the same diff.

### H. Eval regression net (must bite)

The eval grades over `outcome.toolCalls` from `mock-tools`. Today the mock `booking.create` always returns success and is stateless, so the booking bugs can't bite. Changes:

1. **`mock-tools.ts`:** add `booking.reschedule` + `booking.cancel` recording ops (so Alex _can_ reschedule instead of escalating); make `booking.create` **param-aware/stateful** via the existing `calls` closure — return `fail("DUPLICATE_BOOKING", …)` on a second identical `(contactId,service,slotStart)` and `fail("SLOT_TAKEN", …, {retryable:true})` for a sentinel slot, so a "books, fails, retries" fixture observes a real failure.
2. **Fixtures:**
   - **Reschedule** — strengthen `post-sg-hifu-reschedule` (already `forbiddenTools:["escalate"]`) with `expectedTools:["calendar-book"]`. _Bite:_ before PR-B Alex has no reschedule op → escalates → `missing-expected-tool:calendar-book` + `forbidden-tool-called:escalate` → FAIL; after → reschedules via `calendar-book`, no escalate → PASS. Add a `cancel` fixture (`post-…-cancel`, `forbiddenTools:["escalate"]`).
   - **Duplicate-booking** — a new `gen-booking`/`gen-tool-error` fixture where the lead re-attempts a just-taken slot; mock returns `DUPLICATE_BOOKING`/`SLOT_TAKEN`; oracle/judge assert Alex re-offers and **does not fabricate** a confirmation (`mustNot:["fabricate a confirmed booking"]`, `forbiddenTools:[]` clean), not a phantom "all set".
   - **Governed booking close (pending)** — a fixture whose `booking.create` the mock returns as `pending_approval` (via a sentinel param/slot, since the eval runs ungoverned); judge asserts Alex uses the pending prose ("team will confirm shortly") and **does not** say "you're all set" and **does not** escalate. Validates E.
3. **Baseline:** add the new scenarios to `baseline.json` (else `score.ts:78-84` skips them from the regression gate). Keep the deterministic oracle gate in the **blocking** vitest step; the live scored run remains `continue-on-error`.
4. **Bite verification (red-team):** (a) run the live eval locally with the `.env` `ANTHROPIC_API_KEY` on the two fixtures on this branch (expect PASS) and on a stashed pre-fix state (expect FAIL); (b) a deterministic `oracle.test`/`run-conversation` simulation feeding synthetic `toolCalls` (`[escalate]` → fail; `[calendar-book]` → pass) so the bite is also provable without credits.

**CI gotcha:** the four eval jobs share `evals/vitest.config.ts` and each runs an identical build line. We add **no new package import** to any alex `__tests__` (we only edit fixtures + `mock-tools` + extend existing oracle assertions), so the four build lines need no change. We do **not** touch the claim-classifier baseline (its job is RED on main during bake #631 — pre-existing, not ours).

---

## 5. Data model & migration

- **Schema:** remove one `@@unique` line from `Booking` (B). No new columns (`rescheduleCount`/`rescheduledAt`/`status` already exist). No `governanceSettings` change (Decision #2). **One migration**, hand-authored raw SQL (no TTY: `migrate diff --script` style), committed in the same commit as the schema edit; `pnpm db:check-drift` must pass.
- **Seed:** no change required (pilot is already `autonomous`).

## 6. Architecture / invariant compliance

- _Mutating actions via `PlatformIngress.submit()`_: booking/reschedule/cancel are skill-tool operations invoked **inside** the submit→SkillMode→executor path; unchanged. No new mutating bypass.
- _Approval is lifecycle state_: governance still decides park/auto-approve via the existing `GovernanceHook`; we add no route-owned approval side effect. The stage advance is a server-side consequence of a confirmed booking, not a route side effect.
- _Tools idempotent_: stage advance (monotonic no-throw), partial-unique + overlap (dedup), reschedule/cancel resolved from `ctx.contactId`.
- _Surface-agnostic backend_: all logic in `schemas`/`db`/`core`; `core` imports only `schemas` (the `SlotConflictError` lives in `schemas`); no UI references.
- _Layers_: `schemas`(1) ← `db`(4)/`core`(3) ← `evals`/`apps`(5). No `core → db` import.

## 7. Testing strategy

- **db (mocked Prisma):** partial-index behavior is covered by the migration + a store test that a `failed` row no longer blocks `create`; overlap → `BookingSlotConflictError`; `findUpcomingByContact`/`reschedule`/`cancel` method tests.
- **core (mocked stores/provider):** stage advance runs in the confirm-tx (assert `tx.opportunity.updateMany` called with the monotonic `notIn` guard); stage-write count-0 does NOT fail the booking; `SLOT_TAKEN` retryable mapping; orphan compensation calls `provider.cancelBooking` on confirm-failure; reschedule/cancel resolve from `ctx.contactId`, reject model-supplied contact, handle 0/1/many bookings; counters increment.
- **evals:** fixtures well-formed (blocking vitest); mock statefulness unit-tested; bite verified live + deterministically.
- **Full gate:** `pnpm build && typecheck && test && format:check && lint` + `pnpm --filter @switchboard/eval-alex-conversation typecheck` + `pnpm db:check-drift`. Known noise to ignore: the `prisma-work-trace-store-integrity` pg_advisory flake; the classifier eval RED on main (#631).

## 8. Risks & mitigations

| Risk                                                            | Mitigation                                                                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Co-committed stage advance couples booking-confirm to opp write | `updateMany` no-throw + guaranteed-existing opp; only infra failure (which correctly fails the booking) can abort. Atomic is the desired consistency.                   |
| Advisory-lock contention / test reachability                    | Per-org key (negligible contention at pilot scale); unit tests mock Prisma; lock matches the in-repo ledger precedent.                                                  |
| Partial-index drift turns `db:check-drift` red                  | Exact CreatorIdentity precedent (schema drops `@@unique`, raw SQL holds partial); verified `check-prisma-drift.sh` uses datamodel diff which can't see partial indexes. |
| `calendar-book.ts` exceeds the 600-line arch error              | Extract reschedule/cancel into `calendar-reschedule.ts`.                                                                                                                |
| Eval fixtures don't actually bite                               | Make the mock stateful + add reschedule ops; verify bite live + deterministically before claiming done.                                                                 |
| Reschedule cancels the wrong booking                            | Resolve only from `ctx.contactId` (ownership-scoped) + soonest + optional verified `service` narrow; confirm by service+date back to the lead.                          |

## 9. Acceptance (maps to the user's bar)

1. `booking.create` idempotently advances the opportunity → `booked` without surfacing stage-write failures as booking failures. ✅ (A)
2. A failed booking no longer blocks re-booking the same slot. ✅ (B)
3. Confirmation prose branches `ok` / `pending_approval` / `failed`. ✅ (E)
4. Double-book guarded → retryable re-offer. ✅ (C)
5. A reschedule/cancel tool resolves from trusted `ctx.contactId` through the same governed path. ✅ (F)
6. Duplicate-booking + reschedule regression fixtures added to the now-faithful eval and red-team-verified to bite. ✅ (H)
7. Counters co-emitted with their fixes. ✅ (G)
8. Full local gate green (noting the pre-existing classifier flake + pg_advisory integration flake); PR to `main`, **no auto-merge**.
