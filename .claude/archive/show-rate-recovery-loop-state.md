# show-rate-recovery loop — externalized state (orchestration scratch, not committed)

Durable record lives in [[project_receipted_bookings_architecture]] (attendance/held weld is an open gap there) + alex hub [[moc_alex_cockpit]].

Goal: ship the attendance-outcome foundation so held-appointment-rate becomes measurable. Slice 1 = data model + governed producer (A1+A2).
Authority: autonomous end-to-end; auto-merge a slice when green CI + clean adversarial review + confident-correct, else surface; pause only on low-confidence or an irreversible fork.
Task-size: standard (one bounded PR, single-pass adversarial review).
Base: origin/main @ 373cdc61 (re-fetched 2026-06-14) baseline_sha: 373cdc61

## Ground-truth brief (tool-confirmed on fresh main, 2026-06-14)

- Booking (packages/db/prisma/schema.prisma:2005-2035): lifecycle `status` String default "pending_confirmation"; only pending_confirmation/confirmed/failed/cancelled are ever written (prisma-booking-store.ts:75,90,115,178). NO attendance axis.
- Receipt (packages/schemas/src/receipt.ts:15): ReceiptStatus enum has `held`, but no code produces a held receipt (calendar mints "booked"); isPaidVisit returns held:boolean (:73).
- Gap: attendance (attended/no_show) is unmodeled + unproduced => held-appointment-rate uncomputable today.
- Layering: core must NOT import db; handler runs against a BookingStore interface, PrismaBookingStore implements (CLAUDE.md layers).

## Slice plan (decomposed; this loop = Slice 1)

- Slice 1 (A1+A2, THIS PR): schemas AttendanceOutcome type + Booking attendance fields + hand-written migration + PrismaBookingStore.recordAttendance + core `booking.record_attendance` intent/handler via PlatformIngress (governance posture mirrors operator.record_revenue: staff/owner actor, recorded fact) + intent-registration + entitlement seed + TDD incl. ingress->handler->store seam test. Non-inert: producer ships with the field.
- Slice 2 (A3+A4, next loop): operator API route + dashboard check-in action + held-appointment-rate read/tile.
- Later: recovery workflows (confirmation/no-show), attribution_confidence, exceptions[], consent-completeness.

| step                                  | done-condition (test/cmd)                            | status | evidence                                                                                                              |
| ------------------------------------- | ---------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| T1 schema+migration                   | db:generate ok; migration.sql present                | done   | 14e24d37 (migration 20260614120000_booking_attendance; client regen)                                                  |
| T2 store.recordAttendance             | --filter db test green (updateMany count===0 guard)  | done   | 755b8a4a (23 db tests green incl 2 new)                                                                               |
| T3 param schema                       | --filter api test green                              | done   | a7f8c1c3 (2 tests)                                                                                                    |
| T4 intent const + handler             | --filter api test green (handler seam)               | done   | d668f6cc (BOOKING_NOT_FOUND added to OPERATOR_INTENT_ERROR_CODES; 2 tests)                                            |
| T5 wiring (operator-intents + app.ts) | --filter api typecheck green                         | done   | e40a4b20 (fresh PrismaBookingStore in bootstrap block; intent re-exported; typecheck green; full build chain current) |
| T6 route + integration test           | --filter api test green (200/404/400/idem/auth-wins) | done   | a2e27469 (integration 5/5; route routes.ts:250 prefix /api; WorkTrace asserted; shared BOOKING_NOT_FOUND const)       |
| T7 verify all gates + /code-review    | all gates green, diff clean, review clean            | done   | 9/9 gates green (incl drift); review CLEAN (2 minor parity, non-blocking)                                             |

gate_results: typecheck=PASS test=PASS(db1038/api1971) lint=PASS format=PASS arch=PASS build=PASS drift=PASS(no-drift) review=CLEAN(2 minor parity notes, non-blocking) merge=c8a28a7c(PR#1041 squash)
carry_forward (<=150 words): SLICE 1 SHIPPED -> squash c8a28a7c on main (PR #1041, auto-merged on green CI). Worktree torn down, branch deleted. Attendance foundation live: Booking.attendance + recordAttendance + booking.record_attendance operator intent + POST /api/:orgId/bookings/:bookingId/attendance. NEXT = Slice 2 (held-appointment-rate read in report rollup [attended/matured] + dashboard tile + staff check-in UI/action calling the Slice-1 route) on a FRESH worktree off main@c8a28a7c. Later slices: recovery workflows (confirmation/no-show), attribution_confidence, exceptions[], consent-completeness. Durable record: [[project_show_rate_recovery]]. Build-loop ran clean end-to-end; the 3-lens fan-out grade caught 3 real mechanical defects before execute (high value).

## Log

- 2026-06-14: ORIENT complete. Worktree feat/show-rate-recovery reset to fresh origin/main@373cdc61. Gap confirmed with tools. Slice 1 scoped (A1+A2). -> PLAN next.
- 2026-06-14: PLAN + 3-lens opus fan-out grade (REVISE: app.ts scope, route-test harness, **tests** paths -> rev1) -> EXECUTE (6 TDD subagents) -> VERIFY 9/9 green incl drift + review CLEAN.
- 2026-06-14: PR #1041 auto-merged -> squash c8a28a7c on main. Worktree + branch removed. SLICE 1 SHIPPED. Durable record [[project_show_rate_recovery]]. -> checkpoint + Slice 2.
