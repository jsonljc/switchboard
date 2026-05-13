# /reports — Editorial Second Pass

**Date:** 2026-05-13
**Branch:** `docs/reports-editorial-design-spec` → PR to `main`
**Scope:** Typographic / layout rebuild of the existing `/reports` page over the locked v1 backend schema. No schema, endpoint, or rollup changes.
**Status:** Spec for review.
**Companion docs:** [`docs/design-prompts/2026-05-13-reports.md`](../../design-prompts/2026-05-13-reports.md) (backend-grounded design prompt), [`docs/design-prompts/locked/switchboard/project/reports-v2/`](../../design-prompts/locked/switchboard/project/reports-v2/) (mockup source of truth).

---

## 1. Background and intent

`/reports` v1 shipped as PRs R1..R6 (merged 2026-05-11) at `apps/dashboard/src/app/(auth)/(mercury)/reports/`. v1 is functional but reads as a stock SaaS dashboard. The renewal-checkpoint thesis — "Am I getting my S$447 worth?" — wants a deliberately editorial register: a printed statement, not a console.

The Claude Design mockup at `docs/design-prompts/locked/switchboard/project/reports-v2/` (`Reports.html`, `app.jsx`, `sections.jsx`, `data.js`, `styles.css`) is the visual source of truth. Chat 14 captures the final intent verbatim — the structure below mirrors the mockup section-for-section, with one deliberate override (display type) and several reconciliations against the actual locked schema.

This is the typographic / layout pass only. The backend schema at `packages/schemas/src/reports/v1.ts` is locked; the route at `apps/api/src/routes/dashboard-reports.ts` is locked; the rollups in `packages/core/src/reports/*` are locked.

## 2. Non-goals

- **No schema changes.** Don't add fields, don't change `ReportDataV1`, don't widen `ManagedComparisonData`.
- **No new endpoints, no new server computations.** If a mockup detail implies a missing field, design without it and flag in §10.
- **No chart library.** Funnel + share bars + ROAS depth are CSS / inline SVG only.
- **No PDF or export work.** Print stylesheet is out of scope.
- **No new design tokens.** All colors, fonts, spacing values are reused from the mockup's `styles.css`. Cross-surface decisions go to `docs/design-prompts/shared-conventions.md` (wave 1.5) — flagged in §10, not introduced here.
- **No copy rewrites for narrative strings.** `pullquote`, `funnelNarrative.text`, `costNarrative`, `emptyMessage` come from the backend; design renders them as-is.

## 3. Layered inputs and their authority

In order of precedence when they conflict:

1. **Locked backend schema** (`packages/schemas/src/reports/v1.ts`) — non-negotiable. Field names, types, optionality.
2. **Backend-grounded prompt** (`docs/design-prompts/2026-05-13-reports.md`) — section list, layout intent, anti-patterns.
3. **Locked mockup** (`docs/design-prompts/locked/switchboard/project/reports-v2/`) — concrete tokens, typography, animations, component composition.
4. **Chat transcripts** (`chats/chat14.md`, `chat15.md`) — design rationale.

Specific overrides in this spec:

- **Display type.** Prompt §"Design system" says Instrument Sans. Chat 14 and the mockup CSS override to **Cormorant Garamond** to match the established editorial register on `/activity` and `/approvals`. We follow the mockup.
- **Riley/Alex share bars.** Prompt does not call these out; mockup includes them. We follow the mockup.
- **Monetary unit.** Prompt and mockup say SGD cents (`fmtSGD(cents)`). The locked backend emits **whole dollars with optional decimals** — see §6. We adapt the formatter; this is the most important reconciliation.

## 4. Page structure (top to bottom)

Maps 1:1 to the mockup's `ReportsApp` render tree in `app.jsx`. Each subsection lists the mockup anchor and the schema fields it reads.

### 4.1 Page-internal topbar (non-sticky)

**Mockup anchor:** `app.jsx` lines 78–101, CSS `.topbar`.

The mockup renders a sticky topbar with brand cluster + breadcrumb + live pip + clock + user avatar. The production app already provides a sticky app-shell nav, so this surface renders the topbar **non-sticky, inside the page** (drop the `position: sticky` from the mockup CSS). Two sticky bars on one screen is the failure mode we're avoiding — see §10.5.

