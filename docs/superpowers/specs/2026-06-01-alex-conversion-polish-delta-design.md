# Alex Better-Than-Human Conversion — Delta Spec

- **Date:** 2026-06-01
- **Status:** Approved with tightening (review 2026-06-01) — ready for implementation plan
- **Branch (spec):** `docs/alex-conversion-polish`
- **Builds on (already merged to `main`):** #786 governed follow-up · #783 + #784 ModelRouter + stage-aware tiering · #787 conversation-baseline lock · #788 spendApprovalThreshold enforcement
- **One-liner:** Close the remaining "better-than-human" gap on top of the shipped governed follow-up — extend it into a 3-touch cadence, add appointment reminders, sharpen compliant closing, and make the success metric honest (booked→showed). Two already-built levers ship as an ops checklist.

---

## 0. Reconciliation — what already shipped (the new floor)

A prior plan treated the follow-up loop as greenfield. It isn't. Verified against current `origin/main`:

| Shipped | What it gives us | Consequence for this spec |
|---|---|---|
| **#786** `ScheduledFollowUp` queue + `schedule-follow-up` tool + governed `conversation.followup.send` workflow + dispatch cron + `evaluateProactiveSendEligibility` | Alex can schedule **one** governed re-engagement; a cron sends it when consent/window/template allow; fail-closed skip reasons | Cadence (Delta A) **extends** this; reminders (Delta B) **clone** its send path |
| **#783 + #784** ModelRouter behind `ALEX_MODEL_ROUTER_ENABLED` (default off) + stage-aware tiering (fear→Opus, objection/closing→Sonnet) | Smarter model on hard turns, prod byte-identical when off, "only raises" | Becomes an **ops flip** (§6), not a build |
| **#787** Alex conversation baseline locked + judge fix | The router-flip regression risk is already resolved | Removes the "confirm baseline" caveat |
| **#788** `spendApprovalThreshold` enforced | Autonomy lever is real, not stored-and-ignored | Background; not in scope here |

**Corrected premise (load-bearing):** `PlatformIngress.submit()` does **not** fire the consent / WhatsApp-window gates — those are `afterSkill` hooks the interactive executor never runs; live consent runs in `ChannelGateway` egress. #786 solved this with an explicit **`evaluateProactiveSendEligibility`** helper applied at the mutation site. **This spec treats that helper as canonical** — every new proactive send (cadence touches, reminders) routes through it. We do **not** reintroduce the "submit auto-gates" assumption.

**Preflight (already satisfied by #786 — no PR-0 needed):** the cron-initiated send uses actor `{ id: "system", type: "system" }`, seeded at bootstrap by `ensureSystemIdentity()` (IdentitySpec id `"default"`); the cron-identity silent-no-op (caught in #786's own review) is retired. New sends in this spec **reuse that exact actor + submit closure** (`apps/api/src/services/workflows/followup-send-request.ts:20`).

---

## 1. Scope

**Build (4 deltas):** A) multi-touch cadence · B) appointment reminders · C) compliant closing playbook · D) honest booked→showed metric.

**Ops checklist (flips, not builds — §6):** enable ModelRouter; set claim-classifier to `observe`.

**Confirmed product decisions (carried):** auto-send, governed (no per-send human gate; the deterministic eligibility check is the control); **3-touch cadence at +2d / +5d / +12d**, then stop.

