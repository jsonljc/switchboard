# Invariant-Guard Loop (the guard ratchet)

Status: design approved (brainstormed with the user 2026-06-27; SURFACE-before-merge for the driver+spec PR)
Direction confirmed 2026-06-27 by a read-only 3-agent fan-out (premise/value, code-grounded feasibility, doctrine fit): SOUND / FEASIBLE / FITS, each with refinements, all folded in below (G5 reclassified guarded, G8 reclassified operational-skip, living-backlog ledger flow, strengthened already-guarded bar, auto-merge hardening).
Date: 2026-06-27
Workstream: agent operating layer / build-loop family (companion to `.claude/build-loop.md` and `.claude/second-wave-slice-driver.md`)

## Problem

The repository has accumulated 112 durable lessons under
`/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/feedback_*.md`, plus the
Core Invariants in `CLAUDE.md` and `docs/DOCTRINE.md`. A large fraction of these encode real
code invariants: "governed dispatch must check the full `SubmitWorkResponse`", "a reaper that
frees a slot needs a guarded claimant", "`deriveConsentStatus` must check revoked before the
null-jurisdiction short-circuit", "`messagingOptIn` is not marketing consent".

Most of these are enforced only by recall. The lesson lives in a memory file, and the codebase
stays correct only for as long as an agent remembers to re-check it on every relevant edit. Two
failure modes follow directly, and the memory itself documents both:

1. **Silent regression.** A future refactor (often a `build-loop` / `second-wave` slice) reintroduces
   the exact bug the lesson was written about, because nothing in CI fails when the invariant is
   violated. The lesson is a tombstone, not a guard.
2. **Latent sibling violations.** The same bug class already exists in a sibling code path that was
   never fixed. MEMORY.md says this in plain text: "calendar-book-consent still has the gap"
   (`feedback_consent_status_revoked_masking`), "Alex has TWO provisioning seeders ... change BOTH
   or the CLI path ships inert" (`feedback_alex_dual_provisioning_seeders`). The fix landed in one
   place; the twin shipped broken.

The forward-construction loops (`build-loop.md`, `second-wave-slice-driver.md`) consume a plan and
add capability. Nothing in the operating layer runs the other direction: turning settled knowledge
into executable guards so it cannot silently regress. That is the gap this loop fills.

A small live proof of the gap surfaced while writing this spec: MEMORY.md and `build-loop.md` both
reference the route allowlist as `scripts/route-allowlist.yaml`, but the file actually lives at
`.agent/tools/route-allowlist.yaml`. Recollection drifts from ground truth; a guard does not.

## Design options considered

The shape "a standing loop that improves Switchboard" admits three families. All three were put to
the user; the user chose (a).

**(a) Invariant-hardening ratchet (chosen).** Work-list is the lesson corpus plus the Core
Invariants. Each run takes the highest-blast-radius lesson that has no executable guard, hunts for
sibling violations of the same invariant, fixes what severity demands, and writes the guard (a
regression test, a lint rule, an `arch-check` assertion, or a type-level constraint) that makes a
regression fail CI. It is the only option that *compounds*: every run makes the codebase
monotonically harder to break, it uniquely exploits the memory corpus already maintained here, and
it surfaces latent bugs as a byproduct of writing each guard.

**(b) Adversarial defect-hunt (standing red-team).** Self-generates work; each run sweeps a rotating
code slice for unknown bugs (by-invariant / by-seam / by-fail-open lens), adversarially verifies,
and files or fixes. Finds new bugs but does not ratchet: it prevents nothing from regressing, and
several large adversarial audits already ran (`project_adversarial_audit_2026_06_26`,
`project_exhaustive_agent_eval_2026_06_24`), so marginal new-bug yield is lower than the durable
value of locking down what is already known.

**(c) Dead-flag / inert-code reaper.** Each run traces one feature flag or gated control
end-to-end and either wires the missing producer so it goes live, or removes abandoned dead code.
Concrete and useful, but narrower than (a) and overlapping the existing activation workstream.

## Decision

Implement **(a)**, the invariant-hardening ratchet, as a new autonomous loop-driver in the
`build-loop.md` family: `.claude/invariant-guard-loop.md`. It reuses `build-loop.md` as the
canonical pipeline (exactly as `second-wave-slice-driver.md` does) and specifies only the
loop-specific deltas. Two user decisions are baked in:

