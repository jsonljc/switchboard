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

## 1. Token registry

Four overlapping token namespaces live in `apps/dashboard/src/app/globals.css`. None is "Mercury-only" or "Stone & Weight-only" at the surface level — surfaces pick a base and consume it. The doc is reference: it documents what each token is for, where its value comes from, and where it shows up.

### 1.1 Stone & Weight (`--sw-*`)

Public marketing site + the V2 target for all four wave-1 surface specs (activity, approvals, mission, reports). `--sw-accent` `#A07850` is numerically equal to shadcn `--operator` (`hsl(30 55% 46%)` ≈ `#A87C4A`) — the same warm muted amber.

| Token | Value | What it's for |
|---|---|---|
| `--sw-base` | `#F5F3F0` (`apps/dashboard/src/app/globals.css:78`) | warm off-white page background; matches `--paper` `hsl(45 25% 98%)` in `locked/switchboard/project/approvals-v2/styles.css:9` |
| `--sw-surface` | `#EDEAE5` (`apps/dashboard/src/app/globals.css:79`) | block surface; `docs/design-prompts/2026-05-13-approvals.md#design-system` |
| `--sw-surface-raised` | `#F9F8F6` (`apps/dashboard/src/app/globals.css:80`) | hover state for queue rows (`docs/design-prompts/2026-05-13-approvals.md#row-design`) |
| `--sw-border` | `#DDD9D3` (`apps/dashboard/src/app/globals.css:81`) | default hairline |
| `--sw-border-strong` | `#C8C3BC` (`apps/dashboard/src/app/globals.css:82`) | section dividers; cross-cites `--hair-strong rgba(14,12,10,0.16)` in `locked/switchboard/project/approvals-v2/styles.css:21` |
| `--sw-text-primary` | `#1A1714` (`apps/dashboard/src/app/globals.css:83`) | prose; ≈ `--ink #0E0C0A` in locked CSS (`approvals-v2/styles.css:13`) |
| `--sw-text-secondary` | `#6B6560` (`apps/dashboard/src/app/globals.css:84`) | meta lines; ≈ `--ink-3 #6B6052` |
| `--sw-text-muted` | `#9C958F` (`apps/dashboard/src/app/globals.css:85`) | section labels (`docs/design-prompts/2026-05-13-activity.md#design-system`) |
| `--sw-accent` | `#A07850` (`apps/dashboard/src/app/globals.css:86`) | muted operator amber; surface-specific use — see §4 |
| `--sw-ready` | `hsl(145 45% 42%)` (`apps/dashboard/src/app/globals.css:137`) | onboarding "ready" green |

### 1.2 Mercury (`--mercury-*`)

V1 token base for `/activity`, `/contacts`, and `/reports`. The V1 CSS modules alias these locally to `--cream`/`--ink`/`--hair`/… so the surface looks editorial while the source-of-truth values live under the Mercury namespace. `/approvals` is greenfield in code and never aliased Mercury.

| Token | Value | What it's for |
|---|---|---|
| `--mercury-cream` | `hsl(40 25% 94%)` (`apps/dashboard/src/app/globals.css:99`) | page background in V1 Mercury surfaces |
| `--mercury-ink` | `hsl(20 10% 12%)` (`apps/dashboard/src/app/globals.css:100`) | primary text |
| `--mercury-ink-2..4` | `hsl(20 8% 28%)` / `hsl(20 6% 46%)` / `hsl(20 6% 62%)` (`apps/dashboard/src/app/globals.css:101-103`) | ink ramp |
| `--mercury-accent` | `hsl(20 90% 55%)` (`apps/dashboard/src/app/globals.css:104`) | bright editorial orange — **same value** as `--editorial-accent` |
| `--mercury-accent-soft` | `hsl(20 60% 50%)` (`apps/dashboard/src/app/globals.css:105`) | softer accent for state |
| `--mercury-hairline` / `-soft` | `hsl(40 15% 86%)` / `hsl(40 15% 90%)` (`apps/dashboard/src/app/globals.css:106-107`) | hairlines |
| `--mercury-row-hover` | `hsl(40 18% 90%)` (`apps/dashboard/src/app/globals.css:108`) | table row hover (Mercury V1) |
| `--mercury-pos` / `--mercury-neg` | `hsl(140 35% 35%)` / `hsl(0 60% 45%)` (`apps/dashboard/src/app/globals.css:109-110`) | pos/neg semantic; rarely needed (wave-1 prefers glyph + amber depth) |

### 1.3 Editorial (agent-home tokens, consumed directly)

Used by `/alex` and `/riley` agent homes. Same value space as the Mercury aliases above (cream + ink ramp + hairline) but named for the editorial register.

