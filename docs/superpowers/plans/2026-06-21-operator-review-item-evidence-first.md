# Operator evidence-first review-item — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the operator approval detail sheet into an evidence-first review item (proposal → evidence → dollar-at-stake → signals → controls) driven by real producer data, and capture a reason when the operator overrides.

**Architecture:** Thread the two recommendation scalars already on the row but dropped by the adapter (`dollarsAtRisk`, `confidence`) onto `Decision.meta`; the api serializer already spreads `...d.meta`, so no api change. Redesign the shared `ApprovalDetailSheet` (serves `approval` + `workflow_approval`; handoffs use a separate sheet) to elevate the existing evidence `dataLines`, add an honest dollar-at-stake block, consolidate signals into one chip row, and delete the dead "What this changes" placeholder. Reason-on-override reuses the `note` param that is already wired UI→core.

**Tech Stack:** TypeScript monorepo (pnpm/Turbo); `@switchboard/core` (decisions read-model + adapters), `apps/dashboard` (Next 14, React, vitest, CSS modules-ish `ds-*` classes in `inbox.css`).

## Global Constraints

- ESM. Relative imports in `packages/core` use `.js` extensions; dashboard imports omit `.js` (relative AND `@/` alias).
- No `any` (use `unknown`/proper types). No `console.log`. Prettier: semi, double quotes, 2-space indent, trailing commas, 100 width.
- No em-dashes anywhere (copy, comments, commits). The `—` no-value glyph is being removed; new blocks omit rather than show a placeholder.
- Money renders only via canonical `formatMoney`/`<Money>` from `@/lib/money`; S$; guard `Number.isFinite(v) && v > 0` (never `S$0`, never `—`).
- Editorial register: mono eyebrows (JetBrains weights 400/500/600 only), Source Serif (`--serif`) titles/hero numerals, amber (`--action`) only on Approve. Ink tokens `--ink/--ink-2/--ink-3` are pre-`hsl()`-wrapped (`var(--ink-3)`); raw triplets need `hsl(var(--x))`. Every new tint+text pairing must meet WCAG AA on cream — prefer the solid `bg-{x} text-{x}-foreground` pairing.
- Co-located `*.test.ts(x)`. Dashboard coverage floor 40/35/40/40. Conventional Commits, lowercase subject, no em-dash.
- Adding a CSS rule while `next dev` runs throws a stale-HMR false alarm; `next build` + vitest resolve fine.

---

### Task 1: Thread `dollarsAtRisk` + `confidence` onto the Decision wire (core)

**Files:**
- Modify: `packages/core/src/decisions/types.ts:37-62` (the `meta` block of `Decision`)
- Modify: `packages/core/src/decisions/adapters/recommendation-adapter.ts:25-39` (the `meta` object)
- Test: `packages/core/src/decisions/adapters/recommendation-adapter.test.ts` (extend; create following sibling adapter tests if absent)

**Interfaces:**
- Consumes: `Recommendation` row fields `dollarsAtRisk: number` and `confidence: number` (`packages/core/src/recommendations/types.ts`).
- Produces: `Decision.meta.dollarsAtRisk?: number` and `Decision.meta.confidence?: number` on the wire. The api serializer (`apps/api/src/routes/decisions.ts:115-125`) spreads `...d.meta` → no api change needed.

- [ ] **Step 1: Write the failing test.** In `recommendation-adapter.test.ts`, add a case asserting the adapter threads both scalars from the row. Build the row with the file's existing recommendation fixture/builder; set `dollarsAtRisk: 450, confidence: 0.82`.

```ts
it("threads dollarsAtRisk and confidence from the row onto meta", () => {
  const row = makeRecommendation({ dollarsAtRisk: 450, confidence: 0.82 });
  const decision = adaptRecommendation(row, { routeTemplates: ROUTE_TEMPLATES });
  expect(decision.meta.dollarsAtRisk).toBe(450);
  expect(decision.meta.confidence).toBe(0.82);
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `pnpm --filter @switchboard/core test recommendation-adapter` — expect FAIL (`dollarsAtRisk`/`confidence` undefined, or a type error if `meta` lacks the field).

- [ ] **Step 3: Add the optional fields to the core type.** In `packages/core/src/decisions/types.ts`, inside `Decision.meta`, add:

```ts
    /** Estimated whole-dollar impact (>= 0) from the recommendation row; render only when > 0. SGD. */
    dollarsAtRisk?: number;
    /** Recommendation confidence 0..1; rendered as a qualitative band, not a precise %. */
    confidence?: number;