- **Autonomy = autonomous-with-guardrails.** The loop auto-selects the next unguarded lesson and
  auto-merges a slice only when the diff is guard-only (a new test / lint rule / arch-check entry),
  touches no merge-stop glob, the independent fresh-context review returns zero findings at
  severity >= warn, and all checks are green. Pure new-guard PRs flow through; everything else
  surfaces.
- **Sibling handling = severity-tiered.** A regulated/security/money/governance sibling violation
  (consent, auth, billing, governance, PDPA) is fixed before anything lands and always surfaces. A
  low-risk sibling lets the guard land green now with a ticketed exception, and the fix is filed as
  its own scoped ledger row. No real bug becomes a silent TODO; no guard PR silently balloons into
  a behavior change.

## Architecture

### Two artifacts

The loop mirrors the second-wave pattern of a durable plan plus an ephemeral per-run scratch.

1. **Guard Ledger** (durable, tracked, on `main`):
   `docs/superpowers/plans/2026-06-27-invariant-guard-ledger.md`. The ranked backlog and the
   single source of truth for "what is guarded". It makes the loop resumable and non-duplicating
   across sessions. Row schema:

   ```
   | id | lesson (feedback_*.md) | invariant predicate (1 line) | blast-radius | regression-likelihood | guard-type | status | guard location | guard-covers (sites + known gaps) | siblings |
   ```

   - `blast-radius`: Crit | High | Med | Low (see the rubric below).
   - `regression-likelihood`: Hi | Med | Lo - the second rubric factor, stored so cross-session
     selection is deterministic (a fix in one place, on a hot-change path, with known siblings ranks Hi).
   - `guard-type`: arch | lint | test | ci | type | n-a.
   - `status`: unguarded | guarded | sibling-open | operational-skip.
   - `guard location`: the path of the guard once written (e.g. `packages/core/src/...test.ts`); for
     an `already-guarded` row, the existing guard plus the test `file:line` that covers the SPECIFIC
     regression case (not merely that some test exists - see the strengthened bar in slice 0).
   - `guard-covers`: the sites the guard actually covers and any known-uncovered sibling sites, so
     the "all future sites" aspiration stays honest and gaps stay follow-updable (review-driven field).
   - `siblings`: ids of any sibling-fix rows this lesson spawned (new rows in this same ledger, each
     linking back to the parent id; the parent holds `sibling-open` until they land).

   The ledger is a LIVING backlog, not a frozen design doc (this spec is the frozen part). Slice 0
   lands the initial classification as its own focused PR on `main`. After that, each guard slice
   flips its own row to `guarded` (with the guard path + coverage) INSIDE the same PR that adds the
   guard, so the row-flip is atomic with the guard that justifies it and `main` always reflects
   reality - there is no separate per-run ledger-churn commit. This spec seeds a starter set of rows
   so the format is concrete and the loop is immediately runnable.

2. **Per-run loop-state** (ephemeral scratch, uncommitted, the `.claude/` convention):
   `.claude/invariant-guard-<lesson-id>-loop-state.md`, using the `build-loop.md` STATE_LEDGER
   template.

### Slice 0: the bootstrap triage (honest classification)

The first run has no ledger. Slice 0 is a one-time read-only Explore fan-out (read-only is
mandatory: per `second-wave-slice-driver.md` FAN-OUT SAFETY, a write-capable agent will implement
and commit even from a "review only" prompt) over all 112 `feedback_*.md` plus the `CLAUDE.md` Core
Invariants and `docs/DOCTRINE.md`. Each lesson is classified into exactly one bucket:

- **already-guarded.** An existing test, lint rule, `arch-check` assertion, `local-verify-fast`
  check, or commitlint rule already fails on a regression of THIS SPECIFIC invariant. The bar is
  coverage of the specific case, not mere test existence: a file having tests does not mean the
  revoked-but-unstamped null-jurisdiction case is exercised. Slice 0 reads the candidate guard and
  confirms it would go red on the lesson's bad state, then records the guard path + the covering test
  `file:line`. Verified examples: the dynamic `NEXT_PUBLIC_*` env read is guarded by `.eslintrc.json`
  (`no-restricted-syntax`) + `scripts/check-no-dynamic-public-env.ts` (this is the real status of the
  G5 seed row); layer boundaries by `scripts/arch-check.ts`; "new mutating route needs the route
  allowlist" by `scripts/local-verify-fast.ts` -> `.agent/tools/check-routes` against
  `.agent/tools/route-allowlist.yaml`; "commitlint lowercase subject" by commitlint.
