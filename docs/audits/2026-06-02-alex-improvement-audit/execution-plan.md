# Alex Improvement — Execution Plan (review-incorporated)

**Status:** supersedes the "Ship Tier 0 as one focused PR" framing in [`findings.md`](./findings.md). This plan folds in the 2026-06-02 critical review of the audit and the grounding from [`intent-coverage-matrix.md`](./intent-coverage-matrix.md).

## Reframe

> From: "Ship Tier 0 as one focused PR."
> To: **"Ship a pre-launch correctness stack of small, domain-scoped PRs — each with a production-path regression test — then freeze feature work until eval parity and minimal launch observability are real."**

The product risk is not that Alex lacks features. It's that **Alex appears governed, grounded, and measurable while the live path doesn't actually use those systems.** The audit proves that pattern; this plan fixes it without re-creating it.

## The durable invariant (the fix for the *class*, not the instances)

Adopt and enforce:

> **If a capability is advertised, seeded, exported, or tested, there must be at least one production-path integration test proving it runs on the live path.**

Most audit findings are the same shape — producer and consumer both exist, the live runtime never joins them — and the green eval can't see the seam. A per-capability live-path test is what stops new fake safety rails from accruing. Every PR below adds the live-path test for the capability it touches.

## Why a keystone PR leads (refinement of the three-PR proposal)

The review proposed PR A (live-turn correctness) / PR B (persona + eval parity) / PR C (booking lifecycle). One refinement: **the eval-faithfulness piece of "PR B" is the regression net that makes A and C safe to ship**, so it leads as **PR-0**. If correctness fixes land against today's unfaithful eval (bypasses `resolvePersona`, router-off, hookless, mocked tools, non-deterministic context-blind judge), we're back to green-but-broken. The matrix makes this concrete: three booking fixtures already *encode* the booking bugs but pass because the mock doesn't reproduce the real slot/governance path.

Likewise, **observability is co-emitted, not a separate workstream**: half the launch counters (raw-error-fallback count, empty-facts count, slot-zero-result count) only exist once their fix exists, so each counter ships inside the same diff as its fix. Only the tiny aggregation/alert surface is standalone (folded into PR-0).

## The stack

### PR-0 — Faithful eval + launch counters (keystone; lands first)
- Route the eval persona through the **production `resolvePersona`** (kill the `run-conversation.ts:174` bypass).
- Pin the **judge to `temperature:0`** (+ add the judge model id to the baseline stamp).
- Make the booking/full-arc fixtures exercise the **real slot-generator + governance path** (or a mock that faithfully reproduces them), so the existing booking fixtures become a real net.
- Stand up **minimal launch counters + one alert surface**: escalation-rate by reason, raw-error-fallback count, booking success/failure, empty-BusinessFacts count, slot-query zero-result, denied/gated-turn count, first-response latency.
- Codify the **production-path-integration-test invariant** (a pattern + the first instance) so subsequent PRs inherit it.
- *Acceptance:* re-captured deterministic baseline; the counters emit on a seeded local run; the invariant test fails if a capability is wired out.