```

- [ ] **Step 4: Populate them in the adapter.** In `recommendation-adapter.ts`, add to the `meta` object (next to `undoableUntil`):

```ts
      dollarsAtRisk: row.dollarsAtRisk,
      confidence: row.confidence,
```

Leave `handoff-adapter.ts` and `parked-approval-adapter.ts` untouched (both fields stay `undefined` for those kinds — verify there is no regression by reading them; they must NOT set the fields).

- [ ] **Step 5: Run tests to verify they pass.** Run: `pnpm --filter @switchboard/core test recommendation-adapter` — expect PASS. Then `pnpm --filter @switchboard/core typecheck`.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/decisions/types.ts packages/core/src/decisions/adapters/recommendation-adapter.ts packages/core/src/decisions/adapters/recommendation-adapter.test.ts
git commit -m "feat(core): thread dollarsAtRisk + confidence onto decision meta"
```

---

### Task 2: Dashboard wire mirror + seam guard + confidence chip helper

**Files:**
- Modify: `apps/dashboard/src/lib/decisions/types.ts:37-62` (mirror the two meta fields)
- Modify: `apps/dashboard/src/lib/decisions/risk-chips.ts` (add `confidenceChip`)
- Test: `apps/dashboard/src/lib/decisions/risk-chips.test.ts` (extend/create)
- Test: `apps/dashboard/src/lib/decisions/wire-shape.test.ts` (create — compile-time seam guard)

**Interfaces:**
- Consumes: the wire field names from Task 1 (`meta.dollarsAtRisk`, `meta.confidence`).
- Produces: `confidenceChip(confidence?: number): RiskChip | null` (low `<0.5`, medium `0.5–<0.8`, high `>=0.8`); the mirrored dashboard `Decision.meta` fields consumed by Tasks 3 + 5.

- [ ] **Step 1: Write the failing chip test.** In `risk-chips.test.ts`:

```ts
import { confidenceChip } from "./risk-chips";

describe("confidenceChip", () => {
  it("bands confidence and returns a RiskChip", () => {
    expect(confidenceChip(0.9)).toMatchObject({ key: "confidence", label: "High confidence" });
    expect(confidenceChip(0.6)).toMatchObject({ label: "Medium confidence" });
    expect(confidenceChip(0.2)).toMatchObject({ label: "Low confidence" });
  });
  it("returns null for absent or non-finite confidence", () => {
    expect(confidenceChip(undefined)).toBeNull();
    expect(confidenceChip(Number.NaN)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `pnpm --filter @switchboard/dashboard test risk-chips` — expect FAIL (`confidenceChip` not exported).

- [ ] **Step 3: Mirror the wire fields.** In `apps/dashboard/src/lib/decisions/types.ts`, add to `Decision.meta` (mirror Task 1 verbatim, dashboard has no `.js`):

```ts
    /** Estimated whole-dollar impact (>= 0); render only when > 0. SGD. Source: core recommendation-adapter. */
    dollarsAtRisk?: number;
    /** Recommendation confidence 0..1; rendered as a qualitative band. Source: core recommendation-adapter. */
    confidence?: number;
```

- [ ] **Step 4: Add `confidenceChip`.** In `risk-chips.ts`, after `riskChips`:

```ts
export function confidenceChip(confidence?: number): RiskChip | null {
  if (confidence === undefined || !Number.isFinite(confidence)) return null;
  const label =
    confidence >= 0.8 ? "High confidence" : confidence >= 0.5 ? "Medium confidence" : "Low confidence";
  return { key: "confidence", label, soft: true };
}
```

- [ ] **Step 5: Add the compile-time seam guard.** Create `wire-shape.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Decision } from "./types";

