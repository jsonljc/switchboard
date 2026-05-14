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

## 2. Type stacks

Four font families ship in `globals.css`. Each surface picks from this list — none introduces a new family. The rules below adjudicate the disagreements visible in the locked mockups vs the surface specs.

- **`--font-sans`** — Inter (`apps/dashboard/src/app/globals.css:74`). Body prose, control labels, queue summary text. Default for all six surfaces' UI chrome.
- **`--font-display`** — Instrument Sans (`apps/dashboard/src/app/globals.css:75`). Hero headlines on `/reports` (`docs/design-prompts/2026-05-13-reports.md#design-system`), zone titles on `/mission` (`docs/design-prompts/2026-05-13-mission.md#design-system`), the page-title display on `/approvals` (`docs/design-prompts/2026-05-13-approvals.md#design-system`). **Sparing.** Not body, not control labels.
- **`--font-serif`** / `--serif` — Source Serif 4 stack (`apps/dashboard/src/app/globals.css:173-175`). **Agent-home prose only.** Consumed by `.greeting-prose` (`apps/dashboard/src/app/globals.css:708`; mirrors greeting display in `locked/switchboard/project/agent-home-v3/cockpit.jsx:224`), `.win-prose` (`apps/dashboard/src/app/globals.css:838`; mirrors win prose in `locked/switchboard/project/agent-home-v3/cockpit.jsx:837`), `.hero-num` (`apps/dashboard/src/app/globals.css:880`), `.tile-name` (`apps/dashboard/src/app/globals.css:1107`). Tools-tier surfaces (`/approvals`, `/reports`, `/activity`, `/mission`) lead with Inter, not serif.
- **`--font-mono-editorial`** / `--mono` — JetBrains Mono stack (`apps/dashboard/src/app/globals.css:176-177`). Folios, numerics, timestamps, hashes, IDs, section labels (`.eyebrow` / `.section-label`). Required for every numeric on `/reports` (`docs/design-prompts/2026-05-13-reports.md#design-system`; locked `locked/switchboard/project/reports-v2/styles.css:620-629` campaign-table cells) and for time + event-type + actor + entity columns on `/activity` (`docs/design-prompts/2026-05-13-activity.md#design-system`; locked `locked/switchboard/project/activity-v2/styles.css:538-549` time-column mono). Required for `bindingHash` on `/approvals` (`docs/design-prompts/2026-05-13-approvals.md#detail-panel`; locked `locked/switchboard/project/approvals-v2/styles.css:607-614`).

### 2.1 Adjudication — Source Serif 4 vs Cormorant Garamond

Agent-home prose (cockpit + greeting) uses Source Serif 4 via `--serif` (`apps/dashboard/src/app/globals.css:173`; consumed at `.greeting-prose` line 708). The locked Tools-tier CSS modules (`locked/switchboard/project/approvals-v2/styles.css:36`, `reports-v2/styles.css:29`, `activity-v2/styles.css:35`) declare `--font-display: "Cormorant Garamond"`. **Source Serif 4 wins for agent-home prose**; Cormorant in the locked CSS is mockup-local display chrome, not a production directive. Tools-tier surfaces do not adopt Cormorant — they consume `--font-display` (Instrument Sans) per their surface specs.

### 2.2 Adjudication — Instrument Sans vs Cormorant Garamond (display)

`docs/design-prompts/2026-05-13-reports.md` explicitly directs Instrument Sans for the display title, hero number, and pull-quote value/cost. `docs/design-prompts/2026-05-13-approvals.md` and `docs/design-prompts/2026-05-13-mission.md` likewise direct Instrument Sans for headings. The locked CSS declares Cormorant Garamond as `--font-display` (`locked/switchboard/project/approvals-v2/styles.css:36`, `locked/switchboard/project/reports-v2/styles.css:29`, `locked/switchboard/project/activity-v2/styles.css:35`) — **spec wins**, mockup loses. Production code consumes `--font-display` (Instrument Sans) for all wave-2 display chrome.

## 3. Badges and pills

Three families live on these surfaces — agent status pills, governance risk badges, mono event-type badges. The shapes vary; the discipline doesn't.

### 3.1 Status pills (Alex/Riley state)

State pills are **text-only, no background fill** — a colored dot followed by uppercase tracked label. Geometry: `fontSize: 10.5px, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase'`, color matches the dot (`locked/switchboard/project/agent-home-v3/cockpit.jsx:226-233`). Dot is 7px round (`locked/switchboard/project/agent-home-v3/cockpit.jsx:263`). Pulse animation `ck-pulse 1.6s ease-out infinite` only when the agent has a live signal — Alex pulses on `TALKING` / `WAITING` (`locked/switchboard/project/agent-home-v3/alex-config.jsx:23`); Riley pulses on `REVIEWING` (`locked/switchboard/project/agent-home-v3/riley-config.jsx:27`); halted never pulses.

