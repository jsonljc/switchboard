# A5a Robin executor guardrails — Implementation Plan (rank 7 + rank 14)

> `.claude/` scratch (uncommitted). Slice of A5 (D4). No migration. Merge-stop: external send -> SURFACE-before-merge.

**Goal:** A draft/absent recovery template burns zero dedup rows (rank 7); a contact who rebooked between dispatch
and send is not re-engaged (rank 14). Both in `apps/api/src/bootstrap/robin-recovery-executor.ts`.

**Architecture:** Reorder the per-recipient loop so context+eligibility run BEFORE the claim; an org-config skip
(template_not_approved | no_template) skips without claiming; consent/phone/rebooked are claim+markSkipped (audit).
Inject `findFutureBookingContactIds` + a `now` clock; batch-resolve the rebooked set once.

## Global constraints

ESM, `.js` imports, no `any`, no em-dash, prettier 100-col, lowercase commit subject. No migration. Run package-level
`tsc --noEmit` before each commit (pre-commit hook is eslint+prettier only). VERIFY must run `--filter @switchboard/api test`.

## File map

- `apps/api/src/bootstrap/robin-recovery-executor.ts` — add 2 deps; reorder loop. MODIFY.
- `apps/api/src/bootstrap/contained-workflows.ts` (~403 executor wiring) — wire findFutureBookingContactIds + now. MODIFY.
- `apps/api/src/bootstrap/__tests__/robin-recovery-executor.test.ts` — update reorder-affected tests + add new. MODIFY.

### Task 1: deps + rank-7 reorder + rank-14 re-check (executor)

**Interfaces (Produces):** `RobinRecoverySendExecutorDeps` gains
`findFutureBookingContactIds?: (orgId, contactIds: string[], now: Date) => Promise<Set<string>>` and
`now?: () => Date`.

- [ ] **Step 1 (RED): new tests** in robin-recovery-executor.test.ts (mirror the existing mock-store harness):
  - `draft-template -> zero claims`: getSendContext returns a context whose template resolves `template_not_approved`
    (selectTemplateFn returns a template with approvalStatus !== "approved", or approvalOverlay marks it draft);
    assert `store.create` NOT called, outcome skipped===candidates.length, sent===0.
  - `rebooked -> already_rebooked skip`: inject `findFutureBookingContactIds` returning a Set with the candidate's
    contactId; eligible context; assert `store.markSkipped(rowId, "already_rebooked")` and NO sendTemplate call.
  - `approved + not rebooked -> sends` (happy path; assert sendTemplate called + markSent).
    Run: `pnpm --filter @switchboard/api test -- robin-recovery-executor` -> RED (create called on draft; no rebooked skip).

- [ ] **Step 2 (GREEN): add deps + reorder.** Add to deps interface:

```ts
  /** rank 14: re-check future bookings at SEND time (cohort self-rebook exclusion is frozen at dispatch). */
  findFutureBookingContactIds?: (orgId: string, contactIds: string[], now: Date) => Promise<Set<string>>;
  /** Injectable clock for the rebooked re-check; defaults to wall-clock. */
  now?: () => Date;
```

Replace the loop (current lines ~174-273) with: resolve `now` + batch `rebookedContactIds` before the loop, then
per candidate: `getSendContext` (try/catch -> failed++ no row) -> `evaluateProactiveSendEligibility` -> if
`!eligible && (reason==="template_not_approved" || reason==="no_template")` skip WITHOUT claim -> `store.create`
claim (P2002 -> skip) -> in the post-claim try: `rebookedContactIds.has(contactId)` -> markSkipped("already_rebooked");
`!eligible` -> markSkipped(reason); `!phone` -> markSkipped("missing_contact_phone"); else send -> markSent/markFailed.
(Full code in the ledger A5a FRAME.) Keep the creds short-circuit (149-172) unchanged.

- [ ] **Step 3:** update the EXISTING reorder-affected tests (the transient-getSendContext-throw test now expects
      failed++ with NO markFailed row; the P2002 test now resolves context before create). Preserve their intent.