**Out of scope (YAGNI):** deposits/payments; a "paid" metric (`LifecycleRevenueEvent` has no logging UI — infra, not polish); claim-classifier `enforce` mode (over-flags conversational turns; bake ends ~2026-06-06); auto-scheduling a follow-up for every dormant thread (#786 non-goal — Alex decides via the tool); channels other than WhatsApp; `enforce` of `deterministicGate`.

---

## 2. Delta A — Multi-touch cadence (extends #786)

**Goal:** turn the shipped one-and-done into a fixed **+2d / +5d / +12d** cadence, then stop. Autonomous, governed, reusing the shipped send path.

**Shipped contracts (verified):**
- Producer `packages/core/src/skill-runtime/tools/schedule-follow-up.ts` — op `followup.schedule`, `reason` enum, `delay` enum (`in_1_day|in_3_days|in_1_week` → 1/3/7 d), `dueAt = now + delay`, `dedupeKey = followup:${orgId}:${contactId}:${dueAt.slice(0,10)}`. Rate-guard `findPendingForContact` returns `already_scheduled` if **any** pending row exists for the contact.
- Model `ScheduledFollowUp` (`schema.prisma:2034`): has `dueAt,status,attempts,dedupeKey,sentAt,nextRetryAt`; status `pending|sent|skipped|failed|cancelled`. **No `touchNumber`, no `cadenceId`** on the model (the `cadenceId` that exists is the unrelated `ConversationThread.followUpSchedule` JSON). Store (`scheduled-follow-up-store.ts`): `create / findPendingForContact / findDue / markSent / markSkipped / markFailed` (no `claim`; dedupe is the `@unique` key + Inngest `step.run` memoization). `MAX_ATTEMPTS=3` = send-retries per touch.
- Dispatch `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts` (`*/15`) → `findDue(now,100)` → per row submit `conversation.followup.send` → `markSent|markSkipped|markFailed(+backoff)`.

**Design — consumer-driven (Option A), recommended:** on a **successful send** (`outputs.sent === true`), if `touchNumber < 3`, the dispatch creates the next touch row directly via `store.create`. Producer-driven (enqueue all 3 up front) is rejected: it trips `findPendingForContact` at producer time. Dispatch-side `create` does **not** consult that guard, so no relaxing is needed.

**Changes:**
1. **Schema (1 migration, same commit):** add `touchNumber Int @default(1)` and `cadenceId String?` (= touch-1 row id; links the episode for audit + lets the operator UI show "in cadence", **and** distinguishes cadence rows from legacy one-and-done — see #6). Hand-write migration; `pnpm db:check-drift`; index names ≤63 chars. *(No `coldAnchorAt` — the send-relative timing in #2 makes it unnecessary; we reuse the existing `sentAt`.)*
2. **Send-relative cadence (compression-safe — review fix).** Anchoring touches 2/3 to a fixed cold timestamp is unsafe: if touch 1 is delayed (retry, downtime, template-approval lag), `cold+5d` may already be in the past, firing touch 2 back-to-back. Instead:
   - **Touch 1** `dueAt = now + 2d` (set at schedule time).
   - **Touch 2** scheduled only *after* touch 1 sends: `dueAt = sentAt(touch1) + 3d`.
   - **Touch 3** scheduled only *after* touch 2 sends: `dueAt = sentAt(touch2) + 7d`.
   - **Minimum-gap floor:** never schedule the next touch < 48 h out.
   This preserves the intended **+2/+5/+12** shape under normal operation while making delay *stretch* the cadence, never *compress* it. (`NEXT_TOUCH_GAP_DAYS = {1: 3, 2: 7}`; the `delay` enum is superseded for cadenced sends — §9.)
3. **Producer:** when scheduling a cadenced follow-up, set `touchNumber=1`, `dueAt = now + 2d`, and `cadenceId` = the row's own id (populated post-create).
4. **Dispatch:** new injected dep `scheduleNextTouch(row)` — after a **successful** `markSent`, **and only if `row.cadenceId` is non-null** (legacy #786 rows have null `cadenceId` and are never advanced — see #6), if `row.touchNumber < MAX_CADENCE_TOUCHES`, `store.create` the next touch: `touchNumber+1`, same `cadenceId`, `dueAt = max(row.sentAt + NEXT_TOUCH_GAP_DAYS[touchNumber]·d, now + 48h)`, `dedupeKey = followup:${org}:${contact}:${dueAt.slice(0,10)}:t${touchNumber+1}`. **Stop** at `touchNumber >= 3`.
5. **Skip taxonomy — never let an inert-template state burn the cadence (review fix, load-bearing).** A `skipped` outcome must be classified, because the promise is "never drop *eligible* leads":
   - **Durable ineligibility → terminal `skipped`, cadence ends:** `consent_revoked`, `consent_pending`/`no_consent`, `no_optin`, `marketing_blocked`, `unsupported_channel`/`missing_contact_channel` (and any disqualified/opt-out state). Retrying can't change these.
   - **Activation/transient → keep the row re-evaluable, do NOT advance, do NOT terminally end:** `template_not_approved`, `no_template`. Pre-Meta-approval, *every* lead would otherwise burn touch 1 as a terminal skip and lose its cadence forever — so these stay pending (set `nextRetryAt = now + 1h`, a relaxed re-eval interval) and send once the template flips to `approved`. Apply a **max-age cap** (configurable, e.g. 14 d overdue → terminal `skipped` reason `stale_unsent`) so a long-cold lead isn't messaged weeks late.
   - **Transient send/provider failure** → existing `markFailed` retry/backoff (unchanged from #786).
   Cadence advances **only** on `sent:true`. (This requires the dispatch's skip handling to branch on `skipReason` class — a real but small change to #786's result mapping.)
6. **Naming + legacy:** rename the store's `MAX_ATTEMPTS` → `MAX_SEND_ATTEMPTS`; add `MAX_CADENCE_TOUCHES = 3`. Cadence position is the integer `touchNumber` column — no string-parsing. **Legacy rows** created before this migration (`cadenceId` null) are treated as **one-and-done; no automatic backfill** into the cadence. The `:t${touchNumber}` dedupe suffix is collision-proof even if two touches land on the same calendar day (DST).

**Tests:** dispatch — on `sent`+`touchNumber 1` → creates touch 2 at `sentAt+3d` (floored ≥48h) with correct `touchNumber`/`cadenceId`; `touchNumber 3` → no touch 4; **durable** skip (`consent_revoked`) → terminal, no next touch; **activation** skip (`template_not_approved`) → row stays re-evaluable, no advance, not terminal; `failed` → retry/backoff, no advance; **legacy** row (`cadenceId` null) → never advances. Store — `create` with `touchNumber`/`cadenceId` round-trips; `findPendingForContact` null after touch-1 `sent`. Integration — full 1→2→3 chain under normal timing yields ≈ +2/+5/+12. Mock Prisma (CI has no Postgres); `db:check-drift` for the migration.

**Effort: M.** One migration, ~15 lines store, ~30 lines dispatch, tests. Producer, send workflow, eligibility helper, bootstrap wiring untouched.

---

## 3. Delta B — Appointment reminders (near-clone of #786 send path)

**Goal:** cut no-shows with a governed reminder ~24 h before a confirmed appointment, reusing the proactive-send pipeline.

**Shipped contracts (verified):**
- Templates `whatsapp-registry.ts:95,111`: `appointment_reminder_{sg,my}_v1`, `intentClass:"appointment-reminder"`, **`templateCategory:"utility"`** (so the marketing-block + `allowMarketingTemplate` flag are irrelevant — utility templates clear that gate), `approvalStatus:"draft"`, **4 vars** `lead_name, business_name, date, time`.
- `Booking` (`schema.prisma:1902`): `startsAt`, `status` (`pending_confirmation|confirmed|cancelled|no_show|completed|failed`), `contactId/organizationId`, index `(organizationId, startsAt)`. **No `reminderSentAt`.** `PrismaBookingStore` has `listByDate` (single day) and `countConfirmed` — **no window query.**
- No slot **hold/reserve** anywhere (`CalendarProvider` = `listAvailableSlots|createBooking|cancelBooking|rescheduleBooking|getBooking|healthCheck`). → confirms the Delta C "hold a slot" fix.

**Changes:**
1. **Booking query:** add `PrismaBookingStore.findUpcomingConfirmed(windowStart, windowEnd)` → `status="confirmed", startsAt ∈ [start,end)`, cross-org (uses the existing `(organizationId, startsAt)` index). Returns `{id, organizationId, contactId, startsAt, conversationThreadId?}`.
2. **Idempotency = a `ScheduledReminder` queue** (mirror `ScheduledFollowUp`, house pattern from #786 — carries `status`/`skipReason`/retry state, keeps delivery state out of the `Booking` entity). **Dedupe `@unique` on `reminder:${bookingId}:${startsAt.toISOString()}`**, with `bookingId` *indexed but not unique* — **reschedule-safe (review fix):** if a booking moves to a new `startsAt`, the key changes and a fresh reminder fires; `bookingId @unique` would silently suppress the reminder for the new time. New: `packages/schemas/scheduled-reminder.ts`, `packages/core/src/scheduled-reminder/scheduled-reminder-store.ts` (interface), `packages/db/.../prisma-scheduled-reminder-store.ts` (+ migration, `db:check-drift`).
3. **Reminder cron** `apps/api/src/services/cron/appointment-reminder-dispatch.ts` — hourly (`0 * * * *`); `findUpcomingConfirmed(now+23h, now+25h)` (2 h tolerance for jitter); for each, `create` a `ScheduledReminder` (skip if a row with this `dedupeKey` already exists) then submit the send; map result → `markSent|markSkipped|markFailed`.
4. **Send (decided: dedicated clone, not generalized).** A thin `conversation.reminder.send` workflow cloned from `conversation-followup-send-workflow.ts`, reusing `evaluateProactiveSendEligibility` with `intentClass:"appointment-reminder"`. It differs enough (template intent, 4 vars, booking lookup, tz formatting, idempotency entity, audit copy) that generalizing over two examples is premature abstraction — revisit only if a third proactive-send use case appears. Resolves `date`/`time` from `booking.startsAt` **in the clinic timezone** (org/business config; fallback `Asia/Singapore`, and log the fallback). Register in `contained-workflows.ts` (handler map + IntentRegistry, `allowedTriggers:["schedule"]`, `approvalPolicy:"none"`). Actor `{id:"system",type:"system"}`.

**Timezone (must):** `date`/`time` vars are rendered from `startsAt` in the clinic's tz, not UTC — wrong tz on a reminder is worse than none. Resolve tz from org/business config (SKILL.md default `Asia/Singapore`).

**Activation:** utility templates are `draft` → the cron soft-skips with `template_not_approved` until Meta approval (already on the launch critical path). Ships safe and inert; skip reasons are observable.

**Tests:** booking-store `findUpcomingConfirmed` (only `confirmed` in window; excludes others); cron sent/skipped/failed branches + bookingId dedup; reminder workflow eligibility-skip paths + successful 4-var send + tz formatting. Mock Prisma.

**Effort: M** (the heaviest delta — new queue + store + cron + workflow + booking query, all near-clones).

---

## 4. Delta C — Compliant closing playbook (+ eval-harness fix)

**Goal:** Alex *resolves* objections (within compliance) and *uses the shipped `follow-up` tool* on genuine deferrals, instead of deflecting and falsely promising slot holds. Doc/prompt edits + a small, necessary eval-harness sync.

**Compliance envelope (unchanged bright lines, `claim-boundaries.md` + `sg-rules.md`/`my-rules.md`):** no diagnosis, no result/timeline guarantees, no "safe for you", no before/after certainty, no superiority-without-backing, **no manufactured urgency** (operator-provided factual time-bounded copy only), no testimonials. All edits below stay inside this box.

**Edits to `skills/alex/references/medspa/objection-handling.md`:**
- **`:43` (price-comparison) — remove false slot-hold.** `"Happy to hold a slot while you look around."` → `"Happy to help you shortlist a time when you're ready."`
- **`:85` ("let me think about it") — remove false slot-hold + resolve + schedule governed follow-up.** `"I can keep a consultation slot tentatively for you…"` → surface the real hesitation with one open question; if they still defer: `"No worries. I'll check in with you in a couple of days in case things settle."` then call `follow-up.followup.schedule` (reason capturing what they were weighing). No specific-slot/reservation promise.
- **"Maybe later"** — accept without pushback, then `follow-up.followup.schedule` (light week-out touch) instead of going dark.
- **Price "too expensive"** — add a one-line emotional acknowledgment before the value reframe ("Totally fair — pricing here can vary and it's not always clear what you're paying for"), then the existing consult-clarifies-cost pivot. No discount-led open.
- **New section "Urgency: lead has a stated personal deadline"** — reflect the lead's *own* deadline honestly ("3 months is a comfortable window — first step is a consult"); never assert clinic-side scarcity. Compliant honest urgency.
- **Fear / results-skepticism** — add process-proof framing ("the consult is where the doctor looks at *your* skin and tells you what's realistic") — trust on process, not outcome promises.

**`skills/alex/SKILL.md:195`** — replace the bare "suggest a specific next step with a timeline" with: surface the concern, then call `follow-up.followup.schedule` on a genuine deferral; **do not promise a specific slot or reservation.**

**Eval-harness sync (necessary — a found gap):** `evals/alex-conversation/grade.ts:7` `ALEX_ALLOWED_TOOL_IDS` lists only the original 4 tools — **missing `follow-up` AND `delegate`** (never updated after #761/#786). Until fixed, any fixture referencing `follow-up` fails `z.enum` validation and `loadConversationFixtures` throws → breaks structural CI. Required:
- Add `"follow-up"` + `"delegate"` to `ALEX_ALLOWED_TOOL_IDS`.
- Add a `followUp` mock (op `followup.schedule`) in `mock-tools.ts` (and `delegate` if needed).
- Update `grade.test.ts:365` (exact-four-tools assertion → six).

**New eval scenarios** (append to `evals/alex-conversation/fixtures/gen-objection-time-trust.jsonl`): "let me think → resolves + schedules follow-up (SG)", "maybe later → light follow-up (MY)", "stated deadline → honest urgency, no manufactured scarcity (SG)". Oracles: `expectedTools:["follow-up"]`, `forbiddenTools:["calendar-book"]`, `expectsBooking:false`. **Judge** (`judge.ts`): add tier-2 hard rule "claims to hold/reserve/tentatively secure a slot"; add tier-3 criterion #6 "schedules a governed follow-up on a genuine deferral"; bump `JUDGE_RUBRIC_VERSION` → `judge-medspa@1.1.0`. `matrix.test.ts` bounds still hold (+3 fixtures).

**Effort: S** (doc edits + ~4 small harness edits + 3 fixtures). Note: the harness sync is code, not pure docs, but tiny.

---

## 5. Delta D — Honest booked→showed metric

**Goal:** stop counting non-bookings as wins; surface operator-confirmed show-through; rename the stale hero. No payment infra.

**Shipped contracts (verified):** `metrics-alex.ts:17` `EXCLUDE_STATUSES=["cancelled"]`; `:97` hero `kind:"tours-booked"`; `stats` is a hard 3-tuple `[Leads, Conversion, Spend]`. `MetricsSignalStore` (`metrics-types.ts:93`) has `countBookingsCreated / countConversionsByType / getMetaSpendCents` — no opportunity method. `PrismaOpportunityStore.countByStage` exists but is **not windowed**; `updatedAt` is the stage-transition timestamp (no stage-history table). `OpportunityStage` includes `"showed"` (`lifecycle.ts:15`); the operator sets it on the live pipeline kanban.

**Changes:**
1. **Exclude failed:** `EXCLUDE_STATUSES = ["cancelled", "failed"]` (one line; `"failed"` = a booking that never created — not a real appointment). *Keep `no_show` in the booked count* — a no-show *was* booked; attendance is the Showed stat's job, not the booked hero's.
2. **Store methods** (`MetricsSignalStore` + `PrismaOpportunityStore` impl): `countCurrentlyAtStageUpdatedInWindow({orgId,stage,from,to})` → `count({where:{organizationId,stage,updatedAt:{gte:from,lt:to}}})`; `latestOpportunityStageUpdatedAt({orgId,stage})` → newest `updatedAt` (coverage freshness). **Caveat (honest — review point):** `updatedAt` changes on *any* opportunity edit, not only stage transitions, so "showed in-window" is an **approximation** (an opp already at `showed`, edited later for another reason, re-enters the window). A precise version needs a stage-transition history table — **out of scope** (no longer polish). The method name is deliberately literal so no one reads it as exact.
3. **Metric builder:** fan-out `showedCount` + `boardLastUpdated`; **replace the `Conversion` stat cell with a "Showed" cell** (keeps the 3-tuple; `Conversion` stays available via the top-level `qualifiedPct`). Showed cell shows `showedCount (coverage%)` where `coverage = showed/booked`; if `boardLastUpdated === null` → `unavailable:true` (`"—"`) so a clinic that never updates the board doesn't read as poor show-through (review point #7). Add `hint?:string` to `StatCell` (or a top-level field) for "Board updated <date>"; render in `key-result.tsx`. Echo `showedCount`/`showCoverage` as top-level `MetricsViewModel` fields. **Label it "Showed (operator-confirmed)"**, not bare "Showed."
4. **Rename** `"tours-booked"` → `"appointments-booked"` across the `HeroMetric` union (core + dashboard `types.ts`) and ~22 consumer/test sites (full list in the mapping appendix); update the `agent-display.ts` label to "appointments booked."

**Observe-review query (review point #8, pairs with §6 classifier flip):** `GovernanceVerdict` model + store exist (`save/listByConversation/listByDeployment`) but no count. Add `countByDeploymentAndClaim({deploymentId, claimType→sourceGuard, action?, from, to})` → one `.count` (existing `(deploymentId, sourceGuard, decidedAt)` index covers it; no migration). This makes `observe` mode reviewable: "top flagged claim types / would-have-blocked counts over the window." **Ships as its own slice (PR-1c, with the §6 classifier flip) — not bundled into the Alex-metric PRs.**

**Tests:** metric excludes failed; Showed cell present + coverage math + unavailable path; rename consumed correctly. Store methods (mock Prisma). Verdict-count (mock Prisma).

**Effort: S** (exclude + rename + verdict-count) **+ M** (Showed stat + coverage + store methods + dashboard cell).

---

## 6. Ops checklist (flips — not core build)

Each is a config/env change with a clean rollback; no code.

1. **Enable ModelRouter** — set `ALEX_MODEL_ROUTER_ENABLED=true` (Vercel env). Built + tiered (#783/#784), baseline locked (#787), prod byte-identical when off, "only raises" tier → expected cost *reduction* (greetings/chat → Haiku; fear → Opus; objection/closing → Sonnet). Rollback: unset the flag. Risk: low.
2. **Claim-classifier → `observe`** — set `governanceConfig.claimClassifier.mode = "observe"` on the Alex deployment (JSONB sub-block, no migration; `resolveClaimClassifierConfig`). Telemetry only — writes `GovernanceVerdict` rows, **does not** mutate responses or hand off. Review with the §5 verdict-count query. **Stay off `enforce`** (over-flags conversational deferrals; bake ends ~2026-06-06). Rollback: set back to `off`. Risk: low (adds Haiku calls/turn, latency-budgeted 800 ms).
   - (Optional, separate) `deterministicGate.mode` is also `off`; out of scope here.

---

## 7. Governance & invariant compliance

- **Mutating sends through `PlatformIngress.submit()`** — cadence touches and reminders both submit (`conversation.followup.send` / `conversation.reminder.send`); the crons never POST WhatsApp directly. Scheduling rows are internal queue state (escalate-precedent side-records), not the outbound mutation.
- **`WorkTrace` canonical** — every send + recorded skip produces a WorkTrace via submit.
- **System principal** — `{id:"system",type:"system"}` (seeded `ensureSystemIdentity`, IdentitySpec `"default"`); reused verbatim, not a bespoke `system:<x>` id.
- **Fail-closed, no silent caps** — ineligible sends are `completed` no-ops with a `skipReason`; cadence stops on skip; reminders dedupe per booking. Idempotency: dedupeKey + Inngest `step.run` + submit key.
- **Layering** — store interfaces in `core`, impls in `db`; crons/workflows in `apps/api`; playbook in `skills/`; no UI refs in core/schemas/db.
- **Code basics** — ESM `.js` imports; co-located `*.test.ts`; no `console.log`/`any`; commitlint lowercase subject; file-size 400/600; migrations + `db:check-drift` in the same commit; new env vars → `scripts/env-allowlist.local-readiness.json`; db tests mock Prisma.

---

## 8. PR plan (focused, value-first)

| PR | Delta | Dep | Effort |
|---|---|---|---|
| **PR-1a** | **D** metric correctness — exclude `failed`, rename `tours-booked`→`appointments-booked` (~22 sites), tests | none | S |
| **PR-1b** | **D** operator-confirmed Showed stat + coverage + last-updated cell + store methods + dashboard render | none | M |
| **PR-1c** | governance **verdict-count** query (`countByDeploymentAndClaim`) for observe review — pairs with the §6 classifier flip, **not** the metric PRs | none | S |
| **PR-2** | **C** closing playbook + `SKILL.md` + eval-harness sync (`ALEX_ALLOWED_TOOL_IDS`, mock, judge bump, 3 fixtures) | none | S |
| **PR-3** | **A** cadence — migration (`touchNumber`/`cadenceId`) + send-relative `scheduleNextTouch` + skip taxonomy + legacy one-and-done + naming | extends #786 | M |
| **PR-4** | **B** reminders — `ScheduledReminder` queue (`bookingId`+`startsAt` dedupe) + `findUpcomingConfirmed` + hourly cron + `conversation.reminder.send` clone | reuses #786 path | M |
| **Ops** | §6 flips: `ALEX_MODEL_ROUTER_ENABLED=true`; classifier `observe` (reviewed via PR-1c) | independent | — |

PR-1a/1b/2 ship this week with zero external dependency (Alex sharper + honestly measured immediately). PR-3/PR-4 land code now; sends activate when Meta approves the (currently `draft`) re-engagement + reminder templates — and per the skip taxonomy (Delta A #5), pre-approval `template_not_approved` skips do **not** consume the cadence. Ops flips + PR-1c sequence anytime. *(Split rationale (review): the original PR-1 bundled a ~22-site rename + store methods + dashboard churn + a governance query — too review-heavy; 1a/1b/1c are independently reviewable, and the verdict query belongs with the classifier slice, not Alex metrics.)*

---

## 9. Decisions (resolved in review) + residual risks

**Resolved (2026-06-01 review):**
1. **Cadence timing** — fixed product cadence (+2/+5/+12), but touches 2/3 are **send-relative** (`sentAt + 3d`, `+7d`) with a 48 h floor, so retry/approval delay *stretches*, never *compresses* (Delta A #2).
2. **Reminder workflow** — **dedicated `conversation.reminder.send` clone**; do not generalize proactive sends until a third use case (Delta B #4).
3. **Reminder timezone** — org/business config; fallback `Asia/Singapore`, log the fallback (Delta B #4).
4. **Cadence skip semantics** — only **durable** ineligibility ends a cadence; `template_not_approved`/`no_template` are activation skips that stay re-evaluable (capped by max-age), so pre-approval leads aren't permanently dropped (Delta A #5). *This is the most important behavioral guarantee in the spec — "never drop eligible leads" must survive the draft-template window.*
5. **Legacy `ScheduledFollowUp` rows** (`cadenceId` null) — one-and-done, no backfill (Delta A #6).
6. **Reminder dedupe** — `reminder:${bookingId}:${startsAt}`, reschedule-safe (Delta B #2).

**Residual risks (don't block; verify in build):**
- **Eval `ALEX_ALLOWED_TOOL_IDS` staleness** (missing `follow-up`+`delegate` since #761/#786) — PR-2 fixes; flag in case other eval paths assumed the old 4-tool set.
- **Meta template approval (external)** — re-engagement (marketing) + reminder (utility) templates are `draft`; gates *activation*, not the code; already on the launch critical path.
- **`spendApprovalThreshold` (#788)** — out of path; message sends are not spend actions (expected clear; confirm in PR-3/4).
- **Showed-metric approximation** — `updatedAt`-windowed, operator-dependent; precise version needs stage-history (out of scope) (Delta D #2).

---

## Appendix — verified `file:line` contract index

**Cadence (A):** `skill-runtime/tools/schedule-follow-up.ts`; `scheduled-follow-up/scheduled-follow-up-store.ts`; `db/.../prisma-scheduled-follow-up-store.ts` (`MAX_ATTEMPTS:8`); `schema.prisma:2034`; `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts`; `apps/api/src/services/workflows/{conversation-followup-send-workflow,followup-send-request}.ts` (actor `:20`); `core/src/notifications/proactive-eligibility.ts:39`; bootstrap `contained-workflows.ts`, `inngest.ts`.
**Reminders (B):** `skill-runtime/templates/whatsapp-registry.ts:95,111`; `schema.prisma:1902` (`Booking`); `calendar.ts:21` (`BookingStatusSchema`), `:92` (`CalendarProvider` — no hold); `db/.../prisma-booking-store.ts:78,57`; `core/src/skill-runtime/tools/calendar-book.ts`.
**Closing (C):** `skills/alex/references/medspa/objection-handling.md:43,85`; `claim-boundaries.md`, `sg-rules.md`, `my-rules.md`; `skills/alex/SKILL.md:195` + follow-up tool note; `evals/alex-conversation/{grade.ts:7,mock-tools.ts,judge.ts,oracle.ts,__tests__/matrix.test.ts}`; fixtures `gen-objection-time-trust.jsonl`.
**Metric (D):** `agent-home/metrics-alex.ts:17,97`; `agent-home/metrics-types.ts:31,49,93`; `db/.../prisma-opportunity-store.ts:163` (`countByStage`), `:126,251` (`updatedAt`); `lifecycle.ts:15` (`"showed"`); `db/.../prisma-booking-store.ts:117` (`countExcludingStatuses`); rename sites in `apps/dashboard/.../agent-panel/lib/agent-display.ts:27` + ~20 tests; `GovernanceVerdict` `schema.prisma:1090`, store `core/src/governance/governance-verdict-store/types.ts`, impl `db/src/prisma-governance-verdict-store.ts`.
**Ops:** `.env.example:309` (`ALEX_MODEL_ROUTER_ENABLED`); `apps/api/src/bootstrap/model-router-factory.ts`; `packages/schemas/src/governance-config.ts:3,12,39` (`claimClassifier`/`deterministicGate`); hook `core/src/skill-runtime/hooks/claim-classifier.ts:82`.