- Left cluster: Switchboard mark (inline SVG, 20×20, two eyes + amber smile from `app.jsx:7-16`), `Switchboard / {org} / Reports`. Mono 11.5px slashes.
- Right cluster: live/sample data pip (green dot for live, pulsing amber for sample), SGT clock (ticks every 30s), user avatar with initials.
- `Reports` breadcrumb gets the amber 1.5px underline (`.brand-page`).
- Org name and current-user initials are **not in the locked schema response**. They come from the existing dashboard session context — see §10.

### 4.2 Page head (title + folio + window selector + recompute)

**Mockup anchor:** `app.jsx` lines 103–144, CSS `.page-head`.

- Eyebrow `Statement · /reports` (mono, 11px, 0.14em tracking, ink-3).
- Display title: `Operator's <span class="accent">Statement.</span>` — Cormorant Garamond `clamp(36px, 4.6vw, 56px)`, weight 500, the period in italic amber-deep.
- Page sub: 14.5px Inter, ink-3, max 38em — body copy from the mockup verbatim ("A renewal-checkpoint reading…").
- Right rail (right-aligned, stacked):
  1. `dateFolio` from schema — mono 13px, 0.12em tracking, 1px ink underline.
  2. Segmented window selector — three `<button>`s: `THIS WEEK`, `THIS MONTH`, `THIS QUARTER`. Active state: ink fill, paper text. Drives the `?window=` query param and `useReportWindow()` state.
  3. Recompute control: small mono button + "cached N{m ago}" label. Tick interval increments label every 60s. Click → POST `/api/dashboard/reports/refresh?window=…`, then invalidate the React Query key.

The "cached N{m ago}" timer is **not in the schema response** in any current field. v1 already implements the refresh POST; the visible cache-age label is new. See §10 — we read `Cache-Control: max-age` from the response headers if available, otherwise show "just now" after a refresh and "—" before any local refresh has occurred.

### 4.3 No-connection banner (conditional)

**Mockup anchor:** `app.jsx` lines 147–156, CSS `.banner-noconn`.

Render when `liveMode === true` AND `funnel[0].n === 0` (Impressions = 0 → no Meta Ads connection). Three-column grid: eyebrow + italic Cormorant message + mono "Connect under Settings" CTA → links to `/settings/connections`.

The mockup uses a tweak panel toggle for this state; in production we infer from the data (any funnel.n === 0 across all five stages OR `attribution.riley.value === 0` AND impressions === 0 are both strong signals — we use the impressions check as the canonical missing-connection condition because Stripe/booking data can flow without Meta).

### 4.4 Pull quote

**Mockup anchor:** `sections.jsx` `PullQuote`, CSS `.pullquote-wrap` / `.pullquote`.

- Renders `pullquote.{pre, value, mid, cost, post}` as a single paragraph. `value` and `cost` get the `.em` treatment: Cormorant italic, amber underline (1.5px), amber-paper highlight on bottom 30%.
- Max width 36rem, centered. Hairline rule above + below. Cormorant `clamp(22px, 2.6vw, 32px)`, weight 400, line-height 1.32.
- The fade-in animation keys on `value + cost` so window changes re-animate the quote.
- **Important:** schema's `value` and `cost` are pre-formatted strings (e.g., `"S$14,720"`) generated by `pull-quote-generator.ts`. The pull-quote generator must emit `S$` strings — see §6.

### 4.5 Attribution

**Mockup anchor:** `sections.jsx` `Attribution`, CSS `.attr-block`.

