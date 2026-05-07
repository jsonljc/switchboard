---
name: Agent-First Redesign Roadmap
description: Master phased roadmap (A→E) for agent-first dashboard redesign — slice status, PR tracking, phase dependencies
type: project
originSessionId: fd73d497-3bcd-4c57-83c1-3f6db9e99d88
---

Agent-first dashboard redesign around three canonical agents: Alex (lead-to-speed), Riley (ad-optimizer), Mira (creative, launch +30d). Two visual registers: Editorial (agent homes, decisions) and Mercury/Work (/reports, /contacts). Migration via `useAgentFirstNav` feature flag.

**Why:** Console-as-home direction supersedes v6 redesign (PR #323). Operators interact per-agent, not per-module.

**How to apply:** All new dashboard work follows the phase/slice structure below. Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`. Each slice is brainstormed when its turn comes — don't pre-write plans for future slices.

## Roadmap spec

`docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` (PR #358)

## Slice Status (as of 2026-05-05)

### Slice A — Naming + Agent Roster + Decision Feed (SHIPPED)

- Phase items: A1 + A2 + B2 backend
- PRs #359–#363, #365 (all merged)
- Spec: `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`
- Decision feed is 2-source (recommendations + handoffs), not 3 — EscalationRecord is internal telemetry only

### Slice B — Per-Agent Home (S1 shipped, S2–S6 pending)

- Phase items: A3 + B1 + B3 + B4 + B5
- PR-S1: #366 (merged) — shell + fixtures + B2 live (~64 files, 3,083 lines)
- PR-S2: B1 Greeting live — `/api/agent/[agentKey]/greeting` + core projection. Not started.
- PR-S3: B3 Wins live — `/api/agent/[agentKey]/wins` + core projection + dispatcher invalidation. Not started.
- PR-S4: B5 Pipeline live — Riley pipeline from PendingActionRecord + empty-state. Not started.
- PR-S5: B4 Metrics live — booking count, ConversionRecord leads, 9-point sparkline. Not started.
- PR-S6: Cutover — flip `useAgentFirstNav`, remove notFound() gate, delete `_fixtures.ts`. Not started.
- Plans for S2–S6 written per-PR when each begins (intentional — pattern repeats, avoids staleness)

### Slice Reports — /reports operator deep-dive (R1 in flight)

- Phase items: B+1 (#11–#15 backends)
- Spec: `docs/superpowers/specs/2026-05-05-reports-backend-v1-design.md` (PR #367)
- PR-R1: Schema + scaffolding + locked types — on `feat/reports-backend-v1` branch, 12 commits, not yet merged
- PR-R2: Web analytics pixel + visit ingestion. Not started.
- PR-R3: Live rollup endpoint (6-section ReportData). Not started.
- PR-R4: Pull-quote generator (LLM prose). Not started.
- PR-R5: PDF export (Playwright render). Not started.
- PR-R6: Production cutover. Not started.

## Future Phases (not yet bundled into slices)

### Phase C — Global surfaces

- C1: Inbox drawer overlay (cross-agent decisions) — header link is count-only in Slice B
- C2: Live mode overlay (current /console as header toggle, not a route)
- Becomes possible after Slice B S2–S6 finish

### Phase D — Tools tier + migration cleanup

- D1: /contacts (Mercury register, CRM list)
- D2: /automations (Mercury, workflow rules)
- D3: /activity (Mercury, audit log)
- D4: Old route disposition (/dashboard, /escalations, /decide, /tasks, /me, /my-agent, /modules, /conversations, /deployments)
- D5: Migration coexistence behind useAgentFirstNav flag
- Depends on flag work (roadmap track #16)

### Phase E — Parallel tracks (don't block A–D)

- E1: Public marketing site three-wedge redesign (Alex + Riley + Mira)
- E2: Onboarding reframe (single-agent-first vs pick-agents-to-enable)