// Pins the hand-mirrored producer->consumer seam: this object literal fails to
// typecheck if the dashboard Decision.meta drops a field the core adapter sets.
describe("decision wire shape", () => {
  it("meta carries the evidence-first fields produced by the core recommendation adapter", () => {
    const meta: Decision["meta"] = { dollarsAtRisk: 450, confidence: 0.82 };
    expect(meta.dollarsAtRisk).toBe(450);
    expect(meta.confidence).toBe(0.82);
  });
});
```

- [ ] **Step 6: Run tests to verify they pass.** Run: `pnpm --filter @switchboard/dashboard test risk-chips wire-shape` — expect PASS. Then `pnpm --filter @switchboard/dashboard typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add apps/dashboard/src/lib/decisions/types.ts apps/dashboard/src/lib/decisions/risk-chips.ts apps/dashboard/src/lib/decisions/risk-chips.test.ts apps/dashboard/src/lib/decisions/wire-shape.test.ts
git commit -m "feat(dashboard): mirror decision evidence fields + confidence chip helper"
```

---

### Task 3: Redesign the sheet — evidence block, at-stake, signals; delete the dead stub

**Files:**
- Modify: `apps/dashboard/src/components/inbox/approval-detail-sheet.tsx` (sections 184-266)
- Modify: `apps/dashboard/src/components/inbox/inbox.css` (remove `.ds-pending*`; add `.ds-evidence*`, `.ds-stake*`)
- Test: `apps/dashboard/src/components/inbox/approval-detail-sheet.test.tsx` (extend/create)

**Interfaces:**
- Consumes: `decision.meta.dollarsAtRisk`, `decision.meta.confidence` (Tasks 1+2), `confidenceChip` (Task 2), `riskChips` + `formatMoney`/`<Money>`.
- Produces: the redesigned sheet markup consumed by Task 4.

Read the current file first. The redesign keeps header + proposal headline + thread link + footer; it (a) moves `dataLines` out of the proposal section into a new EVIDENCE section, (b) deletes the `ds-pending` section (lines 210-241), (c) adds an AT-STAKE section, (d) replaces the standalone Risk section with a SIGNALS section. Final section order: header → proposal (humanSummary + contact only) → evidence → at-stake → signals → thread → footer.

- [ ] **Step 1: Write the failing tests.** In `approval-detail-sheet.test.tsx`, render the sheet with a recommendation Decision fixture and assert:

```tsx
it("shows evidence dataLines in their own block and no dead placeholder", () => {
  render(<ApprovalDetailSheet decision={recWith({ dataLines: [["Impact", "+18 bookings/wk"]] })} {...noop} />);
  expect(screen.getByText("+18 bookings/wk", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(/preview not yet wired/i)).not.toBeInTheDocument();
});
it("renders dollar-at-stake in S$ only when > 0", () => {
  const { rerender } = render(<ApprovalDetailSheet decision={recWith({ dollarsAtRisk: 450 })} {...noop} />);
  expect(screen.getByText(/S\$450/)).toBeInTheDocument();
  rerender(<ApprovalDetailSheet decision={recWith({ dollarsAtRisk: 0 })} {...noop} />);
  expect(screen.queryByText(/Estimated impact/i)).not.toBeInTheDocument();
});
it("renders a banded confidence chip when present", () => {
  render(<ApprovalDetailSheet decision={recWith({ confidence: 0.9 })} {...noop} />);
  expect(screen.getByText("High confidence")).toBeInTheDocument();
});
```

(`recWith` = a local builder spreading a base recommendation Decision; `noop` = stub `onClose/onCommit/onSecondary/onDismiss`. Follow any existing fixture in the file.)

- [ ] **Step 2: Run to verify failure.** Run: `pnpm --filter @switchboard/dashboard test approval-detail-sheet` — expect FAIL.

- [ ] **Step 3: Edit the proposal section.** Remove the `dataLines` list from the proposal section (lines 187-201); keep `humanSummary` + the contact strip.

- [ ] **Step 4: Add the EVIDENCE section** (after proposal), gated on presence:

```tsx
{dataLines.length > 0 && (
  <section className="ds-section ds-evidence">
    <div className="ds-eyebrow">Why {agentName} is recommending this</div>
    <ul className="ds-evidence-list">
      {dataLines.map((line, i) => (
        <li key={i} className="ds-evidence-row">
          {Array.isArray(line) ? line.join(" · ") : String(line)}
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 5: Delete the dead stub + add AT-STAKE.** Delete the entire `ds-pending` `<section>` (lines 210-241). In its place add (using `formatMoney`; import from `@/lib/money`):

```tsx
{Number.isFinite(decision.meta.dollarsAtRisk) && (decision.meta.dollarsAtRisk ?? 0) > 0 && (
  <section className="ds-section ds-stake">
    <div className="ds-eyebrow">Estimated impact</div>
    <p className="ds-stake-value">{formatMoney(decision.meta.dollarsAtRisk!)}</p>
    <p className="ds-stake-caption">{agentName}&apos;s estimate from recent performance.</p>
  </section>
)}
```

- [ ] **Step 6: Replace the Risk section with SIGNALS.** Change the `ds-risk` section to fold the confidence chip into the chip row (keep the no-contract branch unchanged):

```tsx
<section className="ds-section ds-risk">
  <div className="ds-eyebrow">Signals</div>
  {!contract ? (
    /* keep the existing ds-risk-missing block verbatim */
  ) : (
    <ul className="ds-risk-chips">
      {[...chips, confidenceChip(decision.meta.confidence)].filter(Boolean).map((c) => (
        <li key={c!.key} className="ds-risk-chip" data-tone={c!.strong ? "strong" : c!.soft ? "soft" : "normal"}>
          <span className="ds-risk-chip-bullet" aria-hidden="true" />
          {c!.label}
        </li>
      ))}
    </ul>
  )}
</section>
```

Add `import { riskChips, confidenceChip } from "@/lib/decisions/risk-chips";` (riskChips is already imported — extend the import).

- [ ] **Step 7: CSS.** In `inbox.css`, delete all `.ds-pending*` rules. Add `.ds-evidence-list`/`.ds-evidence-row` (editorial rows: `var(--ink-2)` body, generous line-height) and `.ds-stake-value` (Source Serif `var(--serif)`, large, `font-variant-numeric: tabular-nums`, `var(--ink)`) + `.ds-stake-caption` (`var(--ink-3)`, small). Follow the existing `ds-section`/`ds-eyebrow` spacing. Verify any chip tone color meets AA on cream (the existing `.ds-risk-chip` tones already pass; the confidence chip uses `data-tone="soft"`).

- [ ] **Step 8: Run tests + build to verify.** Run: `pnpm --filter @switchboard/dashboard test approval-detail-sheet` — expect PASS. Then `pnpm --filter @switchboard/dashboard typecheck`.

- [ ] **Step 9: Commit.**

```bash
git add apps/dashboard/src/components/inbox/approval-detail-sheet.tsx apps/dashboard/src/components/inbox/inbox.css apps/dashboard/src/components/inbox/approval-detail-sheet.test.tsx
git commit -m "feat(dashboard): evidence-first approval sheet anatomy"
```

---

### Task 4: Reason-on-override (optional note on decline)

**Files:**
- Modify: `apps/dashboard/src/components/inbox/approval-detail-sheet.tsx` (the dismiss control + `onDismiss` prop type)
- Modify: `apps/dashboard/src/components/inbox/inbox-screen.tsx:74-80` (`handleDismiss`) and `:146-160` (`handleReject`)
- Test: `apps/dashboard/src/components/inbox/approval-detail-sheet.test.tsx` (extend)

**Interfaces:**
- Consumes: `onDismiss: (note?: string) => void` (changed signature). The hooks `useRecommendationAction.dismiss(note?)` and `useWorkflowApprovalAction.reject(note?)` already accept a note; the proxy + api routes already persist it.
- Produces: the captured reason flows to the existing `note` param.

- [ ] **Step 1: Write the failing test.** Assert that clicking the dismiss button reveals a reason field and that confirming forwards the typed note:

```tsx
it("captures an optional reason on decline and forwards it to onDismiss", async () => {
  const onDismiss = vi.fn();
  render(<ApprovalDetailSheet decision={recWith({})} {...noop} onDismiss={onDismiss} />);
  await userEvent.click(screen.getByRole("button", { name: /decline|dismiss/i }));
  await userEvent.type(screen.getByPlaceholderText(/why|reason/i), "Budget already maxed");
  await userEvent.click(screen.getByRole("button", { name: /confirm decline|decline/i }));
  expect(onDismiss).toHaveBeenCalledWith("Budget already maxed");
});
```

- [ ] **Step 2: Run to verify failure.** Run: `pnpm --filter @switchboard/dashboard test approval-detail-sheet` — expect FAIL.

- [ ] **Step 3: Change the prop type.** In `ApprovalDetailSheetProps`, change `onDismiss: () => void;` to `onDismiss: (note?: string) => void;`.

- [ ] **Step 4: Add the override-reason flow.** Add `const [declining, setDeclining] = useState(false);` and reset it in the existing `useEffect([decision.id])`. Render an inline reason capture when `declining` (mirror `ConfirmInline`'s textarea + a confirm/cancel pair), wiring confirm to `onDismiss(note.trim() || undefined)`. Make the footer Dismiss button set `setDeclining(true)` instead of calling `onDismiss` directly (keep the immediate path only when already declining). Keep approve's high-risk `ConfirmInline` flow unchanged.

- [ ] **Step 5: Forward the note in both wrappers.** In `inbox-screen.tsx`: change `handleDismiss` to `(note?: string) => { ... action.dismiss(note) ... }`; change `handleReject` to `(note?: string) => { ... action.reject(note) ... }`. The `onDismiss={handleDismiss}` / `onDismiss={handleReject}` JSX needs no change (the handler now accepts the arg).

- [ ] **Step 6: Run tests + typecheck.** Run: `pnpm --filter @switchboard/dashboard test approval-detail-sheet inbox-screen` — expect PASS. Then `pnpm --filter @switchboard/dashboard typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add apps/dashboard/src/components/inbox/approval-detail-sheet.tsx apps/dashboard/src/components/inbox/inbox-screen.tsx apps/dashboard/src/components/inbox/approval-detail-sheet.test.tsx
git commit -m "feat(dashboard): capture an optional reason when an operator overrides"
```

---

### Task 5: Quiet dollar-at-stake hint on the inbox card

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox-decision-card.tsx` (footer)
- Modify: `apps/dashboard/src/components/inbox/inbox.css` (card footer figure)
- Test: `apps/dashboard/src/components/inbox/inbox-decision-card.test.tsx` (extend/create)

**Interfaces:**
- Consumes: `decision.meta.dollarsAtRisk` (Task 1), `formatMoney` (`@/lib/money`).

- [ ] **Step 1: Write the failing test.**

```tsx
it("shows a quiet dollar figure only when dollarsAtRisk > 0", () => {
  const { rerender } = render(<InboxDecisionCard decision={cardWith({ dollarsAtRisk: 450 })} {...cardNoop} />);
  expect(screen.getByText(/S\$450/)).toBeInTheDocument();
  rerender(<InboxDecisionCard decision={cardWith({ dollarsAtRisk: 0 })} {...cardNoop} />);
  expect(screen.queryByText(/S\$/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure.** Run: `pnpm --filter @switchboard/dashboard test inbox-decision-card` — expect FAIL.

- [ ] **Step 3: Render the figure.** In the card footer (`decision-foot`), next to the contact name, add:

```tsx
{Number.isFinite(decision.meta.dollarsAtRisk) && (decision.meta.dollarsAtRisk ?? 0) > 0 && (
  <span className="decision-stake">{formatMoney(decision.meta.dollarsAtRisk!)}</span>
)}
```

Import `formatMoney` from `@/lib/money`.

- [ ] **Step 4: CSS.** Add `.decision-stake` to `inbox.css`: mono (`var(--font-mono)` / loaded weight), `var(--ink-3)`, small, `font-variant-numeric: tabular-nums`; quiet, not a filled chip. Keep card density (audit M4).

- [ ] **Step 5: Run tests + typecheck.** Run: `pnpm --filter @switchboard/dashboard test inbox-decision-card` — expect PASS. Then `pnpm --filter @switchboard/dashboard typecheck`.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/inbox/inbox-decision-card.tsx apps/dashboard/src/components/inbox/inbox.css apps/dashboard/src/components/inbox/inbox-decision-card.test.tsx
git commit -m "feat(dashboard): quiet dollar-at-stake hint on the inbox card"
```

---

## Self-Review

**Spec coverage:**
- proposed action → kept (humanSummary headline). ✓
- evidence-above-recommendation → Task 3 EVIDENCE block, above controls. ✓
- dollar-at-stake → Tasks 1/3 (sheet) + 5 (card), guarded + honest label. ✓
- signal chips → Task 3 SIGNALS (riskChips + confidence). ✓
- reason-on-override → Task 4. ✓
- delete dead stub → Task 3 Step 5. ✓
- thread real data only / degrade gracefully → Tasks 1/2 thread the two row scalars; evidence/at-stake/confidence each gate on presence. ✓
- pin hand-mirrored seam → Task 1 (producer test) + Task 2 (compile-time wire-shape guard) + Tasks 3/5 (consumer tests over the same fields). ✓

**Placeholder scan:** No TBD/TODO; each code step shows code; each test step shows assertions.

**Type consistency:** `dollarsAtRisk`/`confidence` named identically across core type, adapter, dashboard mirror, helper, sheet, card; `confidenceChip` signature consistent (Task 2 defines, Task 3 consumes); `onDismiss: (note?: string) => void` consistent (Task 4 sheet + both wrappers).

## Verification (run before opening the impl PR)

`pnpm typecheck`; `pnpm --filter @switchboard/core test`; `pnpm --filter @switchboard/dashboard test`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm --filter @switchboard/dashboard build` (`next build`); `pnpm audit --audit-level=high`. Plus before/after screenshots (rich ad-optimizer rec + a sparse rec) and an independent fresh-context review + a does-it-actually-work review confirming a real producer populates the threaded fields end-to-end.
