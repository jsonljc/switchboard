# Riley per-campaign economic truth → operator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface, at the live approval moment, which target judged each Riley recommendation (campaign Tier-1 vs account Tier-2) + the economic tier, and that campaign's economics (CPL, cost-per-booked, true ROAS) with honest-null — all via the ad-optimizer sink's existing `dataLines` channel.

**Architecture:** Two pure formatting helpers in `recommendation-sink.ts` (`economicBasisLine`, `economicsCells`) feed `buildPresentation`, which gets an optional matching `CampaignEconomicsRow`. `runRecommendationSink` accepts optional `campaignEconomics` and maps it by `campaignId`. `audit-runner.ts` passes the already-in-scope `campaignEconomics` into the sink. `dataLines` already render generically in the mounted `approval-detail-sheet.tsx` — no dashboard or schema change.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Zod schemas, Vitest. Package: `@switchboard/ad-optimizer` (Layer 2, surface-agnostic).

---

## File Structure

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts` — add 2 exported pure helpers + format helpers; thread `economicsRow` into `buildPresentation`; add optional `campaignEconomics` to `RunRecommendationSinkArgs` + map-by-campaignId in `runRecommendationSink`.
- Modify: `packages/ad-optimizer/src/audit-runner.ts:541` — pass `campaignEconomics` into `runRecommendationSink`.
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts` — add unit tests for the helpers + an integration test that the emitted presentation carries basis + economics lines, honest-null.

No new files (keeps `recommendation-sink.ts` < 400 lines; helpers belong beside `buildPresentation`).

---

### Task 1: Pure helper `economicBasisLine`

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts`
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`

- [ ] **Step 1: Write the failing tests** (append a new `describe` to the test file)

```ts
import { economicBasisLine, economicsCells } from "../recommendation-sink.js";

describe("economicBasisLine", () => {
  it("names this campaign's own target for targetSource=campaign (Tier-1)", () => {
    expect(economicBasisLine({ economicTier: "booked_cac", targetSource: "campaign" })).toBe(
      "Judged against this campaign's own booked-CAC target.",
    );
  });
  it("names the account-level target for targetSource=account (Tier-2)", () => {
    expect(economicBasisLine({ economicTier: "booked_cac", targetSource: "account" })).toBe(
      "Judged against the account-level booked-CAC target.",
    );
  });
  it("adapts the phrase per economic tier", () => {
    expect(economicBasisLine({ economicTier: "cpl", targetSource: "campaign" })).toBe(
      "Judged against this campaign's own cost-per-lead target.",
    );
    expect(economicBasisLine({ economicTier: "cpc", targetSource: "account" })).toBe(
      "Judged against the account-level cost-per-click target.",
    );
  });
  it("returns null (honest-null/back-compat) when targetSource is absent", () => {
    expect(economicBasisLine({ economicTier: "booked_cac" })).toBeNull();
    expect(economicBasisLine({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-sink`
Expected: FAIL — `economicBasisLine is not a function` (import unresolved).

- [ ] **Step 3: Implement** (add near the top of `recommendation-sink.ts`, after the imports)

```ts
import type {
  EconomicTierSchema as EconomicTier,
  TargetSourceSchema as TargetSource,
} from "@switchboard/schemas";
import type { CampaignEconomicsRow } from "./analyzers/source-comparator.js";

const TIER_PHRASE: Record<EconomicTier, string> = {
  booked_cac: "booked-CAC",
  cpl: "cost-per-lead",
  cpc: "cost-per-click",
};

/**
 * Operator-facing one-liner naming WHICH target judged this recommendation —
 * the campaign's own booking-calibrated target (Tier-1) vs the account-level
 * fallback (Tier-2) — qualified by the economic tier. Surface-agnostic (no UI
 * ref). Returns null when targetSource is absent (back-compat / honest-null) so
 * pre-Gate-4 recs add no line. No "$" — the dollars-at-risk scrape reads only
 * estimatedImpact, and the on-rec calibrated target is a CPL-equivalent, not the
 * raw booked-CAC, so printing it would mislead.
 */
export function economicBasisLine(rec: {
  economicTier?: EconomicTier;
  targetSource?: TargetSource;
}): string | null {
  if (!rec.targetSource) return null;
  const phrase = rec.economicTier ? TIER_PHRASE[rec.economicTier] : "configured";
  const owner = rec.targetSource === "campaign" ? "this campaign's own" : "the account-level";
  return `Judged against ${owner} ${phrase} target.`;
}
```

