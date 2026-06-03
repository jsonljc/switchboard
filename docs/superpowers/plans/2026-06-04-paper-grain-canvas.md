# Paper grain canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle warm paper-grain texture to the authed app canvas only, off every money and decision surface, off in dark and under reduced motion, with WCAG AA preserved at every money moment.

**Architecture:** The grain is a second background layer on the authed body (`body:has(.app-header)`), multiplied into the cream `background-color` with `background-blend-mode: multiply`. Because `background-blend-mode` blends only the element's own background layers and never child content, the grain shows on the bare canvas and is occluded by every opaque surface, with zero change to stacking (the inbox sheet at `z-index: 60` and the sticky masthead at `z-index: 50` are untouched). The grain is a self-contained data-URI SVG `feTurbulence` tile; its intensity is the calibrated `feColorMatrix` alpha (0.24). Two transparent Results money cards get an opaque ground so grain never sits behind money data.

**Tech Stack:** Next.js 14 dashboard, CSS custom properties in `globals.css`, Vitest + Testing Library (jsdom, css disabled, so tests assert string/structural contracts not computed color), headless Chrome via playwright-core for live verification.

**Spec:** `docs/superpowers/specs/2026-06-04-paper-grain-canvas/design.md`

**Why background-blend-mode (do not "fix" this to a separate layer):** a separate behind-content grain layer cannot work here. The inbox detail sheet (`z-index: 60`) renders inside `.app-body`; lifting content above the grain gives `.app-body` a stacking context that traps that sheet below the masthead, and a negative-z layer either hides behind the opaque body background or (if the body is isolated) blends against a transparent backdrop and renders nothing. Both were built and measured headless and rejected. `background-blend-mode` is the correct mechanism.

