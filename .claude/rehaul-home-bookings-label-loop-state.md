# rehaul-home-bookings-label (Pass-2 #7-Home follow-up) loop — scratch

Durable record: project_aesthetic_rehaul.

Goal: a light clarifying sub-label on the Home KPI strip's Bookings tile (Decision 2A: Home Bookings = attributed booked ConversionRecords this week, may differ from the Alex panel's Booking-model count). Tiny, mechanical, autonomous. No merge-stop glob (home-page UI only).
Base: origin/main @ 464d82e4f. Worktree: .claude/worktrees/rehaul-home-bookings-label (branch design/rehaul-home-bookings-label).

DESIGN (locked): add an optional `sub?: string` prop to `CountTile` in apps/dashboard/src/components/home/home-kpi-strip.tsx (render it in the "ready" branch, mirroring ValueTile's `.sub` span + the `styles.sub` class). Pass `sub="Attributed this week"` for the Bookings tile (line 64). Caption rationale: consistent with the strip's "Attributed booking value" vocab; signals the attribution basis (the ConversionRecord source that may differ from Alex's Booking model) + timeframe; honest + minimal; only shows in the ready state (next to figure+delta), like ValueTile's sub. No backend/data change (presentational only).

TDD: extend apps/dashboard/src/components/home/**tests**/home-kpi-strip.test.tsx -- RED: assert the Bookings tile renders "Attributed this week" (fails before the caption) -> add the sub prop + caption -> GREEN. Confirm the empty/unavailable branches do NOT show the sub (only ready).
VERIFY: typecheck + dashboard test + lint + format:check + arch:check + CI=1 local-verify-fast + next build + audit. INDEPENDENT review (sonnet; copy-clarity + no-regression). Screenshot: the strip needs seeded home-summary ready data (interaction/data-gated -> note honestly; the test asserts render).
MERGE: gate on required CI on exact head + clean review -> squash --admin -> teardown -> ff-sync -> update memory (project_aesthetic_rehaul + session_resume: #7 label MERGED -> roadmap bounded items COMPLETE; thread 3 surfaced).

## Log

- 2026-06-21: #7-Home label ORIENT+design done; worktree created; bg setup running.