- Hero number: `S$` (mono superscript) + `{total}` (Cormorant `clamp(64px, 9vw, 132px)`, weight 500, tabular nums). Computed from `attribution.total` rendered as integer (no decimals at this size).
- Aside (next to hero, bottom-aligned): eyebrow "vs. previous period", delta badge (see below), italic Cormorant 17px desc — copy from the mockup verbatim ("Pipeline value attributed by closed bookings, weighted by service price at the point of sale.").
- Delta badge: arrow glyph + text. `pos` = amber-paper background with amber-deep ink. `neg` = ink border, ink text — no red. `flat` = dashed border, ink-3. **No green/red.**
- Riley/Alex split below: 50/50 grid, hairline borders. Each card:
  - `who-glyph` circle: `R` (paper, ink border) for Riley; `A` (ink, paper text) for Alex.
  - `who-name` in Cormorant 20px; `who-role` in mono uppercase ("Ad-ops" / "Conversations").
  - `val` in mono 30px (formatted via `fmtSGD`).
  - `cap` in Inter italic 13.5px — uses schema's `riley.caption` / `alex.caption` strings.
  - `share-line`: 1px hairline + animated 3px fill at `(value / total) * 100%`; Riley fills with ink, Alex with amber-deep; mono share percentage to the right.
- The schema says `attribution.delta: Delta` (required, non-nullable). The mockup typed it as `Delta|null`; we render the delta unconditionally.

### 4.6 Funnel

**Mockup anchor:** `sections.jsx` `Funnel`, CSS `.funnel`.

- Five rows. **Schema invariant: always 5 rows, in the order returned.** The schema docstring at v1.ts:8-11 mentions "Landing visits may be hidden client-side" — we do not hide it. (Flagged in §10.)
- Each row is a 4-column grid: stage label (mono uppercase 11px, 130px column) · bar (flex, 22px tall, fill bar 14px) · numeric label (mono 15px right-aligned, 90px column) · delta chip (mono 10.5px right-aligned, 80px column).
- Fill colors stage-by-stage via `[data-i]` selectors:
  - `0` (Impressions) → `--ink`
  - `1` (Clicks) → `--ink-2`
  - `2` (Landing visits) → `--ink-3`
  - `3` (Leads) → `--amber-deep`
  - `4` (Bookings) → `--amber`
- Bar width: `(n / max(funnel.n)) * 100%` — Impressions naturally fills the row. CSS transition 800ms.
- Top of first row + bottom of last row are 1px ink (the editorial "rules"); inner separators are hair-soft 1px.
- Below the bars: `funnelNarrative` byline — 130px marker column ("Riley · Apr 22", amber-deep mono with a 14px amber dash before it) + Cormorant italic 19px body in `text-wrap: pretty`.
- Delta chip: `pos` → amber-deep, `neg` → ink, `flat` → ink-4. Renders `delta.text` verbatim (already includes the arrow glyph). `delta == null` renders an em-dash.

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
| ROAS     | rev/spend  | `roas`                                    | `(v).toFixed(2) + "×"` with amber-underline depth   |

- Header style: mono 10px, 0.14em tracking, uppercase, ink-3. Sortable headers (all of them) show an amber down-arrow on hover; active header shows the arrow opaque + rotates 180° on `asc`. Default sort: revenue desc.
- Sticky first column with a 1px hair right border and paper background; matches the paper-warm tone on hover.
- ROAS depth: `--roas-depth: min(1, c.roas / max(roas))` drives the opacity of a 2px amber underline beneath the value. Dead campaigns (clicks === 0 OR (roas === 0 AND leads === 0)) drop the value to ink-4. **No red.**
- Totals row in `<tfoot>`: bold mono, paper-warm background, 1px ink top border, all 9 columns filled. Totals are computed client-side from the supplied rows (matches the mockup; we do not request a server-side total).
- Mobile (`<= 760px`): the `<table>` swaps for a card list (`.tbl-cards`) — see mockup CSS lines 716–756. Each card shows campaign name + ROAS pill on top, then a 2-column grid of Spend / Revenue / Clicks·CTR / Leads·CPL. **Horizontal table scroll is suppressed on mobile** (one fallback, never both).

### 4.8 Cost vs Value (renewal punchline)

**Mockup anchor:** `sections.jsx` `CostVsValue`, CSS `.cost-block`.

Three cells in a 1fr / 1fr / 1.35fr grid (the saving cell is wider on purpose):

- **You pay** — mono 30px, ink. Label "Switchboard subscription, this period".
- **SDR + agency alt.** — mono 30px, ink-3, **strikethrough** (1px ink-4 line-through). Label "market-rate equivalent".
- **Monthly saving** — Cormorant `clamp(48px, 6vw, 80px)`, amber-deep, with mono `S$` superscript. Paper-warm background. Label "net to your P&L".