### PR-A — Live-turn correctness
- **BusinessFacts source-of-truth** decision + unify producer/consumer + seed a real medspa blob + **backfill** existing `inputConfig.businessFacts` + a **non-empty readiness check** at activation. *(This is the one item with a genuine design decision — see Open decisions.)*
- **`SlotQuerySchema.parse()`** at the tool boundary (+ a defensive non-finite-step guard in the slot generator) so availability stops collapsing to ~1 slot/day.
- **Current-date anchor** injected in the **clinic/org timezone** (not server/browser/SG-default), referenced in Phase 4 + booking confirmation copy.
- **Raw-error fallback**: a failed SkillMode turn never reaches the lead; send the neutral fallback + persist a suppressed marker + keep the true error in the trace.
- **Live temperature pin** (~0.4–0.5) in the adapter/bootstrap, router-independent.
- **Persona resolver**: tolerate object/record criteria + template-engine optional-field grace, so the seeded shape neither crashes nor degrades.
- *Each fix co-emits its counter + ships a regression fixture (now caught by PR-0's faithful harness).*

### PR-B — Booking lifecycle integrity + reschedule
- **`booking.create` deterministically advances** the opportunity to `booked` (server-side, idempotent, doesn't surface a stage-write failure as a booking failure).
- **Failed booking row** no longer permanently blocks re-booking the same slot.
- **Confirmation prose branches** on `ok` / `pending_approval` / `failed` (no false "you're all set" against a parked tool result).
- **Google-path double-book guard** (overlap check on the durable write, mapped to a retryable re-offer).
- **Reschedule/cancel tool** — *promoted from "later" to launch-coverage* by the matrix (a `forbiddenTools:[escalate]` post-booking fixture Alex can't satisfy today). Resolve the booking from trusted `ctx.contactId`, route through the same governance posture as `booking.create`.
- *Adds duplicate-booking + reschedule regression coverage.*

### Freeze gate
**No feature/learning-loop PR past this line until PR-0/A/B are merged and the counters are live.** Then, *before* the planned classifier `off→enforce` and router flips:
- Claim-classifier **confidence floor** (de-risks the flip; root of over-flag #673).
- **Over-escalation narrowing** + negation guards + self-disclosed-minor trigger.
- **Router-on eval variant** (so the tier-downgrade is no longer invisible) + re-key tiering on conversation depth.
- **`TracePersistenceHook` + cache-token telemetry** (the prerequisite to validate the router flip / lock the baseline against real traffic).
- **Timeout/abort** of in-flight calls + explicit retries; reconsider the 30s whole-conversation budget.

### Then — product leverage
Rich handoff transcript context · operator preview/sandbox · circuit-breaker/blast-radius wiring · ContactMutex/idempotency-key.

### Later — explicitly deferred
Trust-score ramp (wire end-to-end *or delete the dead ledger*) · learning-loop closure (extraction-on-booking + durable + decay-on-use + consolidation) · per-pattern lift proof · A/B/experiment framework · data-retention / erasure policy.

## Pre-pilot acceptance bar (must all be true before a real lead)

1. BusinessFacts source-of-truth unified + seeded/backfilled + readiness-checked.
2. Slot schema parse/defaults (real multi-slot availability).
3. Current-date anchor in org timezone.
4. Raw internal error never reaches a lead.
5. Persona resolution handles the seeded shape **and** the eval uses the same path.
6. Live temperature pinned.
7. Booking confirmation branches (confirmed / pending-approval / failed).
8. Successful booking deterministically advances the opportunity.
9. Self-disclosed-minor escalation.
10. Minimal launch counters + alerts for escalation / error / booking / empty-facts.

## Matrix-driven adjustments

- **Reschedule/cancel promoted** to PR-B (launch-coverage, not later).
- **New fixtures** to close coverage gaps the matrix exposed: factual Q&A (the assumed-highest-frequency, currently under-tested), reschedule/cancel, self-disclosed-minor, governed booking-close.
- **Frequency claim tempered:** "BusinessFacts = highest-frequency inbound" is a high-confidence *assumption*, to be confirmed against the first week of pilot logs — the eval is hard-case-weighted, not frequency-weighted.

## Open decisions (need a human call before coding the relevant PR)

1. **BusinessFacts canonical table + backfill direction.** Which table wins (`BusinessConfig.config` vs `AgentDeployment.inputConfig.businessFacts`), does the dashboard writer change, and do we backfill existing orgs? This ripples to the seed, the readiness check, and the operator UI — it's the one Tier-0 item that isn't purely mechanical.
2. **Booking auto-approve posture for pilots.** Do trusted pilot clinics get a booking-scoped auto-approve (close in-conversation), or do all bookings park for approval at launch? Affects PR-B's governance dial.
3. **Pilot interaction scope.** Do early pilots include post-booking interactions (reschedule/late/makeup)? If yes (likely the moment anyone books), reschedule/cancel is firmly in the pre-pilot bar.