State colors come from the agent's `statusColor` function, not from a shared token table — they're owned by the agent context. Alex: `TALKING` `#3F7A36` green, `WAITING` `#B8782E` amber, idle `#A39786` ink-4, halted `#A03A2E` red (`locked/switchboard/project/agent-home-v3/alex-config.jsx:18-22`). Riley: `WATCHING` `#3F7A36`, `REVIEWING` `#B8782E`, `WAITING` `#B8782E`, `IDLE` `#A39786`, halted `#A03A2E` (`locked/switchboard/project/agent-home-v3/riley-config.jsx:20-26`). **No agent leaks color into another agent's state pill.**

### 3.2 Activity-band event-type badges

Mono outline pills with a tiny colored band-dot. Geometry: `padding: 4px 9px, border: 1px solid var(--hair-strong), border-radius: 2px, background: var(--paper-raised), font-family: var(--font-mono), font-size: 11.5px, font-weight: 500` (`locked/switchboard/project/activity-v2/styles.css:553-564`). Band-dot is 5×5 round (`locked/switchboard/project/activity-v2/styles.css:568-571`) and colored by event-type band: action band = `--amber`, identity = `--ink-3`, event = `--ink-5`, agent = `--ink` (`locked/switchboard/project/activity-v2/styles.css:573-576`). The badge background never carries semantic color — bands are signaled by the 5×5 dot, not by background fill.

### 3.3 Inline activity-row kind chips (agent-home only)

The cockpit's inline activity stream uses denser kind chips: `height: 18px, padding: 0 7px, borderRadius: 3px, fontSize: 10px, fontWeight: 700, letterSpacing: 0.1em` with a category-specific background fill from `KIND_META` (`locked/switchboard/project/agent-home-v3/cockpit.jsx:669-678`). These live inside the cockpit's single-page activity tail and **do not** appear on `/activity` (Tools tier) — which uses the §3.2 mono outline pills instead. Activity-tier surfaces converge on the outline-pill geometry; cockpit's denser inline chips are agent-home only.

### 3.4 Risk badges (depth, not hue)

`/approvals` queue rows communicate risk through a **left-edge hairline weight that grows with risk**, not through traffic-light fills. From `locked/switchboard/project/approvals-v2/styles.css:319-328`: `low` → 1px `var(--ink-5)`; `medium` → 2px `--risk-med` `hsl(34 35% 64%)`; `high` → 2px `--risk-high` `hsl(28 40% 48%)`; `critical` → 3px `--risk-crit` `var(--ink)`. Same pattern in `/activity` row `::before` accent (`locked/switchboard/project/activity-v2/styles.css:511-526`): 1px `--ink-5` low → 2px medium → 2px high → 3px ink critical. Filter-chip `.fchip-bullet` uses a 6×6 round colored dot for the same risk taxonomy (`locked/switchboard/project/approvals-v2/styles.css:223-231`).

### 3.5 Filter and tab chips

Filter chips on `/approvals` and `/activity` are pill-shaped: `font-family: var(--font-mono), font-size: 11.5px, padding: 6px 12px, border-radius: 999px, color: var(--ink-3)`; on (selected) `background: rgba(14,12,10,0.06), color: var(--ink)` (`locked/switchboard/project/approvals-v2/styles.css:196-215`). Brand-nav tabs (cockpit) use a rectangular variant: `padding: 5px 10px, borderRadius: 4px, fontSize: 13px, fontWeight: active ? 600 : 500`; active gets `background: rgba(14,12,10,0.05)` (`locked/switchboard/project/agent-home-v3/cockpit.jsx:198-208`). **Rule:** keep pill chips (999px radius) for filter taxonomy; keep rectangular chips (4px radius) for top-level navigation.

## 4. Accent-color discipline

Three accents. Each has one role; none generalises.