The whole block sits in a 1px ink top + bottom rule. Beneath: `costNarrative` in Cormorant italic 19px (the backend-supplied string, currently US-framed — flagged in §10).

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

- Each pair owns its own `delta` (we don't compute `(managed/unmanaged - 1) * 100` client-side as the mockup does at `sections.jsx:391-394` — we render `pair.delta.text` directly using the same `DeltaBadge` component as elsewhere).
- `ads` and `conversations` are independently nullable. Render each column only when its pair is non-null; if both null, render the section title + the `emptyMessage` if provided (Cormorant italic, ink-3); if both null AND no emptyMessage, the whole section is hidden.
- Metric coverage: render `spend`, `revenue`, `roas` rows for `ads`; render `replies`, `conversionRate`, `replyMinutesP50` rows for `conversations`. Skip any row whose value is `undefined` on both sides.
- Show `source` as a small mono caption beneath the section eyebrow: `"cohort comparison · same-period"` for `in-period-cohort`, `"vs. your pre-Switchboard baseline"` for `pre-switchboard-baseline`.
- Layout matches the mockup: two columns (Ads / Conversations), each metric is a `label` row + a managed-side + an unmanaged-side. Unmanaged value drops to ink-3. The pair-level delta sits beneath the managed value in amber-deep mono.

### 4.10 Colophon (footer)

**Mockup anchor:** `sections.jsx` `Colophon`, CSS `.colophon`.

- Left: eyebrow `Colophon`, italic Cormorant 22px period (from `report.period`), 12.5px Inter italic caveat text (copy from mockup verbatim).
- Right: mode pip (`Live data` with green dot when `NEXT_PUBLIC_REPORTS_LIVE`, `Sample data` with amber dot otherwise), `generated {ISO timestamp formatted}`, `org · {org}`, `schema · reports/v1`.
- The "generated" timestamp source: `Cache-Control` `max-age` doesn't carry the original timestamp. We use the time we received the response (i.e., React Query's `dataUpdatedAt`) for live mode, and a hardcoded `meta.generatedAt` for fixture mode. See §10.

## 5. Live vs fixture mode

Single switch: `NEXT_PUBLIC_REPORTS_LIVE` read via the existing `isMercuryToolLive("reports")` helper.

- `false` (fixture): render `FIXTURES_BY_WINDOW[window]` synchronously. No fetch.
- `true` (live): React Query fetches `GET /api/dashboard/reports?window=…`. Refresh button calls `POST /api/dashboard/reports/refresh?window=…` then invalidates the query key.

The existing `useReportData` hook at `apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts` is kept as-is. The new page mounts the same hook.

**Fixture parity:** the three fixtures in `apps/dashboard/.../fixtures.ts` currently emit USD-framed copy and dollars-as-integers (e.g., `"$14,700"`). Updating them is in-scope:

- Rewrite to match the mockup's `data.js` content (Aurora Aesthetics, Singapore medspa context, `S$` strings, populated `managedComparison` on goodFixture, populated `managedComparison` on problemFixture with `source: "in-period-cohort"`, `null` on quietFixture).
- Keep the numeric values as whole-dollar / decimal-dollar amounts (NOT cents), to remain consistent with the backend (§6).
- Adopt the mockup's campaign names ("Spring-Hydrafacial", "Botox-Touchup-Q2", etc.) — these are more realistic medspa services than v1's generic names.

**Empty / loading states:**

- Loading (`!data && isLoading`): the page shell renders with a 200ms skeleton fade-in on the hero number, attribution split, funnel bars, and table rows. No spinner; the editorial register prefers a quiet skeleton.
- Error (`error !== null`): show a single-paragraph banner styled like the no-connection banner but with the error message in italic Cormorant. Mono "Retry" button that calls `refresh()`. Do not render the rest of the page.
- The current v1 returns `null` (renders nothing) when `!fx`; that is acceptable for fixture mode but not for live mode. New behavior: always render the topbar and the static parts of the page head (title, page sub, window selector). `dateFolio` and "cached Nm ago" render as `—` placeholders until data arrives. Section skeletons render beneath.

