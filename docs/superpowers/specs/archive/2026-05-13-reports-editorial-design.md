# /reports — Editorial Second Pass

**Date:** 2026-05-13
**Branch:** `docs/reports-editorial-design-spec` → PR to `main`
**Scope:** Typographic / layout rebuild of the existing `/reports` page over the locked v1 backend schema. No schema, endpoint, or rollup changes.
**Status:** Spec for review.
**Companion docs:** [`docs/design-prompts/2026-05-13-reports.md`](../../design-prompts/2026-05-13-reports.md) (backend-grounded design prompt), [`docs/design-prompts/locked/switchboard/project/reports-v2/`](../../design-prompts/locked/switchboard/project/reports-v2/) (mockup source of truth).

---

## 1. Background and intent

`/reports` v1 shipped as PRs R1..R6 (merged 2026-05-11) at `apps/dashboard/src/app/(auth)/(mercury)/reports/`. v1 is functional but reads as a stock SaaS dashboard. The renewal-checkpoint thesis — "Am I getting my S$447 worth?" — wants a deliberately editorial register: a printed statement, not a console.

The Claude Design mockup at `docs/design-prompts/locked/switchboard/project/reports-v2/` (`Reports.html`, `app.jsx`, `sections.jsx`, `data.js`, `styles.css`) is the visual source of truth. Chat 14 captures the final intent verbatim — the structure below mirrors the mockup section-for-section, with a handful of deliberate reconciliations against the actual locked schema and the established Mercury type system.

This is the typographic / layout pass only. The backend schema at `packages/schemas/src/reports/v1.ts` is locked; the route at `apps/api/src/routes/dashboard-reports.ts` is locked; the rollups in `packages/core/src/reports/*` are locked.

## 2. Non-goals

- **No schema changes.** Don't add fields, don't change `ReportDataV1`, don't widen `ManagedComparisonData`.
- **No new endpoints, no new server computations.** If a mockup detail implies a missing field, design without it and flag in §10.
- **No schema, endpoint, or rollup-logic changes.** A small backend formatting swap from USD to SGD **is** in scope — without it the pull quote and cost narrative would emit `$` while the rest of the page emits `S$` — see §6 and §10.2.
- **No chart library.** Funnel + share bars + ROAS depth are CSS / inline SVG only.
- **No PDF or export work.** Print stylesheet is out of scope.
- **No new _global_ design tokens.** Module-local aliases and shade extensions (e.g., `--ink-5`, `--paper-warm`, `--accent-soft`) are allowed inside `reports.module.css`. Promotion to globals is a shared-conventions decision — flagged in §10, not introduced here.
- **No copy rewrites for backend-generated strings.** `pullquote.{pre,mid,post}`, `funnelNarrative.text`, `costNarrative`, `emptyMessage` come from the backend; design renders them as-is. (Eyebrow and column-header copy is in-scope — see §4.)

## 3. Layered inputs and their authority

In order of precedence when they conflict:

1. **Locked backend schema** (`packages/schemas/src/reports/v1.ts`) — non-negotiable. Field names, types, optionality.
2. **Established Mercury type system** (`apps/dashboard/src/app/layout.tsx` + `globals.css` + the four sibling `*.module.css` files) — non-negotiable. The codebase has already decided font + token vocabulary for this register.
3. **Backend-grounded prompt** (`docs/design-prompts/2026-05-13-reports.md`) — section list, layout intent, anti-patterns.
4. **Locked mockup** (`docs/design-prompts/locked/switchboard/project/reports-v2/`) — concrete sizes, weights, animations, component composition.
5. **Chat transcripts** (`chats/chat14.md`, `chat15.md`) — design rationale.

Specific overrides this spec applies to the mockup:

- **Display type → Source Serif 4, not Cormorant Garamond.** The mockup's designer chose Cormorant "to match the established editorial register." Verified against the codebase: the established editorial register on `/activity`, `/contacts`, `/contacts/[id]`, `/automations`, and the current `/reports` aliases `--serif: var(--font-serif-mercury)` which resolves to Source Serif 4 (loaded in `apps/dashboard/src/app/layout.tsx:29-35`). Cormorant would diverge from five shipped surfaces. We preserve the mockup's hierarchy (sizes, weights, italic emphasis) and swap the typeface to Source Serif 4 via the existing alias.
- **Mono → JetBrains Mono via `--font-mono-mercury` alias.** Mockup says JetBrains Mono; codebase already loads it as `--font-mono-editorial` (layout.tsx:37-42), aliased to `--font-mono-mercury` in `globals.css`. The current `reports.module.css` already aliases `--mono: var(--font-mono-mercury)` — keep the pattern.
- **Riley/Alex share bars.** Prompt does not call these out; mockup includes them. We follow the mockup.
- **Topbar non-sticky.** Mockup is sticky; the app-shell already provides a sticky nav. Two sticky bars is the failure mode — see §4.1 and §10.5.
- **Monetary unit.** Prompt and mockup say SGD cents. The locked backend emits **whole dollars with optional decimals** — see §6. The formatter adapts; this is the most important reconciliation.

## 4. Page structure (top to bottom)

Maps 1:1 to the mockup's `ReportsApp` render tree in `app.jsx`. Each subsection lists the mockup anchor and the schema fields it reads.

### 4.1 Page-internal topbar (non-sticky)

**Mockup anchor:** `app.jsx` lines 78–101, CSS `.topbar`.