- **guardable-but-unguarded.** A real code invariant with no mechanical guard. This is the
  work-list. Status `unguarded`.
- **operational/process-only.** An agent-behavior lesson, not a code invariant, so not
  code-guardable (e.g. "model routing by phase", "ship clean don't defer", "re-check `git worktree
  list` for concurrent sessions"). Status `operational-skip` with a one-line reason.

No silent cap: the ledger header records the count in each bucket, so coverage is honest and the
"operational-skip" set is auditable rather than quietly dropped. Realistic expectation (a read-only
sample of ~18% of the corpus during direction-confirmation put it here): of 112, roughly 40 to 55
are genuine code-invariants enforced only by recall, with the rest already-guarded or operational.
Slice 0's value is as much in proving what is *already* covered (so the loop never writes a redundant
guard, as the G5 seed row demonstrates) as in naming what is not.

### Per-run pipeline (deltas over build-loop.md, which stays canonical)

`build-loop.md` owns ORIENT -> FRAME -> PLAN -> FAN-OUT -> EXECUTE -> VERIFY -> CONVERGE, the
merge-stop globs, the gate battery, the RED-proof discipline, and the authority model. The driver
restates only what is loop-specific:

1. **ORIENT + SELECT.** Re-fetch `origin/main`; read the ledger; run `gh pr list` +
   `git worktree list` and skip any lesson already in flight in another session (never fork a
   rival). Take the top `unguarded` row by the rubric. Confirm the gap is real on `origin/main`
   with tools: the lesson's original fix still exists at the cited `file:line`, and no existing
   test/lint/arch already covers THIS SPECIFIC regression case (open the candidate test and confirm
   it exercises the bad state - test existence is not coverage). If a real guard already covers it,
   flip the row to `guarded` (record the covering test `file:line`) and take the next row. This is
   the analog of build-loop's "is this already done?" check, retargeted to "is this already
   guarded?", and the G5 seed row is a live example where the honest answer is yes.

2. **CHARACTERIZE.** Turn the prose lesson into a precise, testable predicate over a named set of
   code sites. Example: "governed dispatch must check the full `SubmitWorkResponse`" becomes "every
   caller of governed dispatch treats `outcome !== 'completed'` as failure (throws or returns a
   failed outcome), never branching on `approvalRequired` alone", over the set {the dispatch
   producer + every consumer of its return type}. The predicate, and the site set it must hold
   over, are the output.

3. **SIBLING HUNT** (read-only Explore). Grep / AST-search for every site matching the predicate's
   shape (all callers, all sibling gates of the same kind), then classify each site holds vs
   violates. This is the latent-bug list, and historically the highest-value output of the loop.
   Caveat (review-driven): many siblings are SEMANTIC, not syntactic. "Every consumer of the
   lifecycle columns must be mode-aware", or "the safety gate's producer must actually populate the
   value in live code", cannot be found by grep alone; they need code archaeology and adversarial
   reading. Treat the hunt as a lower bound: if it finds N violations, assume an N+1 may exist, and
   give the siblings their own review lens rather than folding them into the guard's review.

4. **CHOOSE GUARD TYPE** (taxonomy below). Prefer the strongest guard that mechanically covers all
   in-scope sites, including future ones.

5. **EXECUTE (TDD).** The signature discipline of this loop: *a guard that cannot be shown RED is
   theater.* The RED proof (a hard done-condition inherited from build-loop) is to break the
   invariant deliberately - revert the original fix, or point the guard at a known-bad fixture or a
   `no-restricted-syntax` negative case - watch the guard fail with the right assertion, then
   restore and watch it pass. A guard that stays green when the invariant is broken is rejected.
   Apply the severity-tiered sibling rule here.

6. **VERIFY.** The full build-loop gate battery, plus one loop-specific gate: **the guard must
   actually run in CI**. A test in a file CI never executes, or a lint rule not wired into
   `pnpm lint`, or an `arch-check` branch not reached, is not a guard. The verifier confirms the
   new guard is in the executed set. Independent fresh-context review is read-only, handed only the
   three-dot diff + acceptance + relevant `feedback_*.md`.

7. **CONVERGE** (per autonomy). On done: flip the ledger row to `guarded` with the guard's path +
   `guard-covers` INSIDE the guard PR itself (atomic, no separate churn commit); file any sibling
   rows in the same ledger, linked to the parent. Separately, on the harness-memory side (NOT part
   of the repo PR - these files live at `~/.claude/.../memory/` outside the repo), append a
   `Guarded by: <path>` line to the lesson's own `feedback_*.md` and update its `MEMORY.md` pointer
   so future sessions know it is locked. This closes the loop on the recall-only problem.

### Guard taxonomy (mapped to real infrastructure, strongest first)

The loop prefers structural guards (1, 4) over targeted ones (2, 3) because structural guards cover
future sites, which is what makes the loop a true ratchet rather than a one-time fix.

1. **Lint rule** in `.eslintrc.json` (a legacy JSON config, scoped via `overrides`), usually
   `no-restricted-syntax` with an AST selector. Catches the whole class at every current and future
   site with no new plugin. The reference example is already shipped in the repo: the ban on
   computed-member `process.env` access in dashboard client code
   (`feedback_next_public_dynamic_env_not_inlined`, via `.eslintrc.json` `overrides` +
   `scripts/check-no-dynamic-public-env.ts`). That is what a finished lint guard looks like, and it
   is why the G5 seed row is already `guarded`. "No `console.log`" is the same shape.

2. **Regression test**, co-located `*.test.ts`. For behavioral invariants not expressible
   syntactically: "the reaper re-claim is a status compare-and-set"
   (`feedback_reaper_freeing_slot_needs_guarded_claimant`), "`deriveConsentStatus` checks revoked
   before the null-jurisdiction short-circuit" (`feedback_consent_status_revoked_masking`).

3. **Script assertion**: extend `scripts/arch-check.ts` (already checks file sizes, per-package test
   counts, `as any` counts, eslint config sync) or `scripts/local-verify-fast.ts` (already the only
   gate that catches new mutating-route and new env-var debt). For cross-cutting structural checks
   that need repository-wide traversal: "every new `SwitchboardMetrics` counter is registered in all
   three registries".

4. **Type-level guard**: a discriminated union plus an exhaustive switch, or a branded type, so the
   bug is unrepresentable and a regression is a compile error. The strongest where applicable:
   "missing/unknown threaded outcome routes to the safe branch"
   (`feedback_threaded_outcome_failclosed_at_seam`) can be made a `never`-exhaustiveness error.

The loop records the chosen type and a one-line "why this type" in the ledger row.

### Prioritization rubric

Rank by **blast-radius x regression-likelihood x not-already-guarded**.

- **Blast-radius** tiers, reusing the merge-stop glob taxonomy: regulated / money / auth /
  governance / consent / PDPA (Crit) > data-integrity / idempotency / tenant-isolation (High) >
  decision-engine correctness (Med) > dev-ergonomics / CI hygiene (Low). Many lessons are already
  tagged "Critical on X" in MEMORY.md, which seeds the column.
- **Regression-likelihood**: a fix that lives in exactly one place, on a hot-change path, with
  known siblings, regresses most easily and ranks up.
- The loop always takes the top `unguarded` row; `operational-skip` rows are never selected.

### Autonomy and merge mapping

Inherits the build-loop merge-stop globs verbatim, and is deliberately STRICTER than build-loop's
general config/docs/test auto-merge: a guard must be structurally pure to auto-merge, because a guard
PR that also changes behavior is no longer "just a guard". The decision table:

- **Guard-only diff** (new `*.test.ts`, new `.eslintrc.json` rule, new `arch-check` assertion) that
  touches no merge-stop glob, with a clean independent review and green checks -> **auto-merge**, but
  only after these review-driven hardening checks also pass:
  - the RED proof was exercised against the REAL sibling paths, not just a synthetic happy case (a
    guard that goes red only on a fixture while a live sibling violates it is incomplete);
  - a new lint rule reds ONLY the intended sites: run full `pnpm lint` and confirm it does not red
    unrelated existing files (a rule that reds unrelated code fails auto-merge and surfaces);
  - if the guard gates a safety control (consent / auth / approval / money / governance), the
    PRODUCER that populates the gated value is verified live in code, not merely seeded in the test
    fixture (a guard over an inert gate is theater).
- **Any slice that fixes product code** (every regulated sibling fix, since those live on consent /
  auth / governance / money paths) -> **surface** the PR with the evidence summary and a
  human-verify note, and move on. This is expected and correct: hardening regulated paths is exactly
  the zone where a human makes the merge call.

### Sibling handling (severity-tiered, the user's decision)

When the sibling hunt finds a real latent violation:

- **Regulated / security / money / governance sibling** (consent, auth, billing, governance, PDPA):
  fix it before anything lands. Either fold the fix into this slice (when small and same-zone) or
  open a tight, dedicated sibling-fix slice. Always surfaces (it touches a stop-glob).
- **Low-risk sibling**: the guard lands green now with an explicit, ticketed exception (an
  `eslint-disable` with a ledger-id comment, a scoped test input, or an allowlist entry), and the
  fix is filed as its own `unguarded`/`sibling-open` ledger row. The follow-up fix slice removes
  the exception when it lands.

This is the standard "adopt a rule, baseline existing violations, ratchet them down" pattern, with
the severity tier ensuring no real consent/money bug waits in a queue.

## The driver file: `.claude/invariant-guard-loop.md`

Authored in the same voice and structure as `second-wave-slice-driver.md`: a top-level
autonomous session that drives ONE guard slice per run. Sections:

- **ROLE**: top-level session, follows `build-loop.md` as canonical, one guard slice per run, fully
  autonomous (no user check-in mid-run).
- **WORK-LIST**: the Guard Ledger; build only what its rows enumerate; a guard idea outside the
  ledger is written to the ledger as a row, never built ad hoc.
- **SLICE SELECTION**: the pre-flight (re-fetch, `gh pr list`, `git worktree list`) + the rubric +
  "if every `unguarded` row is guarded or in flight, STOP and report nothing left to harden".
- **AUTHORITY**: the autonomous-with-guardrails table above, including the guard-only auto-merge
  condition and the always-surface-on-product-code rule.
- **PROCESS**: the 7-phase delta pipeline above, mapped onto the superpowers skills
  (`writing-plans`, `test-driven-development`, `requesting-code-review`,
  `receiving-code-review`, `verification-before-completion`).
- **DOCTRINE + GOTCHAS**: inherits the build-loop list; adds the loop-specific ones (RED-proof for
  guards = break-it-and-watch-it-fail, exercised against the REAL sibling paths; the guard must run
  in CI; a new lint rule must red only the intended sites, not unrelated files; for a safety-control
  guard verify the live PRODUCER, not just the test fixture; siblings are often semantic not
  syntactic, so the read-only sibling hunt is a lower bound; flip the ledger row inside the guard PR
  and append `Guarded by:` to the harness-memory lesson file on converge).
- **REPORT**: per run - lesson id; guard type + path; merged-or-surfaced (+ PR#); sibling findings
  and their disposition; one line per gate; the next `unguarded` row.

## Worked examples (seed ledger rows)

These prove the format and give the loop a non-empty starting backlog. Each is a real lesson with a
real predicate and a concrete guard sketch; the loop confirms each gap on `origin/main` before
building (some may already be partially guarded).

| id | lesson | invariant predicate (1 line) | blast | guard-type | status |
|----|--------|------------------------------|-------|-----------|--------|
| G1 | `feedback_consent_status_revoked_masking` | `deriveConsentStatus` checks revoked BEFORE the null-jurisdiction short-circuit; the calendar-book consent gate reads the resolved non-null jurisdiction | Crit | test | unguarded (known sibling: calendar-book-consent) |
| G2 | `feedback_governed_dispatch_check_full_submit_response` | every governed-dispatch caller treats `outcome !== "completed"` as failure, never `approvalRequired` alone | Crit | test | unguarded (type-level exhaustiveness a stretch goal) |
| G3 | `feedback_reaper_freeing_slot_needs_guarded_claimant` | every re-claim path for a freed resource is a status compare-and-set (`updateMany` with a status predicate), not an id-only update | High | test | unguarded |
| G4 | `feedback_messaging_optin_is_platform_not_marketing_consent` | proactive sends gate via `evaluateProactiveSendEligibility` (PDPA-first), never on `messagingOptIn` | Crit | test | unguarded |
| G5 | `feedback_next_public_dynamic_env_not_inlined` | no computed-member `process.env[var]` read in dashboard client code (browser bundle) | Med | lint | guarded (`.eslintrc.json` overrides + `scripts/check-no-dynamic-public-env.ts`, PR #1003) |
| G6 | `feedback_allowed_triggers_not_a_public_edge_gate` | auto-exec-only intents are gated by `SERVICE_ONLY_INGRESS_INTENTS`, not by `allowedTriggers` | Crit | test | unguarded |
| G7 | `feedback_new_mutating_route_needs_route_allowlist` | a new mutating route must appear in `.agent/tools/route-allowlist.yaml` | High | ci | guarded (`scripts/local-verify-fast.ts`) |
| G8 | `feedback_no_em_dashes` | avoid em-dashes (an agent writing-style preference, not a code invariant) | Low | n-a | operational-skip (style/agent-behavior, not code-guardable) |

G5 and G7 are included deliberately as *already-guarded* examples, both surfaced during
direction-confirmation: the loop's first action on each is to open the existing guard
(`.eslintrc.json` + `scripts/check-no-dynamic-public-env.ts` for G5; `local-verify-fast.ts` ->
`.agent/tools/check-routes` for G7), confirm it covers the specific case, and mark the row
`guarded`, never building a redundant guard. G8 is included as an *operational-skip* example (a
writing-style preference, not a code invariant). G1 carries a known regulated sibling, so under the
severity tier it will fix the calendar-book consent gate (or open a tight sibling-fix slice) and
surface.

## Composition with the existing loops (non-duplication)

- The driver reuses `build-loop.md` as canonical and restates only deltas, exactly as
  `second-wave-slice-driver.md` does. No pipeline is re-derived.
- It is orthogonal to the forward-construction loops: they add capability, this locks existing
  capability. A guard written here will fail CI if a later `build-loop` / `second-wave` slice
  regresses the invariant, so the loop families reinforce each other.
- Sibling-fix slices this loop spawns are ordinary build slices; they can be driven inline or handed
  to `build-loop` / the relevant workstream driver.

## Non-goals / out of scope

- **Not a bug hunt.** The loop does not go looking for unknown defects (that is option b). It only
  hardens invariants already named in the lesson corpus or Core Invariants, and fixes the sibling
  violations of *those* it trips over.
- **No new guard frameworks.** Guards use the existing mechanisms (eslint, vitest, `arch-check.ts`,
  `local-verify-fast.ts`, the type system). No new test runner, no eslint plugin scaffold unless a
  single `no-restricted-syntax` rule is genuinely insufficient.
- **The driver does not run the hardening slices as part of this PR.** This PR delivers the driver,
  the spec, and the seed ledger. Running slice 0 onward is a separate act the user triggers.
- **Operational/process lessons are out of scope** for guarding; they are recorded as
  `operational-skip`, not forced into a brittle guard.

## Risks and mitigations

- **Risk: a guard that passes vacuously** (theater). Mitigation: the RED-proof done-condition -
  break the invariant, watch the guard fail, restore - is mandatory and inherited from build-loop.
- **Risk: a "review only" fan-out agent that writes and commits.** Mitigation: the sibling hunt and
  any plan-grade use the read-only Explore agent (the documented FAN-OUT SAFETY rule); `git status`
  + `git rev-parse HEAD` are re-checked after every fan-out.
- **Risk: bundling a behavior change into a "just a test" PR.** Mitigation: the severity-tiered
  sibling rule plus the auto-merge condition (guard-only diffs only); any product-code change
  surfaces for human review.
- **Risk: redundant guards for already-enforced lessons.** Mitigation: slice 0's already-guarded
  classification + the per-run "is this already guarded?" ground-truth check.

## Deliverables and acceptance

Deliverables in this PR (branch `docs/invariant-guard-loop`, worktree
`.claude/worktrees/invariant-guard-loop`):

1. `.claude/invariant-guard-loop.md` - the autonomous driver skill.
2. `docs/superpowers/specs/2026-06-27-invariant-guard-loop-design.md` - this spec.
3. `docs/superpowers/plans/2026-06-27-invariant-guard-ledger.md` - the ledger, seeded with the
   worked-example rows above plus the header buckets, ready for slice 0 to complete the full
   classification.

Acceptance: a reader can run the loop from a cold start by reading the driver + the ledger alone;
the driver specifies selection, the RED-proof guard discipline, the CI-wired-guard gate, the
autonomy table, and the severity-tiered sibling rule; the seed ledger is non-empty and every seed
row names a real lesson with a concrete predicate and guard-type. This is a docs-and-tooling PR: no
TypeScript changes, so no build/test gate applies beyond markdown review and the branch-relevance
pre-commit hook.