## 6. Currency: SGD, units, and `fmtSGD`

This is the single biggest reconciliation issue between mockup and backend.

**Backend reality (verified):**

- `packages/core/src/reports/cost-vs-value-rule.ts:39-41` emits `Math.round(paid * 100) / 100` — i.e., **dollars with two decimals**, not cents.
- `packages/core/src/reports/attribution-rule.ts:58-73` computes `total = rileyRevenue + alexRevenue` where revenue from `revenueWithFirstTouch` is in the source currency unit (dollars in current tests).
- The v1 fixtures at `apps/dashboard/.../fixtures.ts` use dollars (`total: 14700`, `paid: 447.75`).
- Currency formatter helper at `apps/dashboard/.../components/format.ts` uses `"$" + Math.round(n)`. Hard-coded USD.

**Mockup reality:**

- `data.js` defines `sgd = (dollars) => Math.round(dollars * 100)` — i.e., stores **cents**.
- `sections.jsx` `fmtSGD(cents)` divides by 100.

**Design decision: backend wins.** The schema doesn't carry a unit annotation, but the production rollups emit dollars and v1 fixtures match. We do not migrate the schema to cents — that would be a backend change. Instead:

- Replace `components/format.ts` with `fmtSGD(dollars, opts?)`:
  - `withCents: "auto" | "always" | "never"` — "auto" → show cents when `|dollars| < 100`.
  - `compact: boolean` — when true and `|dollars| >= 10_000` show `S$XXk`; `|dollars| >= 1_000_000` show `S$X.Xm`.
  - Locale `"en-SG"` for grouping.
  - Returns `"S$" + formatted`. **No bare `$`.**
- Update the pull-quote generator at `packages/core/src/reports/pull-quote-generator.ts` to emit `"S$"` strings instead of `"$"`. This is a one-line change to the prompt template — flagged below as the only **non-pure-design** code change required for the spec to land cleanly. (Without it, the pull quote will read `"$14,700"` while every other number reads `"S$14,700"`.)
- Drop `components/format.ts`'s `fmtMoney` helper. All numbers on this page route through the new `fmtSGD`.

The mockup's `sgd(dollars) => Math.round(dollars * 100)` helper is **discarded** for the production port. Fixtures and live data both emit dollars.

## 7. Component decomposition

