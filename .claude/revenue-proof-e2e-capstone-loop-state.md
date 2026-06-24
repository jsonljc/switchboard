# revenue-proof e2e CAPSTONE loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap (P3.3 de-risk lane).

Goal: prove the ONE journey seam never exercised through real code — the conversation->booking ENTRY
through the REAL skill executor (stubbed LLM tool-call -> real dispatch + real GovernanceHook ->
real calendar-book booking.create op), guarding the P0.1/F2 prod-inertness class.
Authority: AUTONOMOUS-WITH-GUARDRAILS (auto-merge ONLY if all gates green + indep review 0>=warn +
divergence clean + high confidence; test-only expected; downgrade to surface if it touches prod code /
a merge-stop glob / migration / decision engine).
Task-size: standard (one bounded PR, single test-only file, reuses substrate).
Base: origin/main @ a4b7eff26 (fetched 2026-06-22) baseline_sha: a4b7eff2643ed9df0422de94b218758f8ba4ad14
Worktree: .claude/worktrees/revenue-proof-booking-entry Branch: feat/revenue-proof-booking-entry-e2e
merge_safety: stop-glob touched=NO (test-only in apps/api/src/**tests**; imports GovernanceHook but
modifies no governance/ingress/prisma/auth/payment file) independent_review=SHIP (0 >= warn)
PR: #1240 (commit 2f99972e8). Awaiting CI required checks, then squash-merge (autonomous lane).

## BRAINSTORMING DECISION (the first gate — resolved against ground truth)

Three candidate forms weighed against merged slices 1-3 (#1214/#1224/#1234) + P3.1 (#1198):

- REJECT Form A (chain 1->2->3 in one test): near-zero marginal coverage. Slice 3 ALREADY chains
  book->attendance->payment->digest->email over the substrate; the /reports tiles (slice 1) + digest
  (slice 3) are two readers of ONE already-proven projection (createPeriodRollup). A "one big test"
  adds no new seam. The decomposition plan itself calls A "optional."
- REJECT Form B-ingress (through PlatformIngress.submit): the user explicitly scoped B to "go through
  the skill EXECUTOR, NOT PlatformIngress.submit"; booking.create is confirmed NOT a submittable intent;
  and driving skill-mode through ingress would require injecting a test LLM adapter at the bootstrap
  (apps/api/src/bootstrap/skill-mode.ts:475-477 hard-constructs `new Anthropic(...)`) = production-code
  change + bigger harness, out of scope.
- BUILD Form B-direct (smallest): WORTH IT. The composition "REAL SkillExecutorImpl -> REAL GovernanceHook
  -> REAL calendar-book booking.create op" is genuinely uncovered. skill-executor.test.ts tests dispatch
  with a MOCK `test-tool.do` (no governanceOverride, trivial schema); slices invoke
  `tool.operations["booking.create"].execute()` DIRECTLY, bypassing the executor's name-resolution +
  input-schema validation + governance. Concrete unguarded prod-inertness scenario (P0.1 class): rename
  the op key or change booking.create's governanceOverride -> Alex emits a tool_use, the executor finds
  no op OR parks it (F2: skill-mode parking is a no-op tool-result -> silently lost), bookings silently
  stop. Slice 1 + skill-executor.test.ts BOTH still pass. B-direct is the only tripwire. Low cost (full
  reuse of substrate + a structural stub adapter). NOT manufactured.

## Ground-truth (tool-backed)

- SkillExecutorImpl + GovernanceHook exported from @switchboard/core/skill-runtime (index.ts:2-3).
- Executor LLM is injectable (constructor param `adapter: ToolCallingLLMAdapter`, skill-executor.ts:141);
  TestToolAdapter precedent exists (adapters/test-tool-adapter.ts) but is NOT index-exported -> use an
  inline structural stub (executor only calls adapter.chatWithTools(params)).
- Dispatch loop: skill-executor.ts:526-599 (split name on ".", lookup tool.operations[op], runBeforeToolCallHooks
  = GovernanceHook, validateToolInput, op.execute). booking.create: calendar-book.ts:247 tool id "calendar-book",
  input {service,slotStart,slotEnd,calendarId}, effectCategory external_mutation,
  governanceOverride {supervised:auto-approve, guided:auto-approve} (line 264).
- Substrate buildCalendarBookTool wires the REAL factory over in-memory Prisma (revenue-loop-substrate.ts:437-464).
- booking.create NOT in any submittable-intent / PLATFORM_DIRECT set (confirmed).

| step           | done-condition (test/cmd) | RED proof | status | evidence (cmd->result / file:line) |
| -------------- | ------------------------- | --------- | ------ | ---------------------------------- |
| (plan pending) |                           |           |        |                                    |

gate_results: typecheck=pass test=pass(2343,new 2/2) lint=pass format=pass arch=pass verify-fast=pass security=pass build=pass eval=n/a review=SHIP(0>=warn)+mutation-LOAD-BEARING
carry_forward: DONE + MERGED. PR #1240 squash 7b593bdf4 on main. Worktree/branch torn down. revenue-proof
de-risk lane COMPLETE (slices 1-3 + this capstone). Memory note + index updated.

## STATUS: DONE / MERGED (autonomous-with-guardrails lane; all conditions met)

## Log

- 2026-06-22: ORIENT done (collision scan clean; 3 Explore agents mapped skill-runtime). FRAME/brainstorm
  done -> BUILD smallest B-direct, reject A + B-ingress. Worktree created off a4b7eff26.
- 2026-06-22: EXECUTE (opus subagent) wrote the test (2 cases) GREEN. VERIFY: 8 gates green; indep
  fresh-context review SHIP 0>=warn (re-derived 45000 + load-bearing); throwaway-worktree mutation proved
  the supervised governanceOverride load-bearing (delete -> require-approval -> count 0).
- 2026-06-22: CONVERGE. Divergence re-check: origin/main advanced 1 commit (#1239, telemetry file, PROVEN
  orthogonal) + strict=false -> merge w/o rebase. Required four (typecheck/lint/test/security) all pass.
  Squash-merged #1240 (7b593bdf4). Worktree + branch removed; main ff-synced. Capstone DONE.
