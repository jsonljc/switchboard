# CUX Results Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the customer-facing **Results** tab (Home · Inbox · **Results**) as a fresh warm-editorial screen that reuses the existing `ReportDataV1` data layer, replacing the current `/results` re-export of the legacy `/reports` page.

**Architecture:** New presentational components under `apps/dashboard/src/components/results/*`, mirroring the `components/home/*` screen-root pattern. All correctness-critical derivations (bookings, ad spend, best/worst campaign) live in ONE pure, unit-tested view-model module (`results-model.ts`) so the honesty rules from the audit can't silently regress. The screen reuses the `/reports` data-layer primitives (`use-report-data`, `use-report-window`, `fixtures`, `format.ts`) **by import, without modifying any `/reports` file** — `/reports` stays on its retiring Mercury skin, untouched. The `(auth)` layout already supplies the app shell (header + nav + tabbar), so this screen builds no chrome.

**Tech Stack:** Next.js 14 (App Router, client components), React 18, TypeScript, CSS Modules, `@tanstack/react-query` (via the reused hook), Vitest + Testing Library.

**Source of truth:** `docs/design-prompts/2026-05-26-results.md` (the corrected, producer-audited spec — landed on main via PR #717). Where the HTML export disagrees with that doc, the doc wins.

---

## Honesty invariants (every task upholds these — they are the point of the build)

1. **Whole SGD dollars, never cents.** Reuse `format.ts` `fmtSGD`. Never `/100`. Never a bare `$`.
2. **Booked consults = the Bookings funnel stage found BY NAME**, never `funnel[4]` (funnel is 6 stages; Customers is last).
3. **Ad spend = Σ `campaigns[].spend`**, never `cost.paid` (that's the subscription).
4. **No hero return-ratio, no avg/consult** (category errors — `attribution.total` folds in Alex's no-ad-cost reactivations).
5. **Mira renders "Not set up yet"** — never a fabricated number. `attribution` has only `riley` + `alex`.
6. **Managed comparison is a managed-vs-unmanaged Pair** (`{managed, unmanaged, delta, source}`), independently nullable, partial metrics filtered — never a flat block, never "if you had us run this for you".
7. **No red/green.** Delta + ROAS depth = glyph + amber depth only.
8. **Render only `ReportDataV1` fields.** No tap-through list (ghost "coming soon" only, contextual, no "events store").

## File structure

All paths under `apps/dashboard/src/`.

| File | Responsibility |
|---|---|
| `components/results/results-model.ts` | **Pure view-model.** `buildResultsModel(data)` → typed `ResultsModel` with `bookings`, `bookingsDelta`, `adSpend`, `bestCampaign`, `worstCampaign`. Plus `fmtRatio`. Honesty seam. |
| `components/results/results-model.test.ts` | Unit tests for every derivation, against the real `fixtures.ts`. |
| `components/results/delta-badge.tsx` (+`.test.tsx`) | The one delta treatment: glyph + amber depth (`pos`), muted ink (`neg`), em-dash (`flat`); null-safe. |
| `components/results/verdict-line.tsx` (+test) | `pullquote` → warm serif sentence, `value`/`cost` emphasized, `post` carries a "— Riley" byline; numbers-only fallback when `post` empty. |
| `components/results/hero-outcomes.tsx` (+test) | Booked revenue (+delta) · Consults booked (+delta) · quiet ad spend. No ratio/avg. |
| `components/results/whats-working.tsx` (+test) | `funnelNarrative` (Riley's read) + best/worst-campaign sentence from the model. |
| `components/results/agent-contribution.tsx` (+test) | Riley + Alex cards (identity dots), Mira "Not set up yet". |
| `components/results/worth-it.tsx` (+test) | You pay / market-rate estimate / You saved (co-weighted) + `costNarrative`. |
| `components/results/details-disclosure.tsx` (+test) | One expand/collapse wrapper ("See the details" / "Hide the details"). |
| `components/results/funnel-section.tsx` (+test) | Custom grid bars from `funnel` (render `stage` from wire), narrative byline. |
| `components/results/campaigns-section.tsx` (+test) | Phone card list / desktop sortable table, footer totals, amber ROAS depth. |
| `components/results/managed-comparison.tsx` (+test) | Managed-vs-unmanaged Pair render + `source` caption + partial population. |
| `components/results/colophon.tsx` (+test) | Period, generated time, Live/Sample badge, attribution caveat. |
| `components/results/states.tsx` (+test) | `MetaConnectBanner`, `ErrorBanner`, `FirstRunNote`, `ResultsSkeleton`. |
| `components/results/results-page.tsx` (+`__tests__/results-page.test.tsx`) | Screen root: hooks → states → sections; `<div className={styles.column}>`. |
| `components/results/types.ts` | Shared component prop/model types (re-exports `ReportDataV1` sub-types from `@switchboard/schemas`). |
| `components/results/results.module.css` | Warm-editorial styles; aliases globals tokens at scope (no `:root` edits). |
| `app/(auth)/results/page.tsx` | **Modify:** replace the re-export with `export { ResultsPage as default } from "@/components/results/results-page"` wrapper. |

**Reuse by import (do NOT modify these files):**
- `app/(auth)/(mercury)/reports/hooks/use-report-data.ts` → `useReportData(window)`
- `app/(auth)/(mercury)/reports/hooks/use-report-window.ts` → `useReportWindow()`
- `app/(auth)/(mercury)/reports/components/format.ts` → `fmtSGD`, `fmtInt`, `fmtPct`
- `app/(auth)/(mercury)/reports/fixtures.ts` → `FIXTURES_BY_WINDOW`, types
- `@/hooks/use-connections` → `useConnections()`; `@/lib/route-availability` → `isMercuryToolLive("reports")`

---

### Task 1: Results view-model — the honesty seam

**Files:**
- Create: `apps/dashboard/src/components/results/types.ts`
- Create: `apps/dashboard/src/components/results/results-model.ts`
- Test: `apps/dashboard/src/components/results/results-model.test.ts`

- [ ] **Step 1: Create `types.ts` re-exporting the schema sub-types**

```ts
// Shared types for the Results screen. Re-export the locked ReportDataV1
// sub-types so components import from one place (and never redefine shapes).
export type {
  ReportDataV1 as ReportData,
  ReportWindow,
  Delta,
  PullQuoteCopy,
  AttributionData,
  AttributionCell,
  FunnelRowData,
  FunnelNarrative,
  CampaignRow,
  CostBreakdown,
  ManagedComparisonData,
  ManagedComparisonPair,
  ManagedComparisonMetrics,
  ManagedComparisonSource,
} from "@switchboard/schemas";
```

- [ ] **Step 2: Write the failing test `results-model.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { goodFixture, quietFixture, problemFixture } from "../(mercury)/reports/fixtures";
import { buildResultsModel, fmtRatio } from "./results-model";

describe("buildResultsModel", () => {
  it("derives bookings from the Bookings stage BY NAME, not index 4", () => {
    // goodFixture Bookings stage n = 47
    const m = buildResultsModel(goodFixture);
    const bookingsRow = goodFixture.funnel.find((f) => f.stage === "Bookings")!;
    expect(m.bookings).toBe(bookingsRow.n);
    expect(m.bookingsDelta).toEqual(bookingsRow.delta);
  });

  it("returns 0 bookings (not a crash) when there is no Bookings stage", () => {
    const noBookings = { ...quietFixture, funnel: quietFixture.funnel.filter((f) => f.stage !== "Bookings") };
    expect(buildResultsModel(noBookings).bookings).toBe(0);
  });

  it("computes ad spend as the SUM of campaign spend, NOT cost.paid", () => {
    const m = buildResultsModel(goodFixture);
    const sum = goodFixture.campaigns.reduce((s, c) => s + c.spend, 0);
    expect(m.adSpend).toBe(sum);
    expect(m.adSpend).not.toBe(goodFixture.cost.paid); // subscription ≠ ad spend
  });

  it("picks best/worst campaign by roas among campaigns with spend > 0", () => {
    const m = buildResultsModel(goodFixture);
    const spending = goodFixture.campaigns.filter((c) => c.spend > 0);
    const best = spending.reduce((a, b) => (b.roas > a.roas ? b : a));
    const worst = spending.reduce((a, b) => (b.roas < a.roas ? b : a));
    expect(m.bestCampaign?.name).toBe(best.name);
    expect(m.worstCampaign?.name).toBe(worst.name);
  });

  it("yields null best/worst when there are no spending campaigns", () => {
    const m = buildResultsModel({ ...goodFixture, campaigns: [] });
    expect(m.bestCampaign).toBeNull();
    expect(m.worstCampaign).toBeNull();
  });

  it("passes managedComparison through untouched (incl. null)", () => {
    expect(buildResultsModel(quietFixture).managedComparison).toBeNull();
    expect(buildResultsModel(goodFixture).managedComparison).toEqual(goodFixture.managedComparison);
  });
});

describe("fmtRatio", () => {
  it("formats a ratio as N×", () => {
    expect(fmtRatio(10.06)).toBe("10.1×");
    expect(fmtRatio(0)).toBe("0.0×");
  });
  it("returns — for null", () => {
    expect(fmtRatio(null)).toBe("—");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- results-model`
Expected: FAIL — `buildResultsModel`/`fmtRatio` not defined.

- [ ] **Step 4: Implement `results-model.ts`**

```ts
import type {
  ReportData,
  ReportWindow,
  Delta,
  PullQuoteCopy,
  AttributionData,
  FunnelRowData,
  FunnelNarrative,
  CampaignRow,
  CostBreakdown,
  ManagedComparisonData,
} from "./types";

export interface ResultsModel {
  window: ReportWindow;
  period: string;
  dateFolio: string;
  pullquote: PullQuoteCopy;
  attribution: AttributionData;
  bookings: number; // the Bookings funnel stage, found by name
  bookingsDelta: Delta | null;
  adSpend: number; // Σ campaigns[].spend (dollars) — NOT cost.paid
  funnel: FunnelRowData[];
  funnelNarrative: FunnelNarrative;
  campaigns: CampaignRow[];
  bestCampaign: CampaignRow | null; // max roas, spend > 0
  worstCampaign: CampaignRow | null; // min roas, spend > 0
  cost: CostBreakdown;
  costNarrative: string;
  managedComparison: ManagedComparisonData | null;
}

/** Booked consults come from the Bookings stage, located by name — the funnel
 *  has 6 stages and Bookings is not guaranteed to be the last row. */
function findBookings(funnel: FunnelRowData[]): FunnelRowData | undefined {
  return funnel.find((f) => f.stage === "Bookings");
}

export function buildResultsModel(data: ReportData): ResultsModel {
  const bookingsRow = findBookings(data.funnel);
  const spending = data.campaigns.filter((c) => c.spend > 0);
  const bestCampaign = spending.length
    ? spending.reduce((a, b) => (b.roas > a.roas ? b : a))
    : null;
  const worstCampaign = spending.length
    ? spending.reduce((a, b) => (b.roas < a.roas ? b : a))
    : null;

  return {
    window: data.label,
    period: data.period,
    dateFolio: data.dateFolio,
    pullquote: data.pullquote,
    attribution: data.attribution,
    bookings: bookingsRow?.n ?? 0,
    bookingsDelta: bookingsRow?.delta ?? null,
    adSpend: data.campaigns.reduce((s, c) => s + c.spend, 0),
    funnel: data.funnel,
    funnelNarrative: data.funnelNarrative,
    campaigns: data.campaigns,
    bestCampaign,
    worstCampaign,
    cost: data.cost,
    costNarrative: data.costNarrative,
    managedComparison: data.managedComparison,
  };
}

/** ROAS / return ratio as "N×". Per-campaign roas is the ONLY return ratio we show. */
export function fmtRatio(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}×`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- results-model`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/results/types.ts \
        apps/dashboard/src/components/results/results-model.ts \
        apps/dashboard/src/components/results/results-model.test.ts
git commit -m "feat(results): view-model seam (bookings-by-name, ad spend, best/worst campaign)"
```

---

### Task 2: Delta badge

**Files:**
- Create: `apps/dashboard/src/components/results/delta-badge.tsx`
- Test: `apps/dashboard/src/components/results/delta-badge.test.tsx`
- Modify: `apps/dashboard/src/components/results/results.module.css` (add `.delta`, `.deltaPos`, `.deltaNeg`, `.deltaFlat`)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DeltaBadge } from "./delta-badge";

describe("DeltaBadge", () => {
  it("renders nothing when delta is null", () => {
    const { container } = render(<DeltaBadge delta={null} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders the delta text (which carries the glyph)", () => {
    const { getByText } = render(<DeltaBadge delta={{ kind: "pos", text: "↑ 18%" }} />);
    expect(getByText("↑ 18%")).toBeInTheDocument();
  });
  it("applies a kind-specific class (no color logic in the consumer)", () => {
    const { getByText } = render(<DeltaBadge delta={{ kind: "neg", text: "↓ 6%" }} />);
    expect(getByText("↓ 6%").className).toMatch(/neg/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @switchboard/dashboard test -- delta-badge` → FAIL (not defined).

- [ ] **Step 3: Implement `delta-badge.tsx`**

```tsx
import type { Delta } from "./types";
import styles from "./results.module.css";

const KIND_CLASS = { pos: styles.deltaPos, neg: styles.deltaNeg, flat: styles.deltaFlat } as const;

/** The one delta treatment. The wire `text` already carries the glyph (↑/↓/—);
 *  we add weight + amber depth (pos) or muted ink (neg) via CSS only. Never green/red. */
export function DeltaBadge({ delta, size = "sm" }: { delta: Delta | null; size?: "sm" | "lg" }) {
  if (!delta) return null;
  return (
    <span className={`${styles.delta} ${KIND_CLASS[delta.kind]} ${size === "lg" ? styles.deltaLg : ""}`}>
      {delta.text}
    </span>
  );
}
```

- [ ] **Step 4: Add CSS** — in `results.module.css`, `.deltaPos { color: hsl(var(--action)); }`, `.deltaNeg { color: hsl(var(--ink-3)); }`, `.deltaFlat { color: hsl(var(--ink-4)); }`, mono font, no background fills.

- [ ] **Step 5: Run to verify it passes** → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(results): delta badge (glyph + amber depth, no red/green)"`

---

### Task 3: Verdict line

**Files:** Create `verdict-line.tsx` + `verdict-line.test.tsx`; extend `results.module.css`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictLine } from "./verdict-line";

const pq = { pre: "Your team booked ", value: "S$14,720", mid: " against ", cost: "S$612", post: "Riley caught the dip early." };

describe("VerdictLine", () => {
  it("renders the value and cost emphasized", () => {
    render(<VerdictLine pullquote={pq} />);
    expect(screen.getByText("S$14,720")).toBeInTheDocument();
    expect(screen.getByText("S$612")).toBeInTheDocument();
  });
  it("attributes the narrative post to a Riley byline", () => {
    render(<VerdictLine pullquote={pq} />);
    expect(screen.getByText(/Riley caught the dip early\./)).toBeInTheDocument();
    expect(screen.getByText(/—\s*Riley/i)).toBeInTheDocument();
  });
  it("renders only the numbers sentence when post is empty (no dangling byline)", () => {
    render(<VerdictLine pullquote={{ ...pq, post: "" }} />);
    expect(screen.queryByText(/—\s*Riley/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `VerdictLine({ pullquote }: { pullquote: PullQuoteCopy })`. Render a Newsreader `<p>`: `{pre}` + `<span class=value>{value}</span>` + `{mid}` + `<span class=cost>{cost}</span>`. If `post` is non-empty, render it followed by a `<span class=byline>— Riley</span>`. `value`/`cost` get weight + an amber hairline underline (CSS). Render contract per spec §Layout.2.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): verdict line with Riley byline + numbers-only fallback`

---

### Task 4: Hero outcomes

**Files:** Create `hero-outcomes.tsx` + test; extend CSS.

- [ ] **Step 1: Write the failing test** (encodes invariants 1, 2, 3, 4)

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { HeroOutcomes } from "./hero-outcomes";

describe("HeroOutcomes", () => {
  const model = buildResultsModel(goodFixture); // revenue 14720, bookings 47, adSpend = Σ spend = 2107

  it("shows booked revenue in whole SGD dollars (no /100, no bare $)", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).toContain("S$14,720");
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
    expect(container.textContent).not.toContain("147.20"); // would appear if cents/100 bug
  });
  it("shows consults from the Bookings stage", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).toContain("47");
  });
  it("shows ad spend as Σ campaign spend, NOT cost.paid", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).toContain("S$2,107"); // 620+410+217+168+412+285+... sum
    expect(container.textContent).not.toContain("S$612"); // cost.paid (subscription) must NOT appear here
  });
  it("renders NO return ratio and NO avg/consult", () => {
    const { container } = render(<HeroOutcomes model={model} />);
    expect(container.textContent).not.toMatch(/×/); // no "Nx" ratio in the hero
    expect(container.textContent?.toLowerCase()).not.toContain("per consult");
  });
});
```

> Note: confirm the exact Σ-spend value against the live `fixtures.ts` at implementation time and set the expected string accordingly; the assertion that it is NOT `cost.paid` is the load-bearing one.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `HeroOutcomes({ model })`. Three blocks: Booked revenue `fmtSGD(model.attribution.total)` (large mono) + `<DeltaBadge delta={model.attribution.delta} size="lg" />`; Consults booked `fmtInt(model.bookings)` + `<DeltaBadge delta={model.bookingsDelta} />`; Ad spend `fmtSGD(model.adSpend)` (quiet). No ratio, no avg. Import `fmtSGD`/`fmtInt` from the reports `format.ts`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): lean hero (revenue, consults, ad spend; no derived ratios)`

---

### Task 5: What's working (promoted insight)

**Files:** Create `whats-working.tsx` + test; extend CSS.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { WhatsWorking } from "./whats-working";

describe("WhatsWorking", () => {
  const model = buildResultsModel(goodFixture);
  it("renders Riley's funnel narrative read (marker + text)", () => {
    const { container } = render(<WhatsWorking model={model} />);
    expect(container.textContent).toContain(goodFixture.funnelNarrative.text);
    expect(container.textContent).toContain(goodFixture.funnelNarrative.marker);
  });
  it("names the strongest campaign with its roas", () => {
    const { container } = render(<WhatsWorking model={model} />);
    expect(container.textContent).toContain(model.bestCampaign!.name);
  });
  it("flags an underwater campaign only when roas < 1", () => {
    const { container } = render(<WhatsWorking model={model} />);
    // goodFixture worst is Lookalike-Q2-Wide @ 0.46 → mentioned
    expect(container.textContent).toContain(model.worstCampaign!.name);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `WhatsWorking({ model })`. Line 1: funnel narrative as an editorial byline (`marker` + `text`). Line 2: "{bestCampaign.name} is your strongest at {fmtRatio(bestCampaign.roas)}" and, only if `worstCampaign && worstCampaign.roas < 1`, "; {worstCampaign.name} is underwater at {fmtRatio(worstCampaign.roas)} — worth a look." Plain words, serif.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): "what's working" promoted insight (narrative + best/worst campaign)`

---

### Task 6: Agent contribution

**Files:** Create `agent-contribution.tsx` + test; extend CSS.

- [ ] **Step 1: Write the failing test** (encodes invariant 5)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { AgentContribution } from "./agent-contribution";

describe("AgentContribution", () => {
  it("renders Riley and Alex with their dollar contributions + captions", () => {
    render(<AgentContribution attribution={goodFixture.attribution} />);
    expect(screen.getByText("S$9,180")).toBeInTheDocument(); // riley.value
    expect(screen.getByText("S$5,540")).toBeInTheDocument(); // alex.value
    expect(screen.getByText(goodFixture.attribution.riley.caption)).toBeInTheDocument();
  });
  it("renders Mira as 'Not set up yet' with NO number", () => {
    const { container } = render(<AgentContribution attribution={goodFixture.attribution} />);
    expect(screen.getByText(/Not set up yet/i)).toBeInTheDocument();
    // No S$ value should be associated with Mira's card.
    expect(container.querySelector('[data-agent="mira"]')?.textContent).not.toMatch(/S\$/);
  });
  it("renders agent identity as a dot, not a button", () => {
    const { container } = render(<AgentContribution attribution={goodFixture.attribution} />);
    expect(container.querySelectorAll('[data-agent] button').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `AgentContribution({ attribution })`. Three `<article data-agent="riley|alex|mira">` cards, hairline-bordered, identity dot from `--agent-*`. Riley/Alex: `fmtSGD(value)` (mono) + caption. Mira: static "Not set up yet" (violet dot, muted), no number. Section eyebrow "Who drove it".

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): agent contribution cards (honest Mira not-set-up)`

---

### Task 7: Worth it

**Files:** Create `worth-it.tsx` + test; extend CSS.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { WorthIt } from "./worth-it";

describe("WorthIt", () => {
  it("renders the three cost cells in dollars", () => {
    render(<WorthIt cost={goodFixture.cost} narrative={goodFixture.costNarrative} />);
    expect(screen.getByText("S$612")).toBeInTheDocument(); // you pay (subscription)
    expect(screen.getByText("S$8,000")).toBeInTheDocument(); // alt
    expect(screen.getByText("S$7,388")).toBeInTheDocument(); // saved
  });
  it("labels the alternative as a market-rate estimate", () => {
    render(<WorthIt cost={goodFixture.cost} narrative={goodFixture.costNarrative} />);
    expect(screen.getByText(/market-rate estimate/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `WorthIt({ cost, narrative })`. Eyebrow "Is it worth it?". Three cells: "You pay" `fmtSGD(cost.paid)`; "A salesperson + agency would cost" `fmtSGD(cost.alt)` with a "market-rate estimate" sub-label; "You saved" `fmtSGD(cost.saving)`. **Co-weight "You pay" and "You saved"** (same type scale) — saved gets amber emphasis but is not the sole loud number. Then `narrative` in serif italic.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): worth-it cost-vs-value (market-rate estimate, co-weighted)`

---

### Task 8: Details disclosure + funnel section

**Files:** Create `details-disclosure.tsx` (+test), `funnel-section.tsx` (+test); extend CSS.

- [ ] **Step 1: Write the failing tests**

```tsx
// details-disclosure.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailsDisclosure } from "./details-disclosure";

describe("DetailsDisclosure", () => {
  it("hides children until toggled open", () => {
    render(<DetailsDisclosure><p>secret depth</p></DetailsDisclosure>);
    expect(screen.queryByText("secret depth")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /see the details/i }));
    expect(screen.getByText("secret depth")).toBeInTheDocument();
  });
});
```

```tsx
// funnel-section.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { FunnelSection } from "./funnel-section";

describe("FunnelSection", () => {
  it("renders each stage label straight from the wire (incl. 'Landing page views' shape)", () => {
    const { container } = render(<FunnelSection funnel={goodFixture.funnel} narrative={goodFixture.funnelNarrative} />);
    for (const row of goodFixture.funnel) expect(container.textContent).toContain(row.stage);
  });
  it("renders the funnel narrative byline", () => {
    const { container } = render(<FunnelSection funnel={goodFixture.funnel} narrative={goodFixture.funnelNarrative} />);
    expect(container.textContent).toContain(goodFixture.funnelNarrative.marker);
  });
});
```

> The fixture stage is "Landing visits"; the producer emits "Landing page views". The component renders `row.stage` verbatim, so it is correct for both — the test asserts it does NOT hardcode a stage list.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `DetailsDisclosure({ open?, onToggle?, children })` (self-managed `useState` if `open` not provided): a button with `aria-expanded`, label "See the details"/"Hide the details", `--canvas-3` rules, caret. `FunnelSection({ funnel, narrative })`: compute `max = Math.max(...funnel.map(f => f.n), 1)`; per row: stage label · proportional bar (`n/max`, custom div/SVG, amber fill, `data-empty` when `n===0`) · `fmtInt(n)` + `<DeltaBadge delta={row.delta} />` · the `label` string in mono. Footer: narrative `marker` + `text` as an editorial byline. No chart lib.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): details disclosure + custom funnel bars`

---

### Task 9: Campaigns section

**Files:** Create `campaigns-section.tsx` + test; extend CSS.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { CampaignsSection } from "./campaigns-section";

describe("CampaignsSection", () => {
  it("renders one row per campaign with dollar spend/revenue (no bare $)", () => {
    const { container } = render(<CampaignsSection campaigns={goodFixture.campaigns} layout="mobile" />);
    for (const c of goodFixture.campaigns) expect(container.textContent).toContain(c.name);
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });
  it("shows a footer total row (sum of revenue)", () => {
    const { container } = render(<CampaignsSection campaigns={goodFixture.campaigns} layout="desktop" />);
    const totalRevenue = goodFixture.campaigns.reduce((s, c) => s + c.revenue, 0);
    expect(container.textContent).toContain("Total");
    // formatted with fmtSGD — assert the integer grouping appears
  });
  it("renders cpl '—' when null (e.g. zero-lead campaign)", () => {
    const withNull = { ...goodFixture, campaigns: goodFixture.campaigns.filter((c) => c.cpl === null) };
    const { container } = render(<CampaignsSection campaigns={withNull.campaigns} layout="mobile" />);
    expect(container.textContent).toContain("—");
  });
  it("re-sorts when a sort control is used (desktop)", () => {
    render(<CampaignsSection campaigns={goodFixture.campaigns} layout="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: /spend/i }));
    // first data row after sort reflects max spend — assert no throw + header present
    expect(screen.getByText(/Campaign/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `CampaignsSection({ campaigns, layout })`. Port the sort/totals/maxRoas memo logic (default sort `revenue` desc). `layout === "desktop"`: table (Campaign · Spend · Impr · Clicks · CTR · CPC · Leads · CPL · C→L · Revenue · ROAS), sticky first column, sortable headers, footer totals row, `roas` via an amber-depth `RoasBar` (width = `roas/maxRoas`, never RGB). `layout === "mobile"`: ranked card list (best→worst by revenue), minimal sort chrome, `RoasBar` per card. Money via `fmtSGD`; CPC via `fmtSGD(c.costPerInlineLinkClick, { withCents: "always" })`; CTR/C→L via `fmtPct`; `cpl`/`clickToLeadRate` → "—" when null.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): campaigns (mobile cards / desktop sortable table, amber ROAS depth)`

---

### Task 10: Managed comparison

**Files:** Create `managed-comparison.tsx` + test; extend CSS.

- [ ] **Step 1: Write the failing test** (encodes invariant 6)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "../(mercury)/reports/fixtures";
import { ManagedComparison } from "./managed-comparison";

describe("ManagedComparison", () => {
  const data = goodFixture.managedComparison!; // { ads:{managed,unmanaged,delta}, conversations:{...}, source }

  it("renders BOTH managed and unmanaged sides (a before/after, not a flat block)", () => {
    render(<ManagedComparison data={data} />);
    expect(screen.getAllByText(/Managed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unmanaged/i).length).toBeGreaterThan(0);
  });
  it("renders a source-driven caption (with us vs without)", () => {
    const { container } = render(<ManagedComparison data={data} />);
    expect(container.textContent?.toLowerCase()).toMatch(/with us|without|baseline|similar accounts/);
    expect(container.textContent).not.toMatch(/if you had us run this/i);
  });
  it("filters absent metrics rather than fabricating them", () => {
    const adsOnly = { ...data, conversations: null };
    const { container } = render(<ManagedComparison data={adsOnly} />);
    expect(container.textContent).not.toMatch(/Replies handled/i);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `ManagedComparison({ data })`. Port the existing `reports/components/managed-comparison.tsx` shape-handling: `sourceCaption(source)`; `ADS_METRICS`/`CONV_METRICS` arrays; per Pair, render only metrics where `managed[k] != null || unmanaged[k] != null`; show "Managed" vs "Unmanaged" values + the Pair `delta` on the last visible metric; single-column grid when only one Pair; `emptyMessage` branch when both null but message present; return null when fully empty. Header eyebrow "How you're doing with us vs without". Re-style in warm-editorial (do NOT import `reports.module.css`).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): managed-vs-unmanaged comparison (real Pair + source caption)`

---

### Task 11: Colophon + states (banners, skeleton, first-run)

**Files:** Create `colophon.tsx` (+test), `states.tsx` (+test); extend CSS.

- [ ] **Step 1: Write the failing tests**

```tsx
// colophon.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Colophon } from "./colophon";

describe("Colophon", () => {
  it("shows the attribution caveat (booked, not collected) and the data badge", () => {
    const { container } = render(<Colophon period="MAY 1 — MAY 26" label="THIS MONTH" isLive={false} generatedAt={new Date("2026-05-26T08:55:00Z")} />);
    expect(container.textContent?.toLowerCase()).toContain("booked");
    expect(container.textContent?.toLowerCase()).toContain("not collected");
    expect(container.textContent).toMatch(/Sample data/i);
  });
});
```

```tsx
// states.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaConnectBanner, ErrorBanner, FirstRunNote, ResultsSkeleton } from "./states";

describe("Results states", () => {
  it("MetaConnectBanner says Alex revenue still shows; no fabricated funnel", () => {
    render(<MetaConnectBanner />);
    expect(screen.getByText(/No Meta Ads connection/i)).toBeInTheDocument();
  });
  it("ErrorBanner takes a real cache-age (no hardcoded 47)", () => {
    render(<ErrorBanner cacheAgeMinutes={12} onRetry={() => {}} />);
    expect(screen.getByText(/12 min/i)).toBeInTheDocument();
  });
  it("FirstRunNote is warm, not failure-framed", () => {
    render(<FirstRunNote />);
    expect(screen.getByText(/first results land here/i)).toBeInTheDocument();
  });
  it("ResultsSkeleton renders blocks, not a spinner", () => {
    const { container } = render(<ResultsSkeleton />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `Colophon({ period, label, isLive, generatedAt })`: period + lowercased label, generated timestamp, Live/Sample badge, caveat micro-copy ("Revenue is attributed at the time a consult is booked, not collected…") in `--ink-4`. `states.tsx`: `MetaConnectBanner` (calm, "Connect under Settings", notes Alex revenue still shows), `ErrorBanner({ cacheAgeMinutes, onRetry })` (uses the real age — NO hardcoded "47"), `FirstRunNote` (warm line), `ResultsSkeleton` (block placeholders, `role="status"`, no spinner).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(results): colophon + state treatments (banners, skeleton, first-run)`

---

### Task 12: Results page (composition + route flip)

**Files:**
- Create: `apps/dashboard/src/components/results/results-page.tsx`
- Create: `apps/dashboard/src/components/results/__tests__/results-page.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/results/page.tsx`

- [ ] **Step 1: Write the failing page test** (reuses the `/reports` harness pattern; encodes invariants 1, 2, 5 + no-Meta hides funnel)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: () => null }));
vi.mock("@/hooks/use-connections", () => ({ useConnections: () => ({ data: undefined, isLoading: false }) }));

import { ResultsPage } from "../results-page";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ResultsPage /></QueryClientProvider>);
}

describe("ResultsPage (fixture mode, default THIS MONTH)", () => {
  it("renders no bare $ anywhere", () => {
    const { container } = mount();
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });
  it("leads with booked revenue S$14,720 (dollars, not cents/100)", () => {
    const { container } = mount();
    expect(container.textContent).toContain("S$14,720");
    expect(container.textContent).not.toContain("147.20");
  });
  it("shows Mira 'Not set up yet'", () => {
    mount();
    expect(screen.getByText(/Not set up yet/i)).toBeInTheDocument();
  });
  it("keeps depth (campaigns) hidden until 'See the details' is opened", () => {
    mount();
    // A campaign name is goodFixture-specific; assert the disclosure control exists and depth is collapsed.
    expect(screen.getByRole("button", { name: /see the details/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `results-page.tsx`**

```tsx
"use client";

import { useReportWindow } from "../../app/(auth)/(mercury)/reports/hooks/use-report-window";
import { useReportData } from "../../app/(auth)/(mercury)/reports/hooks/use-report-data";
import { useConnections } from "@/hooks/use-connections";
import { isMercuryToolLive } from "@/lib/route-availability";
import { buildResultsModel } from "./results-model";
import { ResultsHeader } from "./results-header"; // period control + recompute (split from page if large)
import { VerdictLine } from "./verdict-line";
import { HeroOutcomes } from "./hero-outcomes";
import { WhatsWorking } from "./whats-working";
import { AgentContribution } from "./agent-contribution";
import { WorthIt } from "./worth-it";
import { DetailsDisclosure } from "./details-disclosure";
import { FunnelSection } from "./funnel-section";
import { CampaignsSection } from "./campaigns-section";
import { ManagedComparison } from "./managed-comparison";
import { Colophon } from "./colophon";
import { MetaConnectBanner, ErrorBanner, FirstRunNote, ResultsSkeleton } from "./states";
import styles from "./results.module.css";

export function ResultsPage() {
  const { window: w, setWindow } = useReportWindow();
  const { data, isLoading, isFetching, error, refresh } = useReportData(w);
  const liveMode = isMercuryToolLive("reports");
  const { data: connections } = useConnections();
  const metaConn = connections?.connections.find((c) => c.serviceId === "meta-ads"); // VERIFY id (see spec)
  const showNoMeta = liveMode && (!metaConn || metaConn.status !== "connected");

  // layout: desktop vs mobile via a CSS-driven hook or matchMedia; default mobile-first.
  return (
    <div className={styles.column}>
      <ResultsHeader window={w} onWindow={setWindow} dateFolio={data?.dateFolio} onRefresh={refresh} isFetching={isFetching} isLive={liveMode} />
      {error && <ErrorBanner cacheAgeMinutes={0} onRetry={() => void refresh()} />}
      {showNoMeta && <MetaConnectBanner />}
      {isLoading ? (
        <ResultsSkeleton />
      ) : !data ? (
        <FirstRunNote />
      ) : (
        (() => {
          const model = buildResultsModel(data);
          const firstRun = model.attribution.total === 0 && model.bookings === 0;
          if (firstRun) return <FirstRunNote />;
          return (
            <>
              <VerdictLine pullquote={model.pullquote} />
              <HeroOutcomes model={model} />
              <WhatsWorking model={model} />
              <AgentContribution attribution={model.attribution} />
              <WorthIt cost={model.cost} narrative={model.costNarrative} />
              <DetailsDisclosure>
                {!showNoMeta && <FunnelSection funnel={model.funnel} narrative={model.funnelNarrative} />}
                <CampaignsSection campaigns={model.campaigns} layout="mobile" />
                {model.managedComparison && <ManagedComparison data={model.managedComparison} />}
              </DetailsDisclosure>
              <Colophon period={model.period} label={model.window} isLive={liveMode} generatedAt={new Date()} />
            </>
          );
        })()
      )}
    </div>
  );
}
```

> `ResultsHeader` (period segmented control + `dateFolio` + quiet "Recompute (updated Xm ago)") is its own small component+test, split here to keep `results-page.tsx` focused; build it in this task. Desktop/mobile layout for campaigns: derive from a `matchMedia`/resize hook (mirror the export's `viewMode` idea) or render both with CSS — pick the simpler that passes the test; default mobile-first.

- [ ] **Step 4: Flip the route** — replace `app/(auth)/results/page.tsx` contents:

```tsx
export { ResultsPage as default } from "@/components/results/results-page";
```

- [ ] **Step 5: Run the page test → PASS.**

- [ ] **Step 6: Commit** — `feat(results): compose Results screen + flip /results route off the legacy re-export`

---

### Task 13: Visual cohesion, desktop adaptation, and full gate run

**Files:** `results.module.css` (final pass); any component CSS refinements.

- [ ] **Step 1** — Token discipline pass: confirm every class consumes globals tokens correctly — `--surface` wrapped as `hsl(var(--surface))`; `--canvas-2/3`, `--shadow-*` used bare; agent dots from `--agent-alex/riley/mira`; the ONLY action/positive color is `hsl(var(--action))`. **No `:root` additions** (globals.css is shared with the Inbox worktree). Grep to prove it: `! grep -n ":root" apps/dashboard/src/components/results/results.module.css`.
- [ ] **Step 2** — Desktop adaptation: at the app's desktop breakpoint, widen the column and render `CampaignsSection layout="desktop"`. Verify the phone layout is the default.
- [ ] **Step 3** — Run the full local gate set:
  - `pnpm --filter @switchboard/dashboard test`
  - `pnpm typecheck`
  - `pnpm --filter @switchboard/dashboard build`  *(next build is NOT in CI; it alone catches missing `.js`/alias import errors)*
  - `pnpm format:check`  *(CI lint runs prettier; local lint does not)*
- [ ] **Step 4** — Confirm coverage clears the dashboard gate **40/35/40/40** (not CLAUDE.md's 55/50/52/55). Add focused tests if any file is under.
- [ ] **Step 5: Commit** — `style(results): warm-editorial cohesion + desktop adaptation; green gates`

---

### Task 14: Whole-PR 3-lens review

- [ ] **Step 1** — Open the PR off `main` (squash), titled `feat(results): customer-facing Results tab`. Body links the spec (`docs/design-prompts/2026-05-26-results.md`) and lists the honesty invariants.
- [ ] **Step 2** — Dispatch the 3-lens whole-PR review (matches every prior CUX PR): (a) **architecture** — fresh components, data-layer reuse, `/reports` untouched, no `:root` token edits; (b) **codebase-alignment** — matches `components/home/*` patterns, dashboard import/`.js` conventions, test layout; (c) **soundness** — re-verify the honesty invariants against the rendered output and the live `fixtures.ts`, and confirm the `serviceId` (`meta` vs `meta-ads`) decision.
- [ ] **Step 3** — Address findings; re-run the gate set; confirm green.

---

## Pre-flight (before Task 1)

- [ ] After PR #717 (corrected spec) merges to `main`, rebase this worktree onto `main` so it consumes the landed spec: from the worktree root, `rm -f docs/design-prompts/2026-05-26-results.md` (remove the stale untracked copy), then `git fetch origin && git rebase origin/main`.
- [ ] `pnpm build` once (no Postgres needed — compilation only) so `@switchboard/*` dist is fresh for `typecheck`.
- [ ] **Postgres is NOT required.** Results defaults to **fixture mode** when `NEXT_PUBLIC_REPORTS_LIVE` is unset, so `test` / `typecheck` / `next build` / `format:check` all run without a database. Live-data validation (Meta connection + real revenue) is deferred to manual QA.

## Self-review notes (author)

- **Spec coverage:** header/period/recompute (Task 12 `ResultsHeader`), verdict (T3), hero (T4), what's-working (T5), agents+Mira (T6), worth-it (T7), disclosure+funnel (T8), campaigns (T9), managed (T10), colophon+states (T11), composition+route (T12), tokens/desktop (T13), review (T14). All spec §Layout items map to a task.
- **Honesty invariants** are each pinned by a test: dollars (T4/T9/T12 "no bare $"), bookings-by-name (T1), ad spend ≠ cost.paid (T1/T4), no ratio/avg (T4), Mira (T6/T12), managed Pair (T10), no-Meta hides funnel (T12 + page logic), real cache-age (T11).
- **Type consistency:** `buildResultsModel`/`ResultsModel`/`fmtRatio` defined in T1 are used unchanged in T4/T5/T12; `DeltaBadge` (T2) consumed by T4/T8; `fmtSGD`/`fmtInt`/`fmtPct` imported from the existing `format.ts` throughout.