- [ ] **Step 4 (GREEN):** `pnpm --filter @switchboard/api test -- robin-recovery-executor` all pass; `tsc --noEmit`.

- [ ] **Step 5: wire** in contained-workflows.ts (~403): pass `findFutureBookingContactIds` (same booking-store query
      the dispatch deps use) into `buildRobinRecoverySendExecutor`. (now defaults to wall-clock; inject only if a clock is
      threaded.) Confirm the booking store / query is in scope at that site; if not, thread it from where the dispatch gets it.

- [ ] **Step 6:** `tsc --noEmit` (api) clean; commit `feat(api): hoist recovery template gate + re-check rebooked at send`.

## R1 (post fan-out grade — MANDATORY; 2/2 REVISE, design sound)

Graders CLEARED: idempotency preserved (unique(dedupeKey) still gates immediately before send; static key; concurrent
-> one P2002s, no double-send); NO under-delivery interleaving (template_not_approved/no_template are ORG-LEVEL, identical
for every candidate in a campaign -> a run cannot send some + skip-without-claim others); consent gate preserved; rebooked
= terminal per-recipient -> claim+markSkipped("already_rebooked") is CORRECT (burn the row, unlike org-config); no metric
for template-skip (it is the expected dark-until-approved state, not config_missing); no A5b bleed.

- **R1-A (Task 2 WIRING, HIGH):** findFutureBookingContactIds is NOT in scope at contained-workflows.ts. Do NOT "thread
  from dispatch". FIX: add `PrismaBookingStore` to the `@switchboard/db` dynamic import (~203-212), construct
  `const bookingStore = new PrismaBookingStore(prismaClient ...)`, pass
  `findFutureBookingContactIds: (orgId, ids, now) => bookingStore.findFutureBookingContactIds(orgId, ids, now)` into
  buildRobinRecoverySendExecutor. Mirror inngest.ts:1011-1012. Sig confirmed: `(orgId, contactIds: string[], now: Date)
=> Promise<Set<string>>` (prisma-booking-store.ts:351-368).
- **R1-B (Task 1 breaking tests, exact):** robin-recovery-executor.test.ts:
  `:210` "dedup hit (P2002)... no context read" asserts `getSendContext` NOT called -> FLIP to `toHaveBeenCalledTimes(1)`,
  rename, keep no-send + {sent:0,skipped:1}. `:262` "isolates mid-batch transient error" asserts
  `markFailed("rs_2","db blip")` -> CHANGE to markFailed NOT called + `store.create` called 2x; keep {sent:2,failed:1}.
  Integration robin-recovery-approval-loop.test.ts:146 = NO change (asserts outcomes only).
- **R1-C (Task 1 GREEN guards):** findFutureBookingContactIds? is OPTIONAL -> `deps.findFutureBookingContactIds ? await
deps.findFutureBookingContactIds(orgId, candidates.map(c=>c.contactId), now) : new Set<string>()`; `const now =
(deps.now ?? (() => new Date()))()`. (Existing non-injecting tests force the empty-set guard.)
- **R1-D (Task 1, warn):** add `console.warn` in the pre-claim getSendContext catch (observable transient failure; mirrors
  the "loud" dark-funnel convention) since there is no row/markFailed until A5b.
- Test harness (confirmed): `makeDeps({ selectTemplateFn: () => ({ ...APPROVED, approvalStatus: "draft" }) })` -> reason
  template_not_approved; rebooked test injects `findFutureBookingContactIds: vi.fn().mockResolvedValue(new Set(["c_1"]))`.

## Definition of Done (acceptance -> evidence)

- draft-template run claims zero rows -> Task1 draft-template test (store.create not called).
- a self-rebooker is skipped at dispatch[send] -> rank-14 already_rebooked test.
- an approve->dispatch loop asserts the send ran -> happy-path test.
- (rank 16 retry + rank 27 metric are A5b, NOT here.)
- VERIFY: api typecheck + `--filter api test` + lint/format/arch/verify-fast/audit/build + independent review 0 >=warn.
