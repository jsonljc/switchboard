# S1 plan — no-show recovery-candidate observe tile (ephemeral, uncommitted)

Slice: Robin v1 S1. The OBSERVE leg. Pure read, no schema/governance/send -> AUTO-MERGE candidate.
Pattern: the proven metric-clone (held-rate #1042 + consent-completeness #1044):
store count -> compute\* sub-rollup -> ReportDataV1 field -> dashboard tile.
Branch/worktree: feat/robin-recovery-candidates-observe @ .claude/worktrees/robin-recovery (off origin/main d36c8f3b9).

Metric: count of NO-SHOW appointments in the report period = the recovery opportunity size.
Definition: Booking.attendance === "no_show" AND startsAt in [period.start, period.end). Org-scoped.
NaN-safe by construction (a count, no division). Distinct from held-rate (which is attended/matured).
v1 keeps it the SIMPLE matured-no-show count (the "exclude already-rebooked" candidate refinement is
deferred to the campaign-assembly slice S3/S4 where the dedup record exists; do NOT overbuild here).

## Steps (TDD, RED first each)

1. db: `PrismaBookingStore.countNoShowsInWindow({orgId, from, to}): Promise<number>`.
   - Mirror `countMaturedAttendance` (prisma-booking-store.ts:285-301). where:{organizationId:orgId,
     attendance:"no_show", startsAt:{gte:from, lt:to}}; return prisma.booking.count.
   - RED: prisma-booking-store.test.ts (mocked Prisma) asserts the where-clause + returns count.
   - GREEN: implement. Run the single test.

2. core: widen the `ReportStores["bookings"]` interface with `countNoShowsInWindow`.
   - Find the interface (grep ReportStores + countMaturedAttendance in packages/core/src/reports).
   - This is a SHARED-INTERFACE change -> the fan-out lesson: update EVERY structurally-typed bookings
     stub + EVERY ReportDataV1 builder. Known sites (grep to confirm current set):
     test-server.ts (api), period-rollup stubStores, funnel-rollup makeStores, in-memory-store.test,
     prisma-report-cache-store.test, reports-v1.test. The build cascade catches missed stubs.

3. core: pure `computeRecoveryCandidates(ctx, bookings): Promise<RecoveryCandidatesData>`.
   - New file packages/core/src/reports/compute-recovery-candidates.ts (mirror compute-held-rate.ts).
   - Returns { noShows: number } from bookings.countNoShowsInWindow({orgId:ctx.orgId,
     from:ctx.current.start, to:ctx.current.end}).
   - RED: compute-recovery-candidates.test.ts with a stub bookings store -> asserts noShows passthrough.

4. schemas/core: add `recoveryCandidates: RecoveryCandidatesData` to ReportDataV1 (same type held-rate
   added heldRate to). Define RecoveryCandidatesData { noShows: number }. Wire computeRecoveryCandidates
   into the period-rollup builder (next to computeHeldRate). Default a stale-cache-missing
   recoveryCandidates to { noShows: 0 } at the buildResultsModel seam (the ?? default lesson, avoids the
   cached-payload nested-field crash).

5. dashboard: `RecoveryCandidatesTile` (mirror HeldRateTile) rendering "No-show appointments: N" (or "—"
   for a 0/empty). Mount on the owner report page next to the held-rate tile. Add a render test.

## Gates (S1)

typecheck (FULL pnpm typecheck, not just next build) + test (pnpm test AND --filter api test AND
--filter dashboard test, since the bookings-store-interface change fans into api/dashboard stubs;
shared-interface change must typecheck consumers core->api AND chat per the new lesson) + lint +
format:check + arch:check + CI=1 npx tsx scripts/local-verify-fast.ts + security audit + dashboard
next build + token-governance + eval:governance (always, per loop) + em-dash grep on the diff.
NO db:check-drift (no schema change). NO migration.

## Done-condition / disposition

All gates green + independent fresh-context review zero >=warn + NO merge-stop glob touched (verify
`git diff origin/main...HEAD --name-only` = only db/core/schemas/dashboard non-glob paths) -> AUTO-MERGE.
Else surface.