- [ ] **Step 4: Run to verify the `economicBasisLine` tests pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-sink`
Expected: the `economicBasisLine` describe passes (the `economicsCells` import still fails until Task 2 — acceptable mid-task; proceed).

---

### Task 2: Pure helper `economicsCells` + thread into presentation + sink

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts`
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe("economicsCells", () => {
  const row = (o: Partial<CampaignEconomicsRow> = {}): CampaignEconomicsRow => ({
    campaignId: "c-1",
    cpl: 12,
    costPerBooked: 48.5,
    bookedValueCents: 30000,
    trueRoas: 2.3,
    ...o,
  });
  it("formats CPL (dollars), cost-per-booked (dollars), true ROAS (major) without re-division", () => {
    expect(economicsCells(row())).toEqual(["CPL $12", "$48.50/booked", "2.3x true ROAS"]);
  });
  it("renders null trueRoas as 'not yet attributed' (never a fabricated $0)", () => {
    expect(economicsCells(row({ trueRoas: null, bookedValueCents: null }))).toEqual([
      "CPL $12",
      "$48.50/booked",
      "true ROAS not yet attributed",
    ]);
  });
  it("omits null cpl / costPerBooked cells", () => {
    expect(economicsCells(row({ cpl: null, costPerBooked: null }))).toEqual(["2.3x true ROAS"]);
  });
  it("returns [] when there is no row and when every metric is null", () => {
    expect(economicsCells(undefined)).toEqual([]);
    expect(
      economicsCells(
        row({ cpl: null, costPerBooked: null, bookedValueCents: null, trueRoas: null }),
      ),
    ).toEqual([]);
  });
});

