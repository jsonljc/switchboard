# d3-1 booked-value resolution metric loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_riley_capability_audit_2026_06_10.

Goal: emit a per-booking-attempt metric `bookedValueResolution{orgId, outcome}` so the prod
booked-value match-vs-abstain rate (and WHY it abstains) is observable. Fast-follow to #1121.
Authority: autonomous; squash-merge ONLY if ALL gates green AND fresh-context independent review
returns zero findings >= warn AND no merge-stop glob touched. SURFACE on any genuine stop.
Task-size: standard (small; 6 files, observability-only, additive). No schema/env/route/eval.
Base: origin/main @ 5caa87f28 (re-fetched) baseline_sha: 5caa87f28cc9e9520c2666b2a69c0e310f5bf9e5
worktree: .claude/worktrees/d3-1-abstain-metric branch: feat/booked-value-resolution-metric
merge_safety: stop-glob touched=NO (booking-value.ts + metrics.ts x3 + 2 test files; none match
prisma/auth/billing/consent/credential/governance/send/allowlist — recheck at CONVERGE).
independent_review=PASS (opus fresh-context; ZERO findings >= warn; 2 nits both "no action required":
(1) emission skipped on pre-valuation aborts [rate is self-contained, unaffected; adding 1-line denom
doc clarification], (2) read_error emit-position fragility [current code correct, no action]). Confirmed:
all 4 registries populated; resolveBookedValueCents byte-unchanged; resolved<=>value!=null (no NaN leak);
calendar-book.ts untouched; never-fabricate/observability-only/never-throw/exactly-once/bounded-card all hold.

## Ground-truth brief (ORIENT, tool-backed)

- resolveBookedValueForBooking(getServicesForOrg, service, orgId) (booking-value.ts:61) is the ONLY
  emission-worthy wrapper; SINGLE caller = calendar-book.ts:314 (booking.create, before opp branch).
- resolveBookedValueCents (booking-value.ts:37) is PUBLIC API (index.ts:42, tools/index.ts:7; consumed
  in packages/db tests) -> keep BYTE-FOR-BYTE unchanged. Abstains null for 6 distinct reasons.
- Metric pattern = F15 policyContextSlotEmpty: registered in metrics.ts interface(43)+createInMemoryMetrics(121),
  apps/api/src/metrics.ts:201, apps/chat/src/bootstrap/metrics.ts:201; emitted getMetrics().X.inc(); tested
  with createInMemoryMetrics()+vi.spyOn(metrics.X,"inc")+setMetrics() in alex.test.ts:461-491. Label shape =
  bookingFailed.inc({orgId, reason}).
- calendar-book.test.ts already imports setMetrics/createInMemoryMetrics(8), beforeEach setMetrics(137),
  and has the `booking.create booked-value (D3-1)` describe(607) w/ PRICED_SERVICES(608)+buildToolWithValueCapture(619)
  driving REAL booking.create -> seam test slots in there.

## Design (FRAME, settled — no brainstorm needed; bounded telemetry vs named precedent)

- Taxonomy(6): resolved | no_playbook | no_match (catalog-alignment signal) | matched_unpriced | no_lookup | read_error.
- Emission site = Option A (the wrapper) -> calendar-book.ts (F12) UNTOUCHED = smaller blast radius.
- Pure classifyBookedValue({service,services}) -> {valueCents, outcome}; valueCents DELEGATES to
  resolveBookedValueCents (single source of truth, never fabricates). Alignment test pins outcome:resolved <=> value!=null.
- Wrapper adds no_lookup (no dep) + read_error (threw); emits .inc once per call. Interface field forces
  all prom impls to register (type safety = producer-population enforcement; missing one reds build).

## Concurrent-session safety (re-checked at ORIENT)

- alex-booking-fix (fix/alex-booking-autoexecute): PR #961 CLOSED, stale. Its calendar-book.ts edit is the
  governanceOverride block (~line 214 tool-def header), NOT the value-resolution/emission lines, AND I do not
  touch calendar-book.ts source at all -> zero collision. Re-check at CONVERGE.
- No open PR touches booking-value.ts or metrics.ts. (gh pr list: dependabot + casey-consent docs + stale.)

Plan: .claude/d3-1-abstain-metric-plan.md (4 tasks, TDD).