The mockup renders a sticky topbar with brand cluster + breadcrumb + live pip + clock + user avatar. The production app already provides a sticky app-shell nav, so this surface renders the topbar **non-sticky, inside the page** (drop `position: sticky` from the mockup CSS). Two sticky bars on one screen is the failure mode we're avoiding — see §10.5.

- Left cluster: Switchboard mark (inline SVG, 20×20, two eyes + accent smile from `app.jsx:7-16`), `Switchboard / {org} / Reports`. Mono 11.5px slashes.
- Right cluster: live/sample data pip (green dot for live, pulsing accent for sample), SGT clock (ticks every 30s), user avatar with initials.
- `Reports` breadcrumb gets the 1.5px accent underline (`.brand-page`).
- Org name and current-user initials are **not in the locked schema response**. They come from the existing dashboard session context (`useSession()` and organization context) — see §10.7.

### 4.2 Page head (title + folio + window selector + refresh)

**Mockup anchor:** `app.jsx` lines 103–144, CSS `.page-head`.

- Eyebrow `Statement` (mono, 11px, 0.14em tracking, ink-3). Drop the mockup's `/reports` suffix — exposing internal routes is dev-speak.
- Display title: `Operator's <span class="accent">Statement.</span>` — Source Serif 4 `clamp(36px, 4.6vw, 56px)`, weight 500, the period in italic accent color.
- Page sub: 14.5px Inter, ink-3, max 38em — copy from the mockup verbatim ("A renewal-checkpoint reading…").
- Right rail (right-aligned, stacked):
  1. `dateFolio` from schema — mono 13px, 0.12em tracking, 1px ink underline.
  2. Segmented window selector — three `<button>`s: `THIS WEEK`, `THIS MONTH`, `THIS QUARTER`. Active state: ink fill, paper text. Drives the `?window=` query param and `useReportWindow()` state.
  3. Refresh control: small mono button labelled `Refresh` (mockup says "Recompute"; that's engineering jargon — endpoint stays `/api/dashboard/reports/refresh`). Label format: `cached N{m ago}`. Click → POST `/api/dashboard/reports/refresh?window=…`, then invalidate the React Query key.

**Refresh feedback:** the mockup shows a fixed 900ms spinner. Real refresh against Meta/Stripe is 3–10s. The spinner runs until the React Query refetch resolves. If it takes >3s, swap the button label from `Refreshing…` to `Still loading…` so it doesn't feel frozen. Disable the button while in-flight.

**Cache-age timer:** Not in any schema field today. v1 already implements the refresh POST; the visible cache-age label is new. Read `Cache-Control: max-age` from the response headers if available, otherwise show "just now" after a refresh and "—" before any local refresh has occurred. See §10.6.

### 4.3 No-connection banner (conditional)

**Mockup anchor:** `app.jsx` lines 147–156, CSS `.banner-noconn`.

Render when `liveMode === true` AND the org has no connected Meta Ads `Connection`. **Do not infer from funnel data** — a connected account with paused campaigns this period would falsely trigger an inferred banner.

**Implementation order (hard instruction):**

1. **Search first.** Look for an existing Meta-connection-status hook or context in `apps/dashboard/src/hooks/`, `apps/dashboard/src/lib/`, and `apps/dashboard/src/providers/`. `useManagedChannels()` (`apps/dashboard/src/hooks/use-managed-channels.ts`) is the most likely existing source; check whether its return value already discriminates Meta connection state.
2. **If existing hook covers it, use it.** No new code.
3. **If not, add the thinnest possible read-only hook** (e.g., `useMetaConnectionStatus()`) over the existing connections API surface. The new hook is a 10–20 LOC wrapper around an existing fetch path.
4. **Do not add a new endpoint.** The API at `/api/dashboard/connections` (or whatever the existing equivalent is) already exposes connection state. If it doesn't, stop and escalate — adding a new connections endpoint is out of scope for this spec.

Fixture mode renders the banner only when the spec is being exercised by the (out-of-scope) tweaks panel — i.e., never in normal fixture flow. See acceptance criterion in §12.

Layout: three-column grid: eyebrow + italic Source Serif 4 message + mono "Connect under Settings" CTA → links to `/settings/connections`.

### 4.4 Pull quote

**Mockup anchor:** `sections.jsx` `PullQuote`, CSS `.pullquote-wrap` / `.pullquote`.

- Renders `pullquote.{pre, value, mid, cost, post}` as a single paragraph. `value` and `cost` get the `.em` treatment: Source Serif 4 italic, accent underline (1.5px), accent-soft highlight on bottom 30%.
- Max width 36rem, centered. Hairline rule above + below. Source Serif 4 `clamp(22px, 2.6vw, 32px)`, weight 400, line-height 1.32.
- The fade-in animation keys on `value + cost` so window changes re-animate the quote.
- **Important:** the schema's `value` and `cost` are pre-formatted strings (e.g., `"S$14,720"`) generated by `pull-quote-generator.ts`. The pull-quote generator must emit `S$` strings — see §6.

### 4.5 Attribution

**Mockup anchor:** `sections.jsx` `Attribution`, CSS `.attr-block`.

- Eyebrow: `Revenue we drove` (mockup says "Attributed pipeline" — operator jargon for a medspa owner). The right-rail caption stays `total this period`.
- Hero number: `S$` (mono superscript) + `{total}` (Source Serif 4 `clamp(64px, 9vw, 132px)`, weight 500, tabular nums). Rendered as integer (no decimals at this size).
- Aside (next to hero, bottom-aligned): eyebrow `vs. previous period`, delta badge (see below), italic Source Serif 4 17px desc — copy from the mockup verbatim ("Pipeline value attributed by closed bookings, weighted by service price at the point of sale.").
- Delta badge: arrow glyph + text. `pos` = accent-soft background with accent-deep ink. `neg` = ink border, ink text — **no red**. `flat` = dashed border, ink-3. **No green / red.**
- Riley/Alex split below: 50/50 grid, hairline borders. Each card:
  - `who-glyph` circle: `R` (paper, ink border) for Riley; `A` (ink, paper text) for Alex.
  - `who-name` in Source Serif 4 20px; `who-role` in mono uppercase ("Ad-ops" / "Conversations").
  - `val` in mono 30px (formatted via `fmtSGD`).
  - `cap` in Inter italic 13.5px — uses schema's `riley.caption` / `alex.caption` strings.
  - `share-line`: 1px hairline + animated 3px fill at `(value / total) * 100%`; Riley fills with ink, Alex with accent-deep; mono share percentage to the right.
- The schema says `attribution.delta: Delta` (required, non-nullable). The mockup typed it as `Delta|null`; we render the delta unconditionally.

### 4.6 Funnel

**Mockup anchor:** `sections.jsx` `Funnel`, CSS `.funnel`.

- Five rows. **Schema invariant: always 5 rows, in the order returned.** The schema docstring at v1.ts:8-11 mentions "Landing visits may be hidden client-side" — we do not hide it. (Flagged in §10.8.)
- Each row is a 4-column grid: stage label (mono uppercase 11px, 130px column) · bar (flex, 22px tall, fill bar 14px) · numeric label (mono 15px right-aligned, 90px column) · delta chip (mono 10.5px right-aligned, 80px column).
- Fill colors stage-by-stage via `[data-i]` selectors:
  - `0` (Impressions) → `--ink`
  - `1` (Clicks) → `--ink-2`
  - `2` (Landing visits) → `--ink-3`
  - `3` (Leads) → accent-deep
  - `4` (Bookings) → accent
- Bar width: `(n / max(funnel.n)) * 100%` — Impressions naturally fills the row. CSS transition 800ms.
- Top of first row + bottom of last row are 1px ink (the editorial "rules"); inner separators are hair-soft 1px.
- Below the bars: `funnelNarrative` byline — 130px marker column ("Riley · Apr 22", accent-deep mono with a 14px accent dash before it) + Source Serif 4 italic 19px body in `text-wrap: pretty`.
- Delta chip: `pos` → accent-deep, `neg` → ink, `flat` → ink-4. Renders `delta.text` verbatim (already includes the arrow glyph). `delta == null` renders an em-dash.

**Mobile breakpoint (`<= 520px`):** mockup has no funnel-specific mobile rule, so the 130px / 1fr / 90px / 80px grid overcrowds on narrow phones. Add:

```css
@media (max-width: 520px) {
  .funnel-table {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
    row-gap: 6px;
  }
  /* stage label + delta share row 1; bar spans row 2; numeric label row 3 */
}
```

### 4.7 Campaigns table

**Mockup anchor:** `sections.jsx` `CampaignsTable`, CSS `.tbl-wrap`.

Columns (mapped to `CampaignRow` fields):

| Header   | Sub        | Field                                     | Format                                              |
| -------- | ---------- | ----------------------------------------- | --------------------------------------------------- |
| Campaign | —          | `name`                                    | Inter 13.5px, left-aligned, sticky                  |
| Spend    | SGD        | `spend`                                   | `fmtSGD(v, {withCents:"never"})`                    |
| Impr.    | —          | `impressions`                             | `fmtInt`                                            |
| Clicks   | CTR        | `inlineLinkClicks` + `inlineLinkClickCtr` | int + submetric `fmtPct(ctr, 2) + " CTR"`           |
| CPC      | —          | `costPerInlineLinkClick`                  | `fmtSGD(v, {withCents:"always"})` or `—`            |
| Leads    | Click→Lead | `leads` + `clickToLeadRate`               | int + submetric `fmtPct(rate, 1)`                   |
| CPL      | —          | `cpl`                                     | conditional cents based on threshold; `—` when null |
| Revenue  | SGD        | `revenue`                                 | `fmtSGD` or `—` when zero                           |
| ROAS     | rev/spend  | `roas`                                    | `(v).toFixed(2) + "×"` with accent-underline depth  |

- Header style: mono 10px, 0.14em tracking, uppercase, ink-3. Sortable headers (all of them) show an accent down-arrow on hover; active header shows the arrow opaque + rotates 180° on `asc`. Default sort: revenue desc.
- Sticky first column with a 1px hair right border and paper background; matches the paper-warm tone on hover.
- ROAS depth: `--roas-depth: min(1, c.roas / max(roas))` drives the opacity of a 2px accent underline beneath the value. Dead campaigns (clicks === 0 OR (roas === 0 AND leads === 0)) drop the value to ink-4. **No red.**
- Totals row in `<tfoot>`: bold mono, paper-warm background, 1px ink top border, all 9 columns filled. Totals are computed client-side from the supplied rows.
- Mobile (`<= 760px`): the `<table>` swaps for a card list (`.tbl-cards`) — see mockup CSS lines 716–756. Each card shows campaign name + ROAS pill on top, then a 2-column grid of Spend / Revenue / Clicks·CTR / Leads·CPL. **Horizontal table scroll is suppressed on mobile** (one fallback, never both).

### 4.8 Cost vs Value (renewal punchline)

**Mockup anchor:** `sections.jsx` `CostVsValue`, CSS `.cost-block`.

Three cells in a 1fr / 1fr / 1.35fr grid (the saving cell is wider on purpose):

- **You pay** — mono 30px, ink. Label "Switchboard subscription, this period".
- **Salesperson + ad agency** — mono 30px, ink-3, **strikethrough** (1px ink-4 line-through). Label "market-rate equivalent". (Mockup says "SDR + agency alt." — `SDR` is sales jargon; medspa operators think "salesperson + ad agency.")
- **Monthly saving** — Source Serif 4 `clamp(48px, 6vw, 80px)`, accent-deep, with mono `S$` superscript. Paper-warm background. Label "net to your P&L".

The whole block sits in a 1px ink top + bottom rule. Beneath: `costNarrative` in Source Serif 4 italic 19px (the backend-supplied string, currently US-framed — flagged in §10.3).

On mobile the three cells stack vertically with hair-soft dividers.

### 4.9 Managed comparison (conditional)

**Mockup anchor:** `sections.jsx` `ManagedComparison`, CSS `.mc-wrap`.

Renders only when `managedComparison !== null`. **Important schema reconciliation:** the mockup's `data.js` has a simplified shape (`{ ads: { spend: {managed, unmanaged}, ... } }`). The locked schema at `v1.ts:105-118` is different:

```ts
ManagedComparisonData {
  ads: ManagedComparisonPair | null;
  conversations: ManagedComparisonPair | null;
  source: "in-period-cohort" | "pre-switchboard-baseline";
  emptyMessage?: string;
}
ManagedComparisonPair { managed: ManagedComparisonMetrics; unmanaged: ManagedComparisonMetrics; delta: Delta; }
ManagedComparisonMetrics { spend, revenue?, roas?, replies?, conversionRate?, replyMinutesP50? }
```

Design implications:

- Eyebrow: `How you're doing with us vs. without` (mockup says "Managed vs. unmanaged" — consultant-speak). Right-rail caption: drop the mockup's "cohort comparison · same-period" jargon and use the `source`-driven caption below.
- Each pair owns its own `delta` (we don't compute `(managed/unmanaged - 1) * 100` client-side as the mockup does at `sections.jsx:391-394` — we render `pair.delta.text` directly using the same `DeltaBadge` component as elsewhere).
- `ads` and `conversations` are independently nullable. Render each column only when its pair is non-null; if both null, render the section title + the `emptyMessage` if provided (Source Serif 4 italic, ink-3); if both null AND no emptyMessage, the whole section is hidden.
- Metric coverage: render `spend`, `revenue`, `roas` rows for `ads`; render `replies`, `conversionRate`, `replyMinutesP50` rows for `conversations`. Skip any row whose value is `undefined` on both sides.
- Show `source` as a small mono caption beneath the section eyebrow: `"Compared to similar accounts this period"` for `in-period-cohort`, `"Compared to your pre-Switchboard baseline"` for `pre-switchboard-baseline`.
- Layout matches the mockup: two columns (Ads / Conversations), each metric is a `label` row + a managed-side + an unmanaged-side. Unmanaged value drops to ink-3. The pair-level delta sits beneath the managed value in accent-deep mono.

### 4.10 Colophon (footer)

**Mockup anchor:** `sections.jsx` `Colophon`, CSS `.colophon`.

- Left: eyebrow `Colophon`, italic Source Serif 4 22px period (from `report.period`), 12.5px Inter italic caveat text (copy from mockup verbatim).
- Right: mode pip (`Live data` with green dot when `NEXT_PUBLIC_REPORTS_LIVE`, `Sample data` with accent dot otherwise), `generated {ISO timestamp formatted}`, `org · {org}`. **Drop the mockup's `schema · reports/v1` line** — internal artifact, customers shouldn't see it.
- The "generated" timestamp source: `Cache-Control` `max-age` doesn't carry the original timestamp. We use React Query's `dataUpdatedAt` for live mode, and a hardcoded `meta.generatedAt` for fixture mode. See §10.6.

## 5. Live vs fixture mode

Single switch: `NEXT_PUBLIC_REPORTS_LIVE` read via the existing `isMercuryToolLive("reports")` helper at `apps/dashboard/src/lib/route-availability.ts`.

- `false` (fixture): render `FIXTURES_BY_WINDOW[window]` synchronously. No fetch.
- `true` (live): React Query fetches `GET /api/dashboard/reports?window=…`. Refresh button calls `POST /api/dashboard/reports/refresh?window=…` then invalidates the query key.

The existing `useReportData` hook at `apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts` is kept as-is. The new page mounts the same hook.

**Fixture parity:** the three fixtures in `apps/dashboard/.../fixtures.ts` currently emit USD-framed copy and integer dollars (e.g., `"$14,700"`). Updating them is in-scope:

- Rewrite to match the mockup's `data.js` content (Aurora Aesthetics, Singapore medspa, `S$` strings, populated `managedComparison` on goodFixture, populated `managedComparison` on problemFixture with `source: "in-period-cohort"`, `null` on quietFixture).
- Keep the numeric values as whole-dollar / decimal-dollar amounts (NOT cents), consistent with the backend (§6).
- Adopt the mockup's campaign names ("Spring-Hydrafacial", "Botox-Touchup-Q2", etc.) — more realistic medspa services than v1's generic names.

**Empty / loading states:**

- Loading (`!data && isLoading`): the page shell renders with a 200ms skeleton fade-in on the hero number, attribution split, funnel bars, and table rows. No spinner; the editorial register prefers a quiet skeleton.
- Error (`error !== null`): show a single-paragraph banner styled like the no-connection banner but with the error message in italic Source Serif 4. Mono "Retry" button that calls `refresh()`. Do not render the rest of the page.
- The current v1 returns `null` (renders nothing) when `!fx`; that is acceptable for fixture mode but not for live mode. New behavior: always render the topbar and the static parts of the page head (title, page sub, window selector). `dateFolio` and the cache-age label render as `—` placeholders until data arrives. Section skeletons render beneath.

## 6. Currency: SGD, units, and `fmtSGD`

The single biggest reconciliation between mockup and backend.

**Backend reality (verified):**

- `packages/core/src/reports/cost-vs-value-rule.ts:39-41` emits `Math.round(paid * 100) / 100` — **dollars with two decimals**, not cents.
- `packages/core/src/reports/attribution-rule.ts:58-73` computes `total = rileyRevenue + alexRevenue`; revenue from `revenueWithFirstTouch` is in the source currency unit (dollars in current tests).
- v1 fixtures at `apps/dashboard/.../fixtures.ts` use dollars (`total: 14700`, `paid: 447.75`).
- The current frontend formatter at `apps/dashboard/.../components/format.ts` uses `"$" + Math.round(n)` — hard-coded USD.

**Mockup reality:**

- `data.js` defines `sgd = (dollars) => Math.round(dollars * 100)` — stores **cents**.
- `sections.jsx` `fmtSGD(cents)` divides by 100.

**Design decision: backend wins.** Production rollups emit dollars; v1 fixtures match. We do not migrate the schema to cents. Instead:

- Replace `components/format.ts` with `fmtSGD(dollars, opts?)`:
  - `withCents: "auto" | "always" | "never"` — "auto" → show cents when `|dollars| < 100`.
  - `compact: boolean` — when true and `|dollars| >= 10_000` show `S$XXk`; `|dollars| >= 1_000_000` show `S$X.Xm`.
  - Locale `"en-SG"` for grouping.
  - Returns `"S$" + formatted`. **No bare `$`.**
- Drop the existing `fmtMoney` helper. All numbers on this page route through the new `fmtSGD`.
- The mockup's `sgd(dollars) => Math.round(dollars * 100)` is **discarded** for the production port. Fixtures and live data both use dollars.

**Backend currency formatter swap (small but required in this PR).** The pull-quote and cost-vs-value narratives are generated server-side via `formatCurrencyUSD` at `packages/core/src/reports/period-helpers.ts:83-95`. Verified at:

- `pull-quote-generator.ts:84-85` — formats `attribution.total` and `cost.paid` before passing to the LLM template. The LLM only generates connective text (`pre`/`mid`/`post`); a `CONTENT_GUARD` regex already rejects `$`/digits in LLM output, so no prompt edit needed.
- `cost-vs-value-rule.ts:28-34` — formats `paid`, `alt`, `saving` for the cost narrative string.

Required change: add `formatCurrencySGD(value)` next to `formatCurrencyUSD` in `period-helpers.ts` (same shape, emits `S$` with `en-SG` grouping), and swap both call sites. Two call sites, one new helper, ~15 LOC total. **Without this, the pull quote and cost narrative will show `$X` while the rest of the page shows `S$X`.** Land in the same PR.

## 7. Component decomposition

```
apps/dashboard/src/app/(auth)/(mercury)/reports/
├── page.tsx                         # unchanged (Next.js route + metadata)
├── reports-page.tsx                 # rewritten — new editorial layout
├── reports.module.css               # rewritten — port from mockup styles.css; keep --serif/--mono alias chain
├── fixtures.ts                      # rewritten — adopt mockup data (SGD, medspa names)
├── components/
│   ├── topbar.tsx                   # NEW — brand cluster + live pip + clock (non-sticky)
│   ├── page-head.tsx                # NEW — title, folio, window selector, refresh
│   ├── no-connection-banner.tsx     # NEW — live-mode-only conditional, reads connections context
│   ├── pull-quote.tsx               # rewritten — hairline-bordered, italic-em words
│   ├── attribution.tsx              # rewritten — hero number + Riley/Alex split + shares
│   ├── funnel.tsx                   # rewritten — 5-stage CSS bars + byline + mobile breakpoint
│   ├── campaigns.tsx                # rewritten — sticky col, sortable, ROAS depth, mobile cards
│   ├── cost-vs-value.tsx            # rewritten — 3-cell, saving as serif punchline
│   ├── managed-comparison.tsx       # NEW — replaces v1's absence; reads locked schema
│   ├── colophon.tsx                 # NEW — replaces report-footer.tsx + disclosure.tsx
│   ├── delta-badge.tsx              # NEW — shared `pos | neg | flat` chip
│   ├── format.ts                    # rewritten — fmtSGD, fmtPct, fmtInt
│   └── switchboard-mark.tsx         # NEW — inline SVG mark
└── hooks/
    ├── use-report-data.ts           # unchanged
    └── use-report-window.ts         # unchanged
```

Files to delete: `components/header.tsx`, `components/title-controls.tsx`, `components/report-footer.tsx`, `components/disclosure.tsx`. Their responsibilities consolidate into `topbar.tsx`, `page-head.tsx`, and `colophon.tsx`.

Tests:

- `components/__tests__/delta-badge.test.tsx` — pos/neg/flat rendering, no red/green class names.
- `components/__tests__/funnel.test.tsx` — bar width proportions, byline marker, mobile-breakpoint grid switch.
- `components/__tests__/campaigns.test.tsx` — sort flip, sticky column class, ROAS depth, dead-row class, totals math.
- `components/__tests__/cost-vs-value.test.tsx` — strikethrough on alt cell, "Salesperson + ad agency" label, saving renders Source Serif 4.
- `components/__tests__/managed-comparison.test.tsx` — both pairs null → hidden, one pair null → single column, friendlier `source` captions.
- `components/__tests__/format.test.ts` — `fmtSGD` boundaries (cents/no-cents, compact, locale grouping, always leads with `S$`).
- `components/__tests__/page-head.test.tsx` — button label flips from `Refresh` → `Refreshing…` → `Still loading…` at the 3s threshold.
- `__tests__/reports-page.test.tsx` — full render with goodFixture and problemFixture; assertion: no `$` character appears in rendered DOM outside `S$`.

## 8. CSS port strategy

The mockup is plain CSS + (Cormorant Garamond → Source Serif 4) + Inter + JetBrains Mono. The production app uses CSS Modules. Port strategy:

- One module file `reports.module.css` mirroring `docs/design-prompts/locked/switchboard/project/reports-v2/styles.css` section-by-section. Rename selectors from kebab-case globals (`.attr-block`, `.funnel-table`) to camelCase module exports (`attrBlock`, `funnelTable`).
- **Preserve the existing alias chain at the top of `reports.module.css`:** the current v1 module aliases `--serif: var(--font-serif-mercury)` and `--mono: var(--font-mono-mercury)`. Keep it. Add module-local `--ink-5`, `--paper-warm`, `--paper-raised`, `--paper-deep`, `--hair-strong`, `--accent-soft`, `--accent-paper` only — these are the ones not already in globals.
- **Tokens already in `globals.css` (do not redeclare):** `--background: 45 25% 98%` (paper), `--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--hair`, `--hair-soft`, `--hairline`, `--font-serif`, `--font-serif-mercury`, `--font-mono-editorial`, `--font-mono-mercury`, `--char-accent: hsl(30 55% 46%)`, `--editorial-accent: hsl(20 90% 55%)`, `--mercury-accent: hsl(20 90% 55%)`.
- **Accent choice is a shared-conventions question** (see §10.9). Until ratified, this spec uses `--char-accent` (the muted operator amber `hsl(30 55% 46%)`) — that's what the mockup uses, and it suits the quiet renewal-statement register. The bright `--editorial-accent` reads too consumer-app for this surface.
- **Fonts: nothing to add.** Source Serif 4 and JetBrains Mono are already loaded in `apps/dashboard/src/app/layout.tsx:29-42`. No new `<link>` tag, no new `next/font` import.

## 9. Anti-patterns (reaffirmed)

- **No green / no red.** Delta direction is glyph + accent-depth + ink-only treatments. Negative deltas use `var(--ink)` border, not `var(--red)`. Verify in the `problemFixture` render — the negative delta chip and the negative funnel rows should look quiet and ink-toned, not alarming.
- **No bare `$`.** All currency = `S$`. Unit test scans rendered DOM for `/\$(?!S\$|\{)/` (excludes the literal template `${}` strings) and fails on hits.
- **No emoji, no traffic lights, no KPI tiles, no sparkline-per-number.** The only inline visualizations are: funnel bars, Riley/Alex share lines, ROAS accent-depth underline.
- **No chart library.** No Recharts, no Visx, no D3 imports.
- **No card shadows.** Hairlines only.
- **No horizontal table scroll on mobile.** Card fallback instead.
- **No empty placeholder for `managedComparison` when fully null.** Hide the section.
- **No internal artifacts in the colophon.** `schema · reports/v1` belongs in a developer tools panel, not a customer-facing footer.
- **No inferring connection status from data.** Read connection state from session/connections context.

## 10. Shared-conventions input (cross-surface flags)

These are decisions the spec will not make unilaterally — they belong in `docs/design-prompts/shared-conventions.md` (wave 1.5):

1. **`fmtSGD` lives where?** Currently proposed inside `apps/dashboard/.../reports/components/format.ts`. The other four wave-1 surfaces (`/mission`, `/activity`, `/approvals`, plus one more) will likely also need it. Recommended: extract to `apps/dashboard/src/lib/format-sgd.ts` once wave 1 is integrating. **For this spec, ship local; flag for hoist.**

2. **Backend currency formatter.** `packages/core/src/reports/period-helpers.ts` exposes `formatCurrencyUSD`. Adding a sibling `formatCurrencySGD` and switching both call sites (pull-quote-generator + cost-vs-value-rule) is required in this PR — see §6. The shared-conventions doc should ratify whether `formatCurrencyUSD` is renamed/deprecated outright or kept for any historical paths. (Grep shows two consumers; both are reports rollups.)

3. **Cost-vs-value market basis.** Backend hardcodes `SDR_MONTHLY_USD = 5000, AGENCY_MONTHLY_USD = 3000` with the comment "US SMB hiring averages." The Singapore-medspa positioning wants S$5,000 + S$3,000 with the comment / footnote updated. Out of scope here — flag for a follow-up backend PR (`packages/core` change), spec'd separately.

4. **Editorial paper / ink token palette.** Globals already have `--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--hair`, `--hair-soft`, `--hairline`. The mockup adds `--ink-5`, `--paper-warm`, `--paper-raised`, `--paper-deep`, `--hair-strong`, `--accent-soft`, `--accent-paper`. Promotion of those to globals is a shared-conventions call. This spec scopes them locally to `reports.module.css`.

5. **Topbar with org breadcrumb and clock.** Mockup includes a sticky topbar that isn't part of the editorial chrome on other agent-home pages. The `app-shell.tsx` already provides nav; rendering an additional sticky topbar here means **two sticky bars**. Decision: render the topbar **inside** the page (non-sticky internally) and rely on the existing app-shell. See §4.1 — this is a deviation from the mockup that the shared-conventions doc should ratify.

6. **Cache-age display.** Showing `cached Nm ago` requires a server-emitted `generated_at` timestamp in the response or a header. Today there is no such field. Behavior in §4.2 falls back to React Query's `dataUpdatedAt`. If wave 1.5 standardizes a `X-Switchboard-Generated-At` header across surfaces, this surface should adopt it.

7. **Org name + current-user initials in the topbar.** Schema doesn't carry these. Read from existing session context (`useSession()`, organization context). No new API call.

8. **Funnel "Landing visits" hide-when-zero.** Schema docstring at v1.ts:8-11 says client may hide; this spec keeps all five stages visible (avoids discontinuous bar-proportion shifts when a Meta connection lands). Recommend: pin the row visibly and render at 0% width with numeric label `—`. The shared-conventions doc should ratify whether structural rows ever disappear.

9. **Accent color: muted operator amber vs. bright editorial accent.** Globals expose both: `--char-accent: hsl(30 55% 46%)` (muted, used by character system on `/`) and `--editorial-accent: hsl(20 90% 55%)` (bright, used by `/activity`, `/mission`, `/alex-home`). The mockup picked the muted operator amber; sibling Mercury surfaces use the bright editorial accent. **Recommendation: this surface uses the muted accent.** A renewal-checkpoint statement reads as a quiet printed document; the bright orange reads consumer-app and undercuts the register. **This is an intentional exception because `/reports` is a renewal statement, not an operational action surface — future review should not "normalize" it back to the bright accent without revisiting the register.** The shared-conventions doc should ratify either (a) per-surface accent choice, or (b) a unified Mercury accent (in which case this surface adopts whichever wins).

## 10b. Implementation sequencing

The work spans currency reconciliation, fixture rewrite, format helper rewrite, backend formatter swap, no-connection hook, responsive table/card behavior, managed comparison, and refresh state. **Two viable shapes** — pick one at implementation-plan time:

**Option A — one PR, in order.** If the existing `/reports` code surface is small enough (verified: ~10 component files, ~600 LOC of CSS), keep it as a single focused PR. Implement strictly in this order so each step has a working visual checkpoint:

1. Backend `formatCurrencySGD` swap (lands first so subsequent UI work renders correct currency throughout).
2. Frontend `fmtSGD` + `format.ts` rewrite + fixture rewrite.
3. Page shell: `topbar.tsx`, `page-head.tsx` (without refresh state yet), `colophon.tsx`.
4. Hero sections: `pull-quote.tsx`, `attribution.tsx`, `cost-vs-value.tsx`.
5. Dense sections: `funnel.tsx`, `campaigns.tsx`, `managed-comparison.tsx`.
6. Responsive polish: funnel mobile breakpoint, campaigns mobile cards.
7. Refresh state machine + window-switch-during-refresh handling.
8. `no-connection-banner.tsx` (search existing hooks first per §4.3).
9. Tests for §12 acceptance criteria.

**Option B — split into PR-R7a + PR-R7b.**

- **PR-R7a — currency + shell:** backend `formatCurrencySGD`, frontend `fmtSGD`, updated fixtures, topbar, page-head (without refresh state), pull-quote, attribution, cost-vs-value, colophon. Ships a renderable page with correct currency and the renewal hero/punchline; funnel + campaigns + managed comparison still on v1.
- **PR-R7b — dense sections + interactive polish:** funnel (with mobile breakpoint), campaigns (table + mobile cards), managed comparison, no-connection banner, refresh state machine, full test suite for §12.

Recommendation: **start with Option A**. If PR review feedback or scope creep pushes the diff past ~2,500 LOC or ~25 changed files, split to Option B at that boundary — PR-R7a's commits will already form a clean cut-point.

## 11. Risks and open questions

- **Pull-quote / cost-narrative currency drift.** If the backend formatter swap (§6, §10.2) lags this UI rebuild into a second PR, fixtures will show `S$` and live data will show `$`. Mitigation: land the formatter swap in the same PR.
- **ROAS depth interpretation.** Calibrating `--roas-depth` against `max(roas)` means a campaign with ROAS 0.5 next to a campaign with ROAS 15 will show as zero-depth — visually invisible underlining. Mockup accepts this; we accept this. A future enhancement might cap min-depth at 0.15 for non-dead rows; out of scope.
- **Managed-comparison fixture coverage.** v1 fixtures all have `managedComparison: null`. Updating goodFixture and problemFixture to populated comparisons is necessary to exercise §4.9. Both ends of the schema's optionality (one pair null, both null + emptyMessage, both pairs populated) need fixture coverage.
- **Accent accumulation.** On the goodFixture render, accent appears at: pull-quote `em` underlines (×2), positive delta badge background, funnel stages 3–4 fill, ROAS underline (per row), saving punchline number, refresh button hover. ~7 distinct uses. May read as branding rather than signal. If perceived as too much in implementation review, demote the funnel stage-3 fill to ink-3 to reserve accent for the renewal moments.
- **Trust gap on the hero number.** The page asserts `S$14,720` with the colophon caveat in 12.5px micro-copy. A skeptical operator will want a "How we count this" affordance near the hero. Out of scope; see §13.

## 12. Definition of done

**Visual / structural:**

- [ ] All sections in §4 render correctly against `goodFixture`, `quietFixture`, `problemFixture` (incl. updated fixtures with populated `managedComparison`).
- [ ] No `$` outside `S$` in rendered DOM (test in §7).
- [ ] No green / red colors anywhere in `reports.module.css`.
- [ ] Mobile (`< 760px`) renders campaigns as cards; funnel rows stack at `< 520px`. Mobile renders **either** the table cards **or** the table scroll — never both.
- [ ] Colophon does not render `schema · reports/v1` — verified by a test that asserts the string is absent from customer-facing DOM.

**Currency:**

- [ ] Backend currency formatter swap landed: `formatCurrencySGD` added to `period-helpers.ts`, swapped at the two call sites in `pull-quote-generator.ts` and `cost-vs-value-rule.ts`.
- [ ] Backend-generated `pullquote.value`, `pullquote.cost`, and `costNarrative` all render with `S$`, never `$`, against fresh live data.
- [ ] `fmtSGD(447.75, { withCents: "always" })` → `"S$447.75"`.
- [ ] `fmtSGD(14720, { withCents: "never" })` → `"S$14,720"`.
- [ ] `fmtSGD` returns `"—"` (em-dash) for `null` / `undefined`; never `"S$NaN"`.

**Live / fixture / error behavior:**

- [ ] `NEXT_PUBLIC_REPORTS_LIVE=false` shows fixture data with no fetch; `=true` triggers fetch.
- [ ] Live-mode error (`error !== null`) still renders the topbar, page head, and window selector — only the section beneath is replaced by the error banner.
- [ ] No-connection banner reads from connections context, **never** from funnel data, and **never** appears in fixture mode (`liveMode === false`).
- [ ] Refresh button label transitions: `Refresh` → `Refreshing…` → `Still loading…` at ≥3s.
- [ ] During an in-flight refresh, window-selector buttons are either disabled or handle the switch safely (cancel the in-flight refetch, start a new one keyed to the new window; do not commit stale data to the new window).

**Data edge cases:**

- [ ] `managedComparison.ads === null && conversations !== null` renders a single comparison column cleanly (no empty placeholder for the null side).
- [ ] Symmetric: `conversations === null && ads !== null` renders only the Ads column.
- [ ] Both pairs null + `emptyMessage` populated renders only the eyebrow + emptyMessage; both pairs null + no `emptyMessage` hides the whole section.
- [ ] Campaign totals row handles `null` `costPerInlineLinkClick` and `null` `cpl` without producing `NaN` or `"S$NaN"` — the totals cell shows `—` when no rows contribute a non-null value.
- [ ] Dead campaign rows (clicks === 0 OR (roas === 0 AND leads === 0)) render with the ink-4 muted treatment, not red.

**Copy:**

- [ ] Eyebrow / column copy uses operator-friendly phrasing (no "Attributed pipeline", no "SDR + agency alt.", no "cohort comparison · same-period", no "Recompute").

**Build / type / lint:**

- [ ] Coverage holds at core thresholds (65/65/70/65) — unaffected since rollups unchanged.
- [ ] `pnpm --filter @switchboard/dashboard build` passes locally (per memory: `next build` is not in CI).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.

## 13. Out of scope (followup ideas, do not implement here)

- Print stylesheet / PDF export.
- Section anchors (`#attribution`, `#campaigns`) and a sticky right-rail outline.
- Per-campaign drilldown.
- Year-over-year stacked window comparison.
- **"How we count this" affordance** near the attribution hero — a small `(?)` opening a 2–3 sentence drawer explaining the 30-day attribution window and revenue-at-booking recognition. Trust-building work for a skeptical first-time renewer; deserves its own copy + interaction spec.
- **Funnel-stage and ROAS tooltips** for first-time ad buyers — hover-explainers that translate "Impressions / Clicks / Leads / Bookings" and "ROAS rev/spend" into plain-language phrasing. Copy work, not layout.
- **LLM copy tuning** for `pullquote`, `funnelNarrative.text`, and `costNarrative` to prefer operator-plain language (no "creative-fatigue dip", no "attributed pipeline" — backend-side prompt work).
- `formatCurrencyUSD` deprecation in `packages/core/src/reports/period-helpers.ts` once `formatCurrencySGD` lands (low-impact rename PR).
- Cost-vs-value market basis update (S$5,000 + S$3,000 with Singapore footnote).