```
apps/dashboard/src/app/(auth)/(mercury)/reports/
├── page.tsx                         # unchanged (Next.js route + metadata)
├── reports-page.tsx                 # rewritten — new editorial layout
├── reports.module.css               # rewritten — port from mockup styles.css
├── fixtures.ts                      # rewritten — adopt mockup data (SGD, medspa names)
├── components/
│   ├── topbar.tsx                   # NEW — sticky brand cluster + live pip + clock
│   ├── page-head.tsx                # NEW — title, folio, window selector, recompute
│   ├── no-connection-banner.tsx     # NEW — live-mode-only conditional
│   ├── pull-quote.tsx               # rewritten — hairline-bordered, italic-em words
│   ├── attribution.tsx              # rewritten — hero number + Riley/Alex split + shares
│   ├── funnel.tsx                   # rewritten — 5-stage CSS bars + byline
│   ├── campaigns.tsx                # rewritten — sticky col, sortable, ROAS depth, mobile cards
│   ├── cost-vs-value.tsx            # rewritten — 3-cell, saving as Cormorant punchline
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

- `components/__tests__/delta-badge.test.tsx` — pos/neg/flat rendering.
- `components/__tests__/funnel.test.tsx` — bar width proportions, byline marker.
- `components/__tests__/campaigns.test.tsx` — sort flip, sticky column class, ROAS depth, dead-row class, totals math.
- `components/__tests__/cost-vs-value.test.tsx` — strikethrough on alt cell, saving renders Cormorant.
- `components/__tests__/managed-comparison.test.tsx` — both pairs null → hidden, one pair null → single column, `source` caption.
- `components/__tests__/format.test.ts` — `fmtSGD` boundaries (cents/no-cents, compact, locale grouping).
- `__tests__/reports-page.test.tsx` — full render with goodFixture and problemFixture; assertion: no `$` character appears outside `S$`.

## 8. CSS port strategy

The mockup is plain CSS + Cormorant Garamond / Inter / JetBrains Mono. The production app uses CSS Modules. Port strategy:

- One module file `reports.module.css` mirroring `docs/design-prompts/locked/switchboard/project/reports-v2/styles.css` section-by-section. Rename selectors from kebab-case globals (`.attr-block`, `.funnel-table`) to camelCase module exports (`attrBlock`, `funnelTable`).
- Reuse existing global tokens where they already exist in `apps/dashboard/src/app/globals.css` (paper, ink, amber). Where the mockup defines additional shades (`--paper-warm`, `--paper-deep`, `--hair-soft`, `--hair-strong`, `--amber-soft`, `--amber-paper`, `--ink-2..5`), **add them to the reports module's `:root` block scoped via `:where(:root)`** to avoid leaking to other surfaces. Mirror the mockup values exactly. Promotion to globals is a shared-conventions decision — flagged in §10.
- Fonts: Cormorant Garamond and JetBrains Mono are not currently loaded in `app/layout.tsx`. Load Cormorant Garamond as `--font-display` (already a global token per CLAUDE.md memory) and JetBrains Mono as `--font-mono`. Verify both are listed in `apps/dashboard/src/app/layout.tsx` font imports; add if missing. Inter is already loaded.

## 9. Anti-patterns (reaffirmed)

- **No green / no red.** Delta direction is glyph + amber-depth + ink-only treatments. Negative deltas render with `var(--ink)` border, not `var(--red)`. Verify in the `problemFixture` rendering — the negative delta chip and the negative funnel rows should look quiet and ink-toned, not alarming.
- **No bare `$`.** All currency = `S$`. Add a unit test that scans the rendered DOM for `/\\$(?!S\\$)/` and fails on hits outside of code-block contexts.
- **No emoji, no traffic lights, no KPI tiles, no sparkline-per-number.** The only inline visualizations are: funnel bars, Riley/Alex share lines, ROAS amber-depth underline.
- **No chart library.** No Recharts, no Visx, no D3 imports introduced by this work.
- **No card shadows.** Hairlines only.
- **No horizontal table scroll on mobile.** Use the card fallback instead.
- **No empty placeholder for `managedComparison` when fully null.** Hide the section.

## 10. Shared-conventions input (cross-surface flags)

These are decisions the spec will not make unilaterally — they belong in `docs/design-prompts/shared-conventions.md` (wave 1.5):

1. **`fmtSGD` lives where?** Currently proposed inside `apps/dashboard/.../reports/components/format.ts`. The other four wave-1 surfaces (`/mission`, `/activity`, `/approvals`, plus one more) will likely also need it. Recommended: extract to `apps/dashboard/src/lib/format-sgd.ts` once wave 1 is integrating. **For this spec, ship local; flag for hoist.**

2. **Pull-quote generator currency.** `packages/core/src/reports/pull-quote-generator.ts` currently uses USD-framed strings in its prompt to the LLM. Updating the prompt to require `S$` output is the single non-design-only change this spec implies. It should land in the same PR as the design rebuild — otherwise the pull quote and the rest of the page will disagree on currency. Cost-vs-value narrative in `cost-vs-value-rule.ts` has the same issue (`formatCurrencyUSD`, `"$5,000/mo"`).

3. **Cost-vs-value market basis.** Backend hardcodes `SDR_MONTHLY_USD = 5000, AGENCY_MONTHLY_USD = 3000` and the comment says "US SMB hiring averages." The Singapore-medspa positioning (per project memory, currency, locale) wants S$5,000 + S$3,000 with the comment / footnote updated. Out of scope here — flag for a follow-up backend PR (`packages/core` change), spec'd separately.

4. **Editorial paper / ink token palette.** The mockup defines `--paper`, `--paper-warm`, `--paper-raised`, `--paper-deep`, `--ink-1..5`, `--hair`, `--hair-soft`, `--hair-strong`, `--amber`, `--amber-deep`, `--amber-soft`, `--amber-paper`. Project memory says the dashboard already has `--background: hsl(45 25% 98%)` and `--accent: hsl(30 55% 46%)`. Promotion to globals is a shared-conventions call. This spec scopes them locally to `reports.module.css`.

5. **Topbar with org breadcrumb and clock.** Mockup includes a topbar that isn't part of the editorial chrome on other agent-home pages. The `app-shell.tsx` already provides nav; rendering an additional sticky topbar here means **two sticky bars** unless we suppress the app shell chrome on `/reports`. Decision: render the topbar **inside** the page (non-sticky internally) and rely on the existing app-shell. The mockup's clock + breadcrumb cluster moves into the page-head section instead of a second sticky bar. See §4.1 — this is a deviation from the mockup that the shared-conventions doc should ratify.

6. **Cache-age display.** Showing `cached Nm ago` requires a server-emitted `generated_at` timestamp in the response or a header. Today there is no such field. Behavior in §4.2 falls back to React Query's `dataUpdatedAt`. If wave 1.5 standardizes a `X-Switchboard-Generated-At` header across surfaces, this surface should adopt it.

7. **Org name + current-user initials in the topbar.** Schema doesn't carry these. Read from existing session context (`useSession()`, organization context). No new API call.

8. **Funnel "Landing visits" hide-when-zero.** Schema docstring at v1.ts:8-11 says client may hide; this spec keeps all five stages visible. Hiding it would change the bar proportions discontinuously when a Meta connection lands. Recommend: pin the row visibly and let the bar render at 0% width with the numeric label "—". The shared-conventions doc should ratify whether structural rows ever disappear.

## 11. Risks and open questions

- **Cormorant Garamond load weight.** The mockup uses four weights (400, 500, 600) plus italic 400/500. That's ~6 font files. The existing `app/layout.tsx` font import likely already includes display weights; if not, adding ~120KB of webfont is a measurable LCP cost. Mitigation: use `font-display: swap` and preload only the body weight.
- **Pull-quote currency drift.** If the LLM generator update lags this UI rebuild into a second PR, fixtures will show `S$` and live data will show `$`. Mitigation: ship the generator change in the same PR (it's a one-line prompt edit), and update the LLM evals.
- **ROAS depth interpretation.** Calibrating `--roas-depth` against `max(roas)` means a campaign with ROAS 0.5 next to a campaign with ROAS 15 will show as zero-depth — visually invisible underlining. Mockup accepts this; we accept this. A future enhancement might cap min-depth at 0.15 for non-dead rows; out of scope.
- **Managed-comparison fixture coverage.** v1 fixtures currently all have `managedComparison: null`. Updating goodFixture and problemFixture to populated comparisons is necessary to exercise the §4.9 component during fixture mode. Both ends of the schema's optionality (one pair null, both null + emptyMessage, both pairs populated) need fixture coverage.

## 12. Definition of done

- [ ] All sections in §4 render correctly against `goodFixture`, `quietFixture`, `problemFixture`.
- [ ] No `$` outside `S$` in rendered DOM (test in §7).
- [ ] No green/red colors anywhere in `reports.module.css`.
- [ ] Mobile (`< 760px`) renders campaigns as cards, not horizontal scroll.
- [ ] `NEXT_PUBLIC_REPORTS_LIVE=false` shows fixture data; `=true` triggers fetch.
- [ ] Pull-quote generator emits `S$` strings (single-line prompt change in `packages/core/src/reports/pull-quote-generator.ts`).
- [ ] Coverage holds at core thresholds (65/65/70/65) — unaffected since rollups unchanged.
- [ ] `pnpm --filter @switchboard/dashboard build` passes locally (per memory: `next build` is not in CI).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.

## 13. Out of scope (followup ideas, do not implement here)

- Print stylesheet / PDF export.
- Section anchors (`#attribution`, `#campaigns`) and a sticky right-rail outline.
- Per-campaign drilldown.
- Year-over-year stacked window comparison.
- `formatCurrencyUSD` → `formatCurrencySGD` migration in `packages/core/src/reports/period-helpers.ts` (separate backend PR).
- Cost-vs-value market basis update (S$5,000 + S$3,000 with Singapore footnote).