**Pre-flight (run once before Task 1):**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/goofy-pascal-5703a3
rm -rf apps/dashboard/.next   # a stale .next/dev/types can make tsc falsely fail
pnpm --filter @switchboard/dashboard test -- --run src/app/__tests__/token-governance.test.ts
```

Expected: the existing token-governance suite passes (green baseline before we extend it).

---

### Task 1: Blend the grain into the authed canvas (off dark and reduced motion)

**Files:**

- Modify: `apps/dashboard/src/app/globals.css:537-540` (the `body:has(.app-header)` rule, inside `@layer components`)
- Test: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing tests**

Add this block at the end of `apps/dashboard/src/app/__tests__/token-governance.test.ts` (it uses the `css` string already read at the top of the file):

```ts
describe("token governance — paper grain (GR1)", () => {
  // First (base) body:has(.app-header) rule. The dark + reduced-motion off rules
  // come later in source, so .match returns the base rule with the grain layer.
  const grainRule = (): string => {
    const m = css.match(/body:has\(\.app-header\)\s*\{([^}]*)\}/);
    expect(m, "body:has(.app-header) rule must exist").not.toBeNull();
    return m![1];
  };

  it("blends a warm-riso grain into the canvas via background-blend-mode multiply", () => {
    const decl = grainRule();
    expect(decl).toMatch(/background-blend-mode:\s*multiply/);
    expect(decl).toMatch(/background-image:\s*url\("data:image\/svg\+xml,/);
    expect(decl).toMatch(/background-size:\s*200px 200px/);
  });

  it("paints the exact spec grain, not an empty or placeholder layer", () => {
    const decl = grainRule();
    expect(decl).toContain("feTurbulence");
    expect(decl).toContain("feColorMatrix");
    expect(decl).toContain("baseFrequency%3D%220.88%22"); // encoded baseFrequency="0.88"
    expect(decl).toContain("filter%3D%22url(%23g)%22"); // encoded filter="url(#g)"
  });

  it("keeps the canvas rule free of raw hex (ink lives in feColorMatrix decimals)", () => {
    expect(grainRule()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("disables the grain in dark and under reduced motion (cream stays)", () => {
    expect(css).toMatch(/\.dark\s+body:has\(\.app-header\)\s*\{\s*background-image:\s*none/);
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*body:has\(\.app-header\)\s*\{\s*background-image:\s*none/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/dashboard test -- --run src/app/__tests__/token-governance.test.ts -t "paper grain"`
Expected: FAIL (`background-blend-mode` not found; off rules not found).

- [ ] **Step 3: Add the grain to the canvas background**

In `apps/dashboard/src/app/globals.css`, replace the existing rule at lines 537-540:

```css
body:has(.app-header) {
  background: var(--ambient-cream, hsl(40 25% 94%));
  transition: background 1200ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

with this (the grain layer plus the dark and reduced-motion off rules, all inside `@layer components`):

```css
body:has(.app-header) {
  background-color: var(--ambient-cream, hsl(40 25% 94%));
  /* Warm-riso paper grain (spec 2026-06-04-paper-grain-canvas): a second
       background layer multiplied into the cream. background-blend-mode blends
       only the body's own background layers, never child content, so cards, text,
       the masthead, and the inbox detail sheet are untouched and the grain shows
       only on the bare canvas. Intensity is the calibrated feColorMatrix alpha
       (0.24) baked into the data URI; no raw hex (the #filter ref is encoded %23). */
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22200%22%20height%3D%22200%22%3E%3Cfilter%20id%3D%22g%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.88%22%20numOctaves%3D%222%22%20stitchTiles%3D%22stitch%22%20seed%3D%227%22%2F%3E%3CfeColorMatrix%20type%3D%22matrix%22%20values%3D%220%200%200%200%200.16%200%200%200%200%200.13%200%200%200%200%200.09%200%200%200%200.24%200%22%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20filter%3D%22url(%23g)%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: repeat;
  background-size: 200px 200px;
  background-blend-mode: multiply;
  transition: background-color 1200ms cubic-bezier(0.4, 0, 0.2, 1);
}
/* Grain is a light-mode-only signature: drop the grain layer, keep the cream. */
.dark body:has(.app-header) {
  background-image: none;
}
/* Reduced motion strips the texture too (spec). The static texture needs its own
     disable; the global reduced-motion block only neutralizes animation timings. */
@media (prefers-reduced-motion: reduce) {
  body:has(.app-header) {
    background-image: none;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- --run src/app/__tests__/token-governance.test.ts -t "paper grain"`
Expected: PASS (all four GR1 assertions).

- [ ] **Step 5: Run the full token-governance suite (no drift regression)**

Run: `pnpm --filter @switchboard/dashboard test -- --run src/app/__tests__/token-governance.test.ts`
Expected: PASS (the generalized hex sweep still passes; the data URI carries no hex).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "feat(dashboard): warm-riso paper grain on the canvas, off dark and reduced motion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Ground the transparent Results money cards (off money surfaces)

**Files:**

- Modify: `apps/dashboard/src/components/results/results.module.css:716` (`.campaignCard`) and `:969` (`.agentCard`)
- Test: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (extend the GR1 block)

Context: both cards are `background: transparent` while carrying dense money data (spend, revenue, ROAS, attributed value). A transparent money card lets the grained body canvas show behind trust-critical numbers. Give them the opaque `--canvas-2` ground (the same faint cream the Home team tiles use), which occludes the grain and reads as a clean money card.

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the GR1 describe in `token-governance.test.ts`:

```ts
it("Results money cards are opaque so grain never sits behind money data", () => {
  const resultsCss = readFileSync(
    path.resolve(process.cwd(), "src/components/results/results.module.css"),
    "utf8",
  );
  for (const sel of ["campaignCard", "agentCard"]) {
    const rule = resultsCss.match(new RegExp(`\\.${sel}\\s*\\{([^}]*)\\}`));
    expect(rule, `.${sel} rule must exist`).not.toBeNull();
    expect(rule![1], `.${sel} must not be transparent`).not.toMatch(/background:\s*transparent/);
    expect(rule![1], `.${sel} must carry an opaque ground`).toMatch(
      /background:\s*var\(--canvas-2\)/,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- --run src/app/__tests__/token-governance.test.ts -t "Results money cards"`
Expected: FAIL (`.campaignCard must not be transparent`).

- [ ] **Step 3: Ground the cards**

In `apps/dashboard/src/components/results/results.module.css`, inside the `.campaignCard` rule (line 716) change `background: transparent;` to:

```css
background: var(--canvas-2);
```

Then inside the `.agentCard` rule (line 969) change its `background: transparent;` to:

```css
background: var(--canvas-2);
```

Leave the other three `background: transparent` declarations (lines 351, 1302, 1336) untouched: read each rule to confirm it is not a money card (`.campaignCard` and `.agentCard` are the only two carrying spend / revenue / ROAS / attributed value).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- --run src/app/__tests__/token-governance.test.ts -t "Results money cards"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/results/results.module.css apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "feat(dashboard): ground Results money cards so grain stays off money data

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full local gate (typecheck, dashboard tests, build)

**Files:** none (verification)

- [ ] **Step 1: Clean stale Next types**

Run: `rm -rf apps/dashboard/.next`

- [ ] **Step 2: Typecheck the dashboard**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Run the dashboard test suite**

Run: `pnpm --filter @switchboard/dashboard test -- --run`
Expected: PASS (token-governance + the full suite green).

- [ ] **Step 4: Build the dashboard (catches @/ import and dead-file breaks vitest/typecheck miss)**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: build succeeds.

- [ ] **Step 5: Prettier check on the touched .ts test file (CI format gate is `*.ts` only)**

Run: `pnpm exec prettier --check "apps/dashboard/src/app/__tests__/token-governance.test.ts"`
Expected: the file uses the repo style. Do NOT run prettier on the `.css` files (repo CSS is hand-formatted and fails a direct prettier check by design).

- [ ] **Step 6: Commit any prettier fixups (if needed)**

```bash
git add -A && git commit -m "style(dashboard): prettier fixups for paper grain test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to fix"
```

---

### Task 4: Live verification and alpha lock (this slice lives or dies on how it looks)

**Files:** `apps/dashboard/src/app/globals.css` (final baked alpha only, if the real app wants a different value)

Run by the orchestrator, not a fresh implementer subagent: it needs the running stack and judgment about how the canvas looks.

- [ ] **Step 1: Bring up the stack**

API (from repo root so root `.env` loads): `node --env-file=.env --import tsx apps/api/src/server.ts` detached on :3000.
Dashboard (from the worktree): `pnpm --filter @switchboard/dashboard dev` detached on :3002.
(DB is up and `DEV_BYPASS_AUTH=true`, so no login step.)

- [ ] **Step 2: Screenshot the grained surfaces**

Drive headless Chrome (playwright-core + system Chrome, scratch dir outside the repo). Screenshot `/` (Home), `/inbox`, `/results`. Confirm the canvas reads as warm printed paper, calm, not gray or dirty, and that cards, the masthead, and decision surfaces show no grain.

- [ ] **Step 3: Screenshot the grain-free and disabled states**

Open an approval / commit detail sheet and an inbox card: confirm no grain (opaque occlusion) and the sheet sits above the masthead. Toggle `.dark` on `<html>`: confirm no grain. Emulate `prefers-reduced-motion: reduce` (`page.emulateMedia({ reducedMotion: "reduce" })`): confirm no grain.

- [ ] **Step 4: Real contrast sampling**

With `page.evaluate` + a screenshot decoded via pngjs, sample the grained bare canvas behind `--ink-2` text on Home and compute the WCAG contrast ratio. Confirm it is at least 4.5:1.

- [ ] **Step 5: Lock the alpha**

If the real-app render reads too heavy or too faint, regenerate the data URI with a different `feColorMatrix` alpha (sweet spot 0.22 to 0.28) and update the `background-image` in `globals.css`. Re-run the GR1 governance tests (they assert the grain contract, not a specific alpha, so they stay green).

- [ ] **Step 6: Commit the locked alpha (if changed)**

```bash
git add apps/dashboard/src/app/globals.css
git commit -m "feat(dashboard): lock paper grain alpha from real-app verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "alpha unchanged"
```

---

## Self-Review

- **Spec coverage:** mechanism + data URI (Task 1), off dark + reduced motion (Task 1), off money surfaces via background-blend occlusion + Results grounding (Task 1, 2), governance test extension (Task 1, 2), local gate (Task 3), live verification + AA sampling + alpha lock (Task 4). All spec sections map to a task.
- **Placeholder scan:** every code step has complete code; the data URI is the exact generated string (alpha 0.24); no TBD.
- **Selector consistency:** `body:has(.app-header)`, `background-blend-mode: multiply`, `--canvas-2` used identically across tasks and tests. The `grainRule()` regex matches the base rule because the off rules follow it in source.
- **Out of scope (intentional):** no `--grain-opacity` token (background-blend-mode has no per-layer opacity; intensity is the baked alpha); the poster .34 variant (no consumer surface); the pre-existing `--ink-3` / `--ink-4` decorative contrast.
