---
name: Console Redesign
description: Console launch readiness + phase 1 (frame) + phase 2 (inline interaction) — all SHIPPED. Separate track from agent-first redesign.
type: project
originSessionId: fd73d497-3bcd-4c57-83c1-3f6db9e99d88
---

Separate track from the agent-first redesign. Three waves shipped:

**Console Launch Readiness** (PRs #340–#347): Surface audit, actions/nav, truth/degradation, auth integrity, querykey leaks, dead code cleanup.

**Phase 1 — Frame** (PRs #350–#352): Opstrip halt/help, welcome screen, help, toast.

**Phase 2 — Inline Interaction** (PRs #353–#354): Inline queue interaction + HaltProvider. Visual-only recommendation card handlers (Pause/Reduce 50%/Dismiss) — no API call, card reappears on refetch. Backend gap closed by Recommendations Backend v1 (PR #357).

**No "Phase 3" console spec exists.** The `<ShadowActionList>` wiring into the activity trail is referenced in the recommendations v1 spec but has no standalone spec or plan yet.