| step                                    | done-condition (test/cmd)        | RED proof                                        | status | evidence (cmd->result / file:line)                          |
| --------------------------------------- | -------------------------------- | ------------------------------------------------ | ------ | ----------------------------------------------------------- |
| T1 classifyBookedValue pure + alignment | core test booking-value          | RED: classifyBookedValue not a function (7 fail) | DONE   | d15560291; 23/23 pass                                       |
| T2 register counter x4 sites            | core typecheck (build at VERIFY) | n/a                                              | DONE   | 27e1c9c2c; core typecheck clean                             |
| T3 wrapper emits .inc per outcome       | core test booking-value (spy)    | RED: inc calls=0 (6 fail)                        | DONE   | 930adfa53; 23/23 pass                                       |
| T4 seam: real booking.create -> metric  | core test calendar-book (spy)    | (unit RED in T3; seam=regression lock)           | DONE   | c14660d04; calendar-book 59 pass, 91 across 3 files, EXIT=0 |

gate_results (SHA c8cb959b2): typecheck=PASS build=PASS test(core=4249,api=2142,chat=333)=PASS test(full)=PASS(1 known chat load-flake, isolated pass) lint=PASS format=PASS arch=PASS verify-fast=PASS review=PASS(0>=warn) eval=N/A(observability) | security=RED (pnpm audit --audit-level=high; GHSA-88fw-hqm2-52qc hono via inngest@4.2.4 — PRE-EXISTING on origin/main, 0 pkg.json changes in diff; fix in flight = dependabot #1128 inngest 4.2.4->4.5.1)

OUTCOME: MERGED (104640e36). Initially SURFACED (security gate red repo-wide), then user authorized clearing
it; a 3-agent fan-out determined the fix = bump the stale hono pnpm.override 4.12.18->4.12.25 (chore PR #1133,
merged 5de7f7415) rather than the broken inngest upgrade #1128 or an ignoreGhsas suppression. #1132 rebased
onto post-#1133 main (clean, diff still 6 files), CI re-ran green (security PASS 47s, test PASS), squash-merged.
Both worktrees removed. ARC COMPLETE.
carry_forward (<=150 words):

- Touch api+chat prom impls -> pnpm build REQUIRED at VERIFY. NO eval (does not touch decision engine).
- Worktree fresh off origin/main: ran `pnpm worktree:init` (bg); if DB down, manual `pnpm install` + `pnpm build` for vitest/tsc.
- F12 booking family must not regress; only ADD a read-only metric; calendar-book.ts source untouched.

## Security-gate unblock (2026-06-17, user: "go with rec" -> "fan out to determine best approach")

3-agent fan-out (override-probe sonnet / exploitability opus / upgrade-scope opus) converged:

- ROOT CAUSE: root package.json pnpm.overrides ALREADY pins `hono@<4.12.18 -> 4.12.18` (old-advisory fix),
  but 4.12.18 is itself vulnerable to GHSA-88fw-hqm2-52qc (needs >=4.12.25). One-line bump fixes it.
- Empirically VERIFIED (probe worktree): override -> `pnpm audit --audit-level=high` exit 0 (hono high gone),
  api build clean (NO TS2883), inngest@4.2.4 unchanged (allows hono ^4.2.7).
- Advisory NOT-APPLICABLE here anyway (inngest served via inngest/fastify not inngest/hono; hono unused optional
  dep; app CORS = @fastify/cors) -> but fixing > suppressing (avoids a standing ignoreGhsas liability).
- Inngest upgrade (#1128) NOT needed + currently broken (otel peer split -> 2 inngest copies -> TS2883 x17 crons).
  ACTION: chore PR #1133 (bump hono override 4.12.18->4.12.25 + lockfile) opened off origin/main@5caa87f28.
  PLAN: merge #1133 when CI green -> rebase #1132 onto new main -> #1132 security gate goes green -> merge #1132.
  Watching #1133 CI (bg baatau1k6). Worktree .claude/worktrees/hono-override-chore.

## Log

- 2026-06-17: ORIENT done. Ground truth confirmed vs origin/main @ 5caa87f28. #1121 (catalog alignment)
  merged; this abstain-rate metric is its documented, unbuilt fast-follow. Concurrent alex-booking-fix is
  CLOSED+stale and I don't touch calendar-book.ts source. FRAME+PLAN done; worktree created. Next: EXECUTE T1-T4 (TDD).
- 2026-06-17: EXECUTE done (TDD, RED proofs per task; 5 commits d15560291/27e1c9c2c/930adfa53/c14660d04 +
  doc-nit c8cb959b2). VERIFY: gate-runner GREEN on all code gates; independent fresh-context review 0>=warn.
  Triaged review nits: nit-1 (denominator) -> added 1-line doc clarification; nit-2 (emit-position) -> no action.
  CONVERGE: BLOCKED on pre-existing security gate (hono/inngest GHSA on main; dependabot #1128 is the fix).
  Auto-merge bar not met -> SURFACE. PR #1132 opened (no --auto). STOP: this was the LAST unblocked Riley
  revenue-loop slice; arc is code-complete. Resume only to merge once #1128 clears the security gate, then
  remove worktree + update memory note status to merged.
