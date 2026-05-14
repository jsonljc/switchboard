# Wave-1 surface conventions — shared visual and interaction language across the six wave-2 dashboard surfaces

> Derived from `docs/design-prompts/locked/` and the wave-1 surface specs (`docs/design-prompts/2026-05-13-*.md`) on 2026-05-13. This file is **derived, not edited**: re-derive when the lock or specs refresh; don't hand-edit individual rules. New conventions discovered mid-redesign come back here as their own focused PR to `main`.

**Audience:** implementer agents and humans working on any of the six wave-2 surfaces — Alex home, Riley home, /mission, /approvals, /reports, /activity, /contacts.

## Doc scope — visual language vs token ownership

This doc covers shared visual and interaction conventions. It does **not** replace per-surface token ownership and it does **not** authorize route-group migrations.

- **Layer 1 — Visual/interaction language.** Typography, prose cadence, hairline density, badge/pill geometry, empty/loading/error/stale patterns, motion timings, focus rings, table density, surface-specific governance conventions, anti-patterns. Binding on all six surfaces. These are sections 1–10 below.
- **Layer 2 — Surface token ownership.** Names which token base each surface currently consumes. Mercury-routed surfaces continue to alias from `--mercury-*` until a separate, explicitly-approved migration. Agent homes consume editorial tokens directly. The Layer-2 table follows; it is descriptive, not prescriptive.

A Mercury-routed surface may adopt Layer-1 conventions while continuing to alias `--mercury-*` tokens. **This doc never instructs a surface to change its route group or token base.**

## Surface coverage and token base (Layer 2 — descriptive, not prescriptive)

| Surface | Current route | Current token base (V1) | V2 target (per surface spec) |
|---|---|---|---|
| Alex / Riley homes | `/alex`, `/riley` (post-PR 2; today via `[agentKey]`) | Editorial — `--cream`, `--ink`, `--ink-2..4`, `--hairline`, `--editorial-accent`, `--serif`, `--mono` (consumed directly) | Same. Each home owns its agent-context accent (Alex amber `#B8782E`, Riley clay `#B86C50`). |
| /mission | greenfield | — | Stone & Weight (`--sw-*`) per `docs/design-prompts/2026-05-13-mission.md` |
| /approvals | greenfield | — | Stone & Weight per `docs/design-prompts/2026-05-13-approvals.md`. `--sw-accent` reserved for the primary Approve CTA only. |
| /reports | `(mercury)/reports` | Mercury aliased locally to `--cream`/`--ink`/… in `reports.module.css` | Stone & Weight per `docs/design-prompts/2026-05-13-reports.md`. `--sw-accent` is muted-amber emphasis on numerics and ROAS depth — **never** a CTA. |
| /activity | `(mercury)/activity` | Mercury aliased locally in `activity.module.css` | Stone & Weight per `docs/design-prompts/2026-05-13-activity.md`. Stays under `(mercury)/`; only the token base shifts. |
| /contacts | `(mercury)/contacts` | Mercury aliased locally in `contacts.module.css` | No surface spec yet. Locked `agent-home-v3/Pipeline.html` shares the editorial shell; final token base + route group intentionally unresolved — defer to a future PR. |

This table is **descriptive**, not prescriptive. Where V2 differs from V1, the change is authorized by the cited surface spec — this doc does not initiate token migrations.

## Authoring rules

1. **Every rule cites either a locked mockup file/line or an approved surface spec section.** Format: `locked/switchboard/project/<dir>/<file>:<line-range>` or `docs/design-prompts/<surface-spec>.md#<section-anchor>`. Production-constraint rules (Source Serif 4 not Cormorant, SGD only, hash echo language, etc.) typically live in surface specs, not mockup lines — both citation forms are valid. **Every specific value cites its source** — pixel heights, motion durations, hairline weights, focus ring widths, table row heights, exact colors. Invented numbers are reviewer-rejected.
2. **When sources disagree across surfaces, adjudicate explicitly.** Name the disagreement in one sentence, pick a winner, give a one-line rationale. Never paper over disagreement.
3. **Prescriptive, not exhaustive.** Lock the decisions that vary across the six worktrees. Don't re-specify per-surface designs.
4. **No route or token migrations initiated here.** This doc never instructs a surface to move out of `(mercury)/` or to stop aliasing `--mercury-*`. Where the Layer-2 table or §9 reflects a V2 target differing from V1, the change is authorized by the cited surface spec — the doc only documents the destination.
5. **Doc is derived, not edited.** Re-derive when the lock or specs refresh. New conventions discovered mid-redesign come back here as a focused PR to `main`.