describe("runRecommendationSink — economic basis + per-campaign economics in dataLines", () => {
  it("attaches the matching campaign's basis + economics lines to the emitted presentation", async () => {
    const captured: RecommendationInput[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      captured.push(input);
      return { surface: "queue" as const };
    });
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-econ",
      recommendations: [
        baseRec({ campaignId: "c-1", economicTier: "booked_cac", targetSource: "campaign" }),
      ],
      emit,
      emissionContext: { cronId: "cron" },
      campaignEconomics: {
        rows: [
          {
            campaignId: "c-1",
            cpl: 12,
            costPerBooked: 48.5,
            bookedValueCents: 30000,
            trueRoas: 2.3,
          },
          { campaignId: "c-other", cpl: 1, costPerBooked: 2, bookedValueCents: 3, trueRoas: 4 },
        ],
      },
    });
    const lines = captured[0]!.presentation.dataLines as unknown as string[][];
    const flat = lines.map((l) => l.join(" · "));
    expect(flat).toContain("Judged against this campaign's own booked-CAC target.");
    expect(flat).toContain("CPL $12 · $48.50/booked · 2.3x true ROAS");
    // does not leak another campaign's economics
    expect(flat.some((l) => l.includes("$2/booked"))).toBe(false);
  });

  it("omits both lines when targetSource/economics are absent (back-compat unchanged)", async () => {
    const captured: RecommendationInput[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      captured.push(input);
      return { surface: "queue" as const };
    });
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-plain",
      recommendations: [baseRec({ campaignId: "c-1", estimatedImpact: "saves $40/day" })],
      emit,
      emissionContext: { cronId: "cron" },
    });
    const lines = captured[0]!.presentation.dataLines as unknown as string[][];
    expect(lines).toEqual([["saves $40/day"], ["Learning phase: no impact"]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-sink`
Expected: FAIL — `economicsCells is not a function` and `campaignEconomics` not accepted / lines missing.

- [ ] **Step 3: Implement** — add the `economicsCells` helper + format helpers (after `economicBasisLine`):

```ts
function fmtDollars(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/**
 * Per-campaign economics cells for the approval-moment dataLines. Honest-null:
 * cpl/costPerBooked cells appear only when non-null; trueRoas renders
 * "not yet attributed" when null but other signal exists (never a fabricated 0),
 * and an all-null row yields []. Units are formatted as-is — cpl/costPerBooked
 * are dollars, trueRoas is already major; nothing is re-divided. bookedValueCents
 * (CENTS) is not shown directly (it is the trueRoas numerator).
 */
export function economicsCells(row: CampaignEconomicsRow | undefined): string[] {
  if (!row) return [];
  const cells: string[] = [];
  if (row.cpl !== null) cells.push(`CPL ${fmtDollars(row.cpl)}`);
  if (row.costPerBooked !== null) cells.push(`${fmtDollars(row.costPerBooked)}/booked`);
  if (row.trueRoas !== null) cells.push(`${row.trueRoas.toFixed(1)}x true ROAS`);
  else if (cells.length > 0) cells.push("true ROAS not yet attributed");
  return cells;
}
```

Change `buildPresentation`'s signature + `dataLines`:

```ts
function buildPresentation(
  rec: RecommendationOutput,
  economicsRow?: CampaignEconomicsRow,
): {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: string[][];
  acceptToast: string;
  declineToast: string;
} {
  // ...existing `labels` map unchanged...
  const found = labels[rec.action];
  const basis = economicBasisLine(rec);
  const economics = economicsCells(economicsRow);
  return {
    primaryLabel: found.primary,
    secondaryLabel: found.secondary,
    dismissLabel: "Dismiss",
    dataLines: [
      [rec.estimatedImpact],
      ...(basis ? [[basis]] : []),
      ...(economics.length > 0 ? [economics] : []),
      [`Learning phase: ${rec.learningPhaseImpact}`],
    ],
    acceptToast: found.accept,
    declineToast: found.decline,
  };
}
```

Add the optional arg to `RunRecommendationSinkArgs` and thread it:

```ts
export interface RunRecommendationSinkArgs {
  orgId: string;
  auditRunId: string;
  recommendations: RecommendationOutput[];
  emit: RecommendationEmitter;
  emissionContext: EmissionContext;
  /** PR2 Gate-4: per-campaign economics (audit-runner output), matched by
   * campaignId so each rec's approval card shows its own CPL / cost-per-booked /
   * true ROAS. Optional — absent for analysis-only callers (unchanged behavior). */
  campaignEconomics?: { rows: CampaignEconomicsRow[] };
}
```

In `runRecommendationSink`, before the loop:

```ts
const economicsByCampaign = new Map<string, CampaignEconomicsRow>();
for (const row of args.campaignEconomics?.rows ?? []) economicsByCampaign.set(row.campaignId, row);
```

and in the `emit({...})` object change the presentation line to:

```ts
        presentation: buildPresentation(rec, economicsByCampaign.get(rec.campaignId)),
```

- [ ] **Step 4: Run the full sink suite (new + existing) to verify green**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-sink`
Expected: PASS — all new tests + all pre-existing tests (toasts, effects, humanize, spend-not-scraped, resetsLearning invariant) still green.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts
git commit -m "feat(ad-optimizer): surface per-rec economic basis + campaign economics in approval dataLines"
```

---

### Task 3: Thread `campaignEconomics` into the sink call (audit-runner)

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts` (the `runRecommendationSink({...})` call ~line 541)

- [ ] **Step 1: Confirm the in-scope variable** — `campaignEconomics` is built ~lines 509-526 (before the sink call) and is `{ rows: CampaignEconomicsRow[] } | undefined`.

- [ ] **Step 2: Edit the call** to pass it through (spread to keep it omitted when undefined — `exactOptionalPropertyTypes` friendly):

```ts
const sinkResult = await runRecommendationSink({
  orgId: this.config.orgId,
  auditRunId,
  recommendations,
  emit: this.recommendationEmitter,
  emissionContext: this.recommendationEmissionContext!,
  ...(campaignEconomics ? { campaignEconomics } : {}),
});
```

- [ ] **Step 3: Run the ad-optimizer suite (audit-runner + sink) to verify green**

Run: `pnpm --filter @switchboard/ad-optimizer test`
Expected: PASS — including `audit-runner-percampaign-target.test.ts` (campaignEconomics computation unchanged) and the sink suite.

- [ ] **Step 4: Commit**

```bash
git add packages/ad-optimizer/src/audit-runner.ts
git commit -m "feat(ad-optimizer): pass per-campaign economics into the recommendation sink"
```

---

### Task 4: Full gate + advisory-only proof

- [ ] **Step 1: Typecheck, lint, format, arch, build, eval**

```bash
pnpm typecheck
pnpm --filter @switchboard/ad-optimizer test
pnpm --filter @switchboard/dashboard build
pnpm arch:check
pnpm lint
pnpm format:check
pnpm eval:riley
```

Expected: all green. (`Eval — Claim Classifier` baking flake on main is out-of-scope; `eval:riley` must pass.)

- [ ] **Step 2: Prove advisory-only** — confirm the diff adds no mutating path:

```bash
git diff origin/main -- packages/ad-optimizer | grep -nE "PlatformIngress|\.submit\(|fetch\(|graph\.facebook|POST|mutation" || echo "NO mutating/network calls added"
```

Expected: "NO mutating/network calls added" (only presentation/formatting + an optional arg).

---

## Self-Review

- **Spec coverage:** (a) basis at approval moment → `economicBasisLine` in `dataLines` (Task 1/2). (b) per-campaign economics (CPL, cost-per-booked, true ROAS) honest-null → `economicsCells` (Task 2). Surface-agnostic sink → all changes in ad-optimizer, no UI import. Advisory-only → Task 4 Step 2 proof. Dead-surface deferral → documented in spec + PR. ✓
- **Placeholder scan:** none — every step has concrete code/commands. ✓
- **Type consistency:** `economicBasisLine`/`economicsCells`/`CampaignEconomicsRow`/`campaignEconomics` names are identical across tasks; `buildPresentation(rec, economicsRow?)` matches the call site. Verify `RecommendationOutput` (from `recommendation-engine.js`) structurally carries optional `economicTier`/`targetSource` (it is the schema infer) — typecheck enforces. ✓
