# Invariant-Guard Ledger (the guard ratchet backlog)

Status: SEED (G1-G8 worked rows only). Slice 0 completes the full classification of all 112 lessons.
Date: 2026-06-27
Purpose: the durable, living backlog the Invariant-Guard Loop consumes. One row per durable lesson
or Core Invariant, tracking whether an executable guard exists. Driver: `.claude/invariant-guard-loop.md`.
Design: `docs/superpowers/specs/2026-06-27-invariant-guard-loop-design.md`.

## How this ledger works

- This is a LIVING backlog, not a frozen plan (the spec is the frozen part). It is allowed to change
  on `main` as guards land.
- **Slice 0** runs first and lands the initial full classification of all 112 `feedback_*.md` plus
  the `CLAUDE.md` Core Invariants and `docs/DOCTRINE.md` as its own focused PR. Until slice 0 runs,
  this file holds only the seed rows below.
- **Each guard slice** thereafter flips its own row to `guarded` (recording the guard path and
  `guard-covers`) INSIDE the same PR that adds the guard. The row-flip is atomic with the guard that
  justifies it, so `main` always reflects reality and there is no separate per-run ledger-churn commit.
- **Sibling rows** are new rows in this same ledger, each linking back to its parent id (e.g. a
  parent `G1` spawns `G1-S1`). The parent holds `status = sibling-open` until its siblings land.
- The loop never selects an `operational-skip` row, and never builds a guard for a row already
  `guarded` (it confirms the existing guard covers the specific case, then moves on).

## Row schema

```
| id | lesson (feedback_*.md) | invariant predicate (1 line) | blast-radius | guard-type | status | guard location | guard-covers (sites + known gaps) | siblings |
```

- `blast-radius`: Crit | High | Med | Low
- `guard-type`: arch | lint | test | ci | type | n-a
- `status`: unguarded | guarded | sibling-open | operational-skip
- `guard location`: path of the guard once written; for an `already-guarded` row, the existing guard
  plus the test `file:line` that covers the SPECIFIC regression case (not merely that some test exists).
- `guard-covers`: the sites the guard actually covers, and any known-uncovered sibling sites.
- `siblings`: ids of sibling-fix rows this lesson spawned (`-` if none).

## Bucket counts

TO BE COMPLETED BY SLICE 0 (do not fabricate; the seed is partial):

- already-guarded: TBD by slice 0
- guardable-unguarded: TBD by slice 0 (read-only sample during direction-confirmation expects ~40 to 55 of 112)
- operational-skip: TBD by slice 0

No silent cap: slice 0 records the count in each bucket so coverage is honest and the
`operational-skip` set is auditable rather than quietly dropped.

## Seed rows (worked examples; full schema)

| id | lesson | invariant predicate (1 line) | blast | guard-type | status | guard location | guard-covers | siblings |
|----|--------|------------------------------|-------|------------|--------|----------------|--------------|----------|
| G1 | `feedback_consent_status_revoked_masking` | `deriveConsentStatus` checks revoked BEFORE the null-jurisdiction short-circuit; the calendar-book consent gate reads the resolved non-null jurisdiction | Crit | test | unguarded | - | - | calendar-book-consent (file as `G1-S1` at run; known regulated sibling) |
| G2 | `feedback_governed_dispatch_check_full_submit_response` | every governed-dispatch caller treats `outcome !== "completed"` as failure, never `approvalRequired` alone | Crit | test | unguarded | - | - | - (type-level exhaustiveness is a stretch goal) |
| G3 | `feedback_reaper_freeing_slot_needs_guarded_claimant` | every re-claim path for a freed resource is a status compare-and-set (`updateMany` with a status predicate), not an id-only update | High | test | unguarded | - | - | - |
| G4 | `feedback_messaging_optin_is_platform_not_marketing_consent` | proactive sends gate via `evaluateProactiveSendEligibility` (PDPA-first), never on `messagingOptIn` | Crit | test | unguarded | - | - | - |
| G5 | `feedback_next_public_dynamic_env_not_inlined` | no computed-member `process.env[var]` read in dashboard client code (browser bundle) | Med | lint | guarded | `.eslintrc.json` overrides + `scripts/check-no-dynamic-public-env.ts` (PR #1003) | dashboard client browser bundle | - |
| G6 | `feedback_allowed_triggers_not_a_public_edge_gate` | auto-exec-only intents are gated by `SERVICE_ONLY_INGRESS_INTENTS`, not by `allowedTriggers` | Crit | test | unguarded | - | - | - |
| G7 | `feedback_new_mutating_route_needs_route_allowlist` | a new mutating route must appear in `.agent/tools/route-allowlist.yaml` | High | ci | guarded | `scripts/local-verify-fast.ts` -> `.agent/tools/check-routes` | all mutating routes (allowlist-enforced) | - |
| G8 | `feedback_no_em_dashes` | avoid em-dashes (an agent writing-style preference, not a code invariant) | Low | n-a | operational-skip | - | - | - |

Notes on the seed:
- G5 and G7 are deliberately included as `already-guarded` examples (both surfaced during
  direction-confirmation). The loop's first action on each is to open the existing guard, confirm it
  covers the specific case, and leave the row `guarded`, never building a redundant guard.
- G8 is an `operational-skip` example: a writing-style preference, not a code invariant.
- G1 carries a known regulated sibling (the calendar-book consent gate). Under the severity tier the
  loop will fix that sibling before anything lands (or open a tight sibling-fix slice `G1-S1`) and
  surface, because it touches a merge-stop glob (consent).

## Slice 0 instructions (the bootstrap triage)

1. Read-only Explore fan-out (read-only is mandatory per the driver's FAN-OUT SAFETY rule) over all
   112 `feedback_*.md` at `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/`, plus
   the `CLAUDE.md` Core Invariants and `docs/DOCTRINE.md`.
2. Classify each lesson into exactly one bucket:
   - `already-guarded`: an existing test / lint rule / `arch-check` assertion / `local-verify-fast`
     check / commitlint rule already fails on a regression of THIS SPECIFIC invariant. The bar is
     coverage of the specific case, not mere test existence. Open the candidate guard and confirm it
     would go red on the lesson's bad state; record the guard path + the covering test `file:line`.
   - `guardable-unguarded`: a real code invariant with no mechanical guard. This is the work-list.
   - `operational-skip`: an agent-behavior or process lesson, not a code invariant (record a one-line
     reason).
3. Write one ledger row per lesson in the full schema, set the blast-radius per the rubric below, and
   fill the bucket counts (no silent cap).
4. Commit the completed classification as its own focused PR on `main` before any guard slice runs.

## Prioritization rubric

Rank by **blast-radius x regression-likelihood x not-already-guarded**. The loop always takes the
top `unguarded` row; `operational-skip` rows are never selected.

- **Blast-radius** (reusing the merge-stop glob taxonomy): regulated / money / auth / governance /
  consent / PDPA (Crit) > data-integrity / idempotency / tenant-isolation (High) > decision-engine
  correctness (Med) > dev-ergonomics / CI hygiene (Low).
- **Regression-likelihood**: a fix that lives in exactly one place, on a hot-change path, with known
  siblings, regresses most easily and ranks up.