| Token | Value | What it's for |
|---|---|---|
| `--cream` | `hsl(40 25% 94%)` (`apps/dashboard/src/app/globals.css:164`) | ambient page background; consumed by the editorial auth shell via `--ambient-cream` (`apps/dashboard/src/app/globals.css:181`) and `.app-header` (`apps/dashboard/src/app/globals.css:455`) |
| `--ink` | `hsl(20 10% 12%)` (`apps/dashboard/src/app/globals.css:165`) | prose; consumed by `.greeting-prose` (`apps/dashboard/src/app/globals.css:713`) and the brand mark dot (`apps/dashboard/src/app/globals.css:496`) |
| `--ink-2` | `hsl(20 8% 28%)` (`apps/dashboard/src/app/globals.css:166`) | secondary prose (`.dc-resolved-line` line 782) |
| `--ink-3` | `hsl(20 6% 46%)` (`apps/dashboard/src/app/globals.css:167`) | tertiary / muted prose (`.brand-nav a` line 510) |
| `--ink-4` | `hsl(20 6% 62%)` (`apps/dashboard/src/app/globals.css:168`) | quaternary (`.tile-ctx` line 1118) |
| `--hairline` | `hsl(40 15% 86%)` (`apps/dashboard/src/app/globals.css:169`) | canonical hairline |
| `--hair` | `var(--hairline)` (`apps/dashboard/src/app/globals.css:187`) | alias; consumed by `.app-header` border (`apps/dashboard/src/app/globals.css:456`), `.win` border (line 809), `.tile` border (line 1040), and across the agent-home shell |
| `--hair-soft` | `hsl(40 15% 90%)` (`apps/dashboard/src/app/globals.css:188`) | softer divider |
| `--editorial-accent` | `hsl(20 90% 55%)` (`apps/dashboard/src/app/globals.css:189`) | bright editorial orange; consumed by `.greeting-prose .accent` (`apps/dashboard/src/app/globals.css:717`), `.folio-link .pip` (line 603), `.win-prose .accent` (line 847), `.tile[data-stage="hot"] .tile-bar` (line 1133) — **same value** as `--mercury-accent` |
| `--serif` | Source Serif 4 stack (`apps/dashboard/src/app/globals.css:173-175`) | display + prose font |
| `--mono` | JetBrains Mono stack (`apps/dashboard/src/app/globals.css:176-177`) | folios, numerics, section labels |
| `--col` | `640px` (`apps/dashboard/src/app/globals.css:190`) | prose column width |
| `--col-wide` | `1080px` (`apps/dashboard/src/app/globals.css:191`) | wide content column |
| `--gap-section` | `144px` (`apps/dashboard/src/app/globals.css:192`) | between-section spacing (desktop) |
| `--gap-section-tablet` | `104px` (`apps/dashboard/src/app/globals.css:193`) | tablet variant |
| `--gap-section-mobile` | `72px` (`apps/dashboard/src/app/globals.css:194`) | mobile variant |

### 1.4 shadcn HSL components

Neutral foundation that both registers consume via Tailwind utilities (`hsl(var(--token))`). Examples:

- `--accent` `40 18% 91%` (`apps/dashboard/src/app/globals.css:30`), `--operator` `30 55% 46%` (`apps/dashboard/src/app/globals.css:52`) — `--operator` is numerically the same as `--sw-accent`.
- `--positive` `152 28% 32%` (`apps/dashboard/src/app/globals.css:42`), `--caution` `38 42% 38%` (`apps/dashboard/src/app/globals.css:45`), `--negative` `0 38% 40%` (`apps/dashboard/src/app/globals.css:48`).
- Motion: `--ease-standard` / `--ease-enter` / `--ease-exit` (`apps/dashboard/src/app/globals.css:123-125`), `--duration-fast` `120ms` / `--duration-default` `280ms` / `--duration-slow` `600ms` / `--duration-very-slow` `900ms` (`apps/dashboard/src/app/globals.css:126-129`). See §6.

### 1.5 Rule for new tokens

- A value reused across two surfaces is promoted to a token in the PR that introduces the second use. The PR that first invents a value lives with a local declaration; the PR that brings the value to a second surface either promotes to `globals.css` or aliases the local declaration to an existing token of the same value.
- Name conflicts with existing tokens are forbidden. If a new name would shadow an existing token (across `--sw-*`, `--mercury-*`, editorial, or shadcn), pick a different name.
- New tokens land in the same PR that consumes them. No "token-only" PRs that ship dead values.
- Do not retune existing token values inside a surface PR. If a value needs to change across surfaces (e.g., `--mercury-accent` to match the mockup amber), that's a focused token-retune PR cited by its own spec.