- **`--editorial-accent` / `--mercury-accent`** — bright orange `hsl(20 90% 55%)` (`apps/dashboard/src/app/globals.css:104,189`). Default editorial emphasis on agent homes and `/mission`. Used by the cockpit greeting accent span (`locked/switchboard/project/agent-home-v3/cockpit.jsx:717`; CSS at `apps/dashboard/src/app/globals.css:716-718`), the folio-link "pip" indicator (`apps/dashboard/src/app/globals.css:602`), win-prose accent span (`apps/dashboard/src/app/globals.css:847`), and the "hot" pipeline tile bar (`apps/dashboard/src/app/globals.css:1133`).
- **`--sw-accent` / `--operator`** — muted operator amber `#A07850` / `hsl(30 55% 46%)` (`apps/dashboard/src/app/globals.css:52,86`). Used in **two distinct surface-specific ways**, each authorized by its own spec — see §9 for full rules. Summary: `/approvals` reserves it for the primary mutating Approve CTA (`docs/design-prompts/2026-05-13-approvals.md#detail-panel`); `/reports` uses it for muted-amber emphasis on numerics, delta arrows, and ROAS depth — **explicitly not a CTA** (`docs/design-prompts/2026-05-13-reports.md#design-system`); `/activity` restricts it to active filter chip + selected row (`docs/design-prompts/2026-05-13-activity.md#design-system`). The public marketing site also consumes it. **No other use is authorized** without new surface-spec approval.
- **Agent-context accents** — Alex amber `#B8782E` (`locked/switchboard/project/agent-home-v3/alex-config.jsx:8`) and Riley clay `#B86C50` (`locked/switchboard/project/agent-home-v3/riley-config.jsx:8`). Owned exclusively by their agent's context. Used for that agent's avatar frame, status pill colors when in a live state, and inline-chip backgrounds. **Alex amber NEVER appears on `/riley` and vice versa.** Cross-agent surfaces (`/mission`, `/approvals`, `/activity`, `/reports`) do not consume agent-context accents — they stay on `--sw-accent` / `--editorial-accent` per the rules above.

### 4.1 Anti-list

The accent is **NEVER** used for any of the following:

- **NEVER for success states.** `--positive` `hsl(152 28% 32%)` (`apps/dashboard/src/app/globals.css:42`) or a calibrated green like the agent-home `--green` `#3F7A36` (`locked/switchboard/project/agent-home-v3/cockpit.jsx:21`) carries success. Amber means "operator needs attention," never "everything is fine."
- **NEVER for links.** Editorial links are underlined ink, not colored — see `.see-all`, `.win-undo` (`apps/dashboard/src/app/globals.css:856,866-876`).
- **NEVER for focus rings.** Focus uses ink border, not accent — see §7.
- **NOT for background fills** outside the surface-spec-authorized roles in §9. Filter chips and selected rows on `/activity` are an authorized exception (`docs/design-prompts/2026-05-13-activity.md#design-system`); the approve CTA on `/approvals` is an authorized exception (`docs/design-prompts/2026-05-13-approvals.md#detail-panel`). All other background fills must come from neutral hairline + paper-raised, not from accent.
- **NEVER as a "default emphasis"** for arbitrary text. Pick the role from the four authorized uses above; if no role fits, use ink and hairline weight, not accent.

## 5. Empty / loading / error / stale states

All four states are first-class on every wave-2 surface; none collapses to a generic spinner. The hook contract is `DataFreshness { generatedAt, window, dataSource, isPartial?, unavailableSources? }` (`apps/dashboard/src/lib/agent-home/types.ts:12-18`) — consumed identically by `useAgent*` and the new wave-2 hooks. Editorial surfaces never invent freshness state outside this contract.

### 5.1 Empty

Editorial italic prose, no illustration, no badge. Copy register: question or invitation, not "no data." Example agent-home empty: italic serif, 18px, ink-2 (`apps/dashboard/src/app/globals.css:1163-1169` `.empty-state`). Example Tools-tier empty: display 30px italic accent ("Nothing here yet — or it hasn't happened in this window") + sans 14.5px ink-3 subcopy + mono 11px ink-4 last-recorded timestamp (`locked/switchboard/project/activity-v2/styles.css:915-939`). Cite `docs/design-prompts/2026-05-13-activity.md#state-coverage` for the "Empty (zero) / Empty (filtered)" split — both forms exist; the filtered variant adds a "Clear filters" CTA in mono outline.

### 5.2 Loading

**Skeleton rows that preserve row geometry**, never a spinner overlay. The skeleton grid mirrors the real row's grid-template-columns so layout doesn't jitter when data arrives — see `locked/switchboard/project/activity-v2/styles.css:886-912` (`.skel-row` reuses the same six-column grid as `.arow`, animates a 10px-tall `.skel-bar` at 1400ms ease-in-out). Each wave-2 table includes its own skeleton variant; the geometry rule is cross-surface, the per-column widths are local.

### 5.3 Error

**Inline banner, not a full-page replace.** Banner uses paper-warm background with a 3px left border in ink (`locked/switchboard/project/approvals-v2/styles.css:747-755` `.errbanner`: `padding: 16px 18px; border: 1px solid var(--hair-strong); border-left: 3px solid var(--ink)`). Copy in display italic 18px (line 756). Cite `docs/design-prompts/2026-05-13-approvals.md#state-coverage` and `docs/design-prompts/2026-05-13-activity.md#state-coverage` — both surfaces explicitly state "don't unmount table" / "error: inline banner, not a full-page replace." A connection-missing banner is similar but uses a different ink-left-border weight (`locked/switchboard/project/reports-v2/styles.css:128-145`).

### 5.4 Stale

**Bottom-right pill with relative age and a refresh affordance.** Geometry: fixed position, 8px×14px padding, 999px radius, mono 11px (`locked/switchboard/project/activity-v2/styles.css:991-1003` `.stale-pill`). The age comes from `freshness.generatedAt` per the hook contract (`apps/dashboard/src/lib/agent-home/types.ts:13`). The refresh control uses mono 10px ALL CAPS, separated by a hairline from the age. **No auto-poll** — `docs/design-prompts/2026-05-13-activity.md#api-capabilities` explicitly forbids it ("No polling — pagination breaks on autorefresh"). The pill renders when `freshness.dataSource === "fixture"` or when `Date.now() - generatedAt > N minutes`; the surface picks N. Reports has a related but distinct pattern — a "cached Nm ago" caption on the recompute button (`docs/design-prompts/2026-05-13-reports.md#window-control`), since monthly numbers don't carry the same "stale" weight as live audit rows.

## 6. Motion timings and easings

All wave-2 surfaces consume the four `--duration-*` tokens and the three `--ease-*` tokens already in `globals.css`. **No new durations inline.**

- **`--duration-fast` 120ms** (`apps/dashboard/src/app/globals.css:126`) — micro-feedback: copy-button "copied" flash, hover color shift on text links, focus ring appearance. Cite `locked/switchboard/project/agent-home-v3/cockpit.jsx:241-242` (cockpit's `.color` hover swap on the mission button — visually a fast feedback).
- **`--duration-default` 280ms** (`apps/dashboard/src/app/globals.css:127`) — the workhorse: row hover, filter-chip activation, button background swap, accordion expand, ring/border state change. Every Tools-tier surface declares this exact value (`locked/switchboard/project/approvals-v2/styles.css:40`, `locked/switchboard/project/reports-v2/styles.css:33`, `locked/switchboard/project/activity-v2/styles.css:46`, `locked/switchboard/project/mission/styles.css` ditto) and consumes it for transitions on rows, chips, badges, buttons.
- **`--duration-slow` 600ms** (`apps/dashboard/src/app/globals.css:128`) — layout shifts, share-bar fill, ROAS depth opacity. Cite `locked/switchboard/project/reports-v2/styles.css:464` (`.attr-card .share-bar > span transition: width 600ms`) and `locked/switchboard/project/reports-v2/styles.css:681` (`.roas-cell .v::after transition: opacity 600ms`).
- **`--duration-very-slow` 900ms** (`apps/dashboard/src/app/globals.css:129`) — hero transitions like the ambient cream rotation (`apps/dashboard/src/app/globals.css:446-457` — uses `1200ms` directly today; intent is the slow-rhythm bucket). Reports' funnel-bar fill uses an in-band 800ms (`locked/switchboard/project/reports-v2/styles.css:507`); when a transition exceeds `--duration-slow`, the implementer either picks `--duration-very-slow` or proposes a new token (see §6.1).

### 6.1 Rules

- **Three eases** — `--ease-standard` `cubic-bezier(0.4, 0, 0.2, 1)` for two-way transitions, `--ease-enter` `cubic-bezier(0, 0, 0.2, 1)` for entrances, `--ease-exit` `cubic-bezier(0.4, 0, 1, 1)` for dismissals (`apps/dashboard/src/app/globals.css:123-125`). Every Tools-tier transition uses `--ease-standard` by default (verified across all four locked CSS modules).
- **New motion lives in `globals.css`** if it's used across two or more wave-2 surfaces. Surface-local CSS modules are fine for one-off animation (a stale-pill pulse, a target-row flash), but if a second surface picks it up, promote to `globals.css` in the second-use PR.
- **No motion durations outside the four `--duration-*` tokens.** A new duration requires a new `--duration-*` token in `globals.css`, declared in the same PR that consumes it. Inline `transition: ... 350ms ...` is reviewer-rejected.
- **`prefers-reduced-motion`** must zero animations and shorten transitions to ~0.01ms — already handled globally in `apps/dashboard/src/app/globals.css:274-281`. Surface-local CSS must not add animations that bypass this rule.






