# EL1 Elevation / shadow ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the dashboard's ad-hoc box-shadows onto one warm five-level semantic elevation ladder in `globals.css`, migrate every consumer, and add a vitest drift guard so the ladder stays the single source.

**Architecture:** A primitive `--shadow-color` (warm near-black, raw HSL triple, dark-overridable) underpins five downward levels `--shadow-1..5` plus a directional `--shadow-sheet`. Existing semantic tokens (`--shadow-card`, `--shadow-lift`) repoint at levels (zero-churn keystone). Literal and Tailwind-default box-shadows migrate to the ladder. The drift guard extends the existing recursive governed-source sweep in `token-governance.test.ts`.

**Tech Stack:** Next.js dashboard, CSS custom properties, Tailwind, vitest. Run all commands from `apps/dashboard` unless noted. Worktree root: `/Users/jasonli/switchboard/.claude/worktrees/el1-shadow-ladder` on branch `feat/el1-shadow-ladder`.

**Execution mode:** Inline (executing-plans), single context, because the migration is a tightly-coupled CSS refactor with cascade/format gotchas best held in one head. Reviewer subagent plus codex adversarial review run at the end.

**Conventions:** ESM, no `any`, no `console.log`, Prettier (semi, double quotes, 100 width). Conventional Commits, lowercase subject, body lines <= 100 chars, blank line before footer, NO em-dashes anywhere. Dashboard coverage 40/35/40/40. Verify CSS live (dashboard ESLint is stubbed; CI format:check is `*.ts` only).

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/globals.css` | the ladder + base + gloss tokens, repoints, dark hook, status-pill migration | Modify |
| `src/app/__tests__/token-governance.test.ts` | the drift guard (token assertions + recursive sweep) | Modify |
| `src/components/inbox/inbox-design-base.css` | delete scoped shadow redefs; rebase right-drawer | Modify |
| `src/components/results/results.module.css` | window-toggle to ladder | Modify |
| `src/app/(auth)/(mercury)/activity/activity.module.css` | pill + menu to ladder | Modify |
| `src/app/(auth)/(mercury)/contacts/pipeline.module.css` | hover + toast to ladder | Modify |
| `src/components/layout/tools-overflow.module.css` | inset underline to action var | Modify |
| `src/components/home/home.module.css` | amber gloss to token | Modify |
| `src/components/decisions/swipe-decision-card.module.css` | gloss to token; armPulse allow-marker | Modify |
| `src/components/inbox/inbox.css` | amber gloss to token | Modify |
| `src/components/cockpit/sprite/sprite-frame.tsx` | inset color to base var | Modify |
| `src/components/cockpit/mission-popover.tsx` | popover to level 3 | Modify |
| `src/components/ui/{dialog,sheet,popover,dropdown-menu,select,toast}.tsx` | warm-skin overlays | Modify |

---

## Task 1: Ladder tokens, repoints, dark hook, and the token-assertion guard

**Files:**
- Modify: `src/app/globals.css` (the shadow block at lines 248-251 and the `.dark` block)
- Modify: `src/app/__tests__/token-governance.test.ts`

- [ ] **Step 1: Write the failing guard assertions.** Append to `src/app/__tests__/token-governance.test.ts`:

```ts
// ─── EL1: elevation ladder ────────────────────────────────────────────────
// A box-shadow value carrying a literal color (NOT a var() reference).
const LITERAL_SHADOW_COLOR = /rgba?\(\s*[\d.]|hsl\(\s*[\d.]|#[0-9a-fA-F]{3,8}\b/;

describe("token governance — elevation ladder single-source (EL1)", () => {
  it("defines one warm shadow base as a dark-overridable raw triple", () => {
    expect(tokenValue("shadow-color")).toMatch(RAW_HSL_TRIPLE);
  });

  it("the five ladder levels exist and carry no literal color", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const v = tokenValue(`shadow-${n}`);
      expect(v, `--shadow-${n}`).toContain("var(--shadow-color)");
      expect(v, `--shadow-${n}`).not.toMatch(LITERAL_SHADOW_COLOR);
    }
  });

  it("semantic shadow tokens repoint at ladder levels (zero-churn)", () => {
    expect(tokenValue("shadow-card")).toBe("var(--shadow-1)");
    expect(tokenValue("shadow-lift")).toBe("var(--shadow-3)");
  });

  it("the directional sheet shadow shares the warm base, no literal color", () => {
    const v = tokenValue("shadow-sheet");
    expect(v).toContain("var(--shadow-color)");
    expect(v).not.toMatch(LITERAL_SHADOW_COLOR);
  });
});
```

- [ ] **Step 2: Run it, expect failure.**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance`
Expected: FAIL (`token --shadow-color is not defined`, and `--shadow-card` is still `0 1px 0 rgba(...)`).

- [ ] **Step 3: Add the ladder + repoints.** In `src/app/globals.css`, replace the three shadow lines (currently lines 248-251, the `/* shadows (complete values, consumed bare) */` block) with:

```css
    /* ─── Elevation ladder (EL1) ───
       ONE warm shadow base (derived from the editorial ink), five downward
       levels at incrementing offset/blur/opacity, z-index-mapped:
       1 card-rest, 2 hover, 3 dropdown/popover/toast, 4 sheet, 5 modal.
       Consumed bare: box-shadow: var(--shadow-3). Dark-overridable via the
       single --shadow-color override in .dark below. */
    --shadow-color: 24 16% 11%; /* raw triple: hsl(var(--shadow-color) / a) */
    --shadow-1: 0 1px 0 hsl(var(--shadow-color) / 0.04), 0 1px 2px hsl(var(--shadow-color) / 0.05);
    --shadow-2: 0 1px 2px hsl(var(--shadow-color) / 0.05), 0 4px 8px hsl(var(--shadow-color) / 0.06);
    --shadow-3: 0 2px 6px hsl(var(--shadow-color) / 0.05), 0 10px 26px hsl(var(--shadow-color) / 0.09);
    --shadow-4: 0 4px 10px hsl(var(--shadow-color) / 0.07), 0 18px 44px hsl(var(--shadow-color) / 0.12);
    --shadow-5: 0 8px 18px hsl(var(--shadow-color) / 0.10), 0 30px 64px hsl(var(--shadow-color) / 0.16);
    /* Semantic aliases repoint at the ladder (consumers never change). */
    --shadow-card: var(--shadow-1);
    --shadow-lift: var(--shadow-3);
    /* Directional: bottom-docked sheets cast upward; level-4 weight, shared base. */
    --shadow-sheet: 0 -10px 30px hsl(var(--shadow-color) / 0.08), 0 -1px 2px hsl(var(--shadow-color) / 0.04);
    /* Brand material for the ONE amber action button. NOT elevation. */
    --shadow-action-gloss:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(80, 40, 0, 0.2),
      0 2px 4px rgba(168, 101, 15, 0.25),
      0 6px 16px rgba(201, 123, 26, 0.18);
```

- [ ] **Step 4: Add the dark hook.** In the `.dark` block (after the `--char-accent inherits` comment near the end), add:

```css
    /* Elevation: dark swaps the warm base for near-black. Wave 3 replaces
       shadow-based elevation with tonal surface steps (audit section 6).
       The dark toggle remains hidden until then. */
    --shadow-color: 0 0% 0%;
```

- [ ] **Step 5: Run the guard, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance`
Expected: PASS (all four EL1 assertions plus the pre-existing token-governance tests).

- [ ] **Step 6: Sanity-check the existing shadow-token test still passes.**

Run: `pnpm --filter @switchboard/dashboard test -- tokens.test`
Expected: PASS (it asserts `--shadow-card/lift/sheet` names exist; they still do).

- [ ] **Step 7: Format + commit.**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/el1-shadow-ladder
pnpm --filter @switchboard/dashboard exec prettier --write src/app/globals.css src/app/__tests__/token-governance.test.ts
git add apps/dashboard/src/app/globals.css apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "feat(dashboard): warm five-level elevation ladder tokens (EL1)"
```

---

## Task 2: Remove the scoped inbox shadow redefs and rebase the right-drawer

**Files:**
- Modify: `src/components/inbox/inbox-design-base.css`

- [ ] **Step 1: Delete the three scoped shadow redefs.** In `inbox-design-base.css`, in the `.inbox-page, .sheet { ... }` block, remove the `/* shadow */` group (the three lines currently at 69-72):

```css
  /* shadow */
  --shadow-card: 0 1px 0 rgba(40, 30, 20, 0.04), 0 1px 2px rgba(40, 30, 20, 0.04);
  --shadow-lift: 0 12px 28px rgba(40, 30, 20, 0.1), 0 2px 6px rgba(40, 30, 20, 0.06);
  --shadow-sheet: 0 -10px 30px rgba(40, 30, 20, 0.08), 0 -1px 2px rgba(40, 30, 20, 0.04);
```

Replace with a one-line comment so future readers know why the tokens are gone:

```css
  /* shadows inherit the global elevation ladder (EL1); no scoped redefs. */
```

- [ ] **Step 2: Rebase the right-drawer shadow.** In the `@media (min-width: 768px)` `.sheet` rule (currently line 109), change:

```css
    box-shadow: -20px 0 40px rgba(40, 30, 20, 0.1);
```

to:

```css
    box-shadow: -20px 0 40px hsl(var(--shadow-color) / 0.1);
```

- [ ] **Step 3: Run the inbox + suite tests, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- inbox`
Expected: PASS (jsdom does not compute shadows; this confirms nothing imports the deleted tokens by JS).

- [ ] **Step 4: Format + commit.**

```bash
pnpm --filter @switchboard/dashboard exec prettier --write src/components/inbox/inbox-design-base.css
git add apps/dashboard/src/components/inbox/inbox-design-base.css
git commit -m "refactor(dashboard): inbox surfaces inherit the global shadow ladder (EL1)"
```

---

## Task 3: Migrate literal-color CSS elevation shadows to ladder tokens

**Files:**
- Modify: `src/app/globals.css` (status pill, line 1329)
- Modify: `src/components/results/results.module.css` (line 1312)
- Modify: `src/app/(auth)/(mercury)/activity/activity.module.css` (lines 412, 614)
- Modify: `src/app/(auth)/(mercury)/contacts/pipeline.module.css` (lines 342, 547)
- Modify: `src/components/layout/tools-overflow.module.css` (line 28)

Read each file region before editing to confirm the exact current string.

- [ ] **Step 1: globals.css status pill.** Change the `.tp-panel` rule:

```css
    box-shadow: 0 8px 24px hsl(20 10% 12% / 0.08);
```

to:

```css
    box-shadow: var(--shadow-3);
```

- [ ] **Step 2: results window-toggle.** In `results.module.css` change:

```css
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
```

to:

```css
  box-shadow: var(--shadow-1);
```

- [ ] **Step 3: activity stale pill + menu.** In `activity.module.css` change `0 6px 18px rgba(14, 12, 10, 0.06)` to `var(--shadow-3)` (the stale pill) and `0 8px 24px rgba(14, 12, 10, 0.08)` to `var(--shadow-3)` (the absolute menu).

- [ ] **Step 4: contacts hover + toast.** In `contacts/pipeline.module.css` change `0 1px 0 rgba(14, 12, 10, 0.04)` (the `.card:hover`) to `var(--shadow-2)` and `0 6px 24px rgba(14, 12, 10, 0.18)` (the toast) to `var(--shadow-3)`. Leave the drag-over inset ring (`color-mix(... var(--mercury-accent) ...)`) unchanged: it already uses a var color.

- [ ] **Step 5: tools-overflow inset underline.** In `tools-overflow.module.css` change:

```css
    box-shadow: inset 0 -2px 0 hsl(30 55% 46%);
```

to (it is the action amber):

```css
    box-shadow: inset 0 -2px 0 hsl(var(--action));
```

- [ ] **Step 6: Run the suite, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- results activity contacts`
Expected: PASS.

- [ ] **Step 7: Format + commit.**

```bash
pnpm --filter @switchboard/dashboard exec prettier --write src/app/globals.css "src/app/(auth)/(mercury)/activity/activity.module.css" "src/app/(auth)/(mercury)/contacts/pipeline.module.css" src/components/results/results.module.css src/components/layout/tools-overflow.module.css
git add -A apps/dashboard/src
git commit -m "refactor(dashboard): migrate literal elevation shadows to the ladder (EL1)"
```

---

## Task 4: Tokenize the amber action-button gloss and mark the armPulse keyframe

**Files:**
- Modify: `src/components/home/home.module.css` (lines 477-481)
- Modify: `src/components/decisions/swipe-decision-card.module.css` (gloss 250-254; armPulse 269-278)
- Modify: `src/components/inbox/inbox.css` (lines 911-914)

- [ ] **Step 1: Home button gloss.** Replace the four-line `box-shadow` on the amber primary button (`.btnPrimary`) with:

```css
    box-shadow: var(--shadow-action-gloss);
```

- [ ] **Step 2: Swipe card button gloss.** Same replacement on the `.btnPrimary` in `swipe-decision-card.module.css` (the static gloss at 250-254). Replace its four-line `box-shadow` with `box-shadow: var(--shadow-action-gloss);`.

- [ ] **Step 3: Inbox button gloss.** In `inbox.css` (`.ds-action-primary`), replace its three-line `box-shadow` with `box-shadow: var(--shadow-action-gloss);` (normalizing the slightly-different inbox copy to the canonical gloss is intended).

- [ ] **Step 4: Mark the armPulse keyframe.** In `swipe-decision-card.module.css`, the `@keyframes armPulse` block uses an animated amber ring that is a genuine one-off (not elevation). On the `box-shadow:` line(s) inside each keyframe step, add the allow marker on the line directly above each `box-shadow:`:

```css
    /* shadow-allow: bespoke animated amber arm-pulse ring, not elevation */
    box-shadow:
      0 1px 0 rgba(80, 40, 0, 0.18),
      0 2px 8px rgba(201, 123, 26, 0.25),
      0 0 0 0 hsl(var(--action) / 0.5);
```

Apply the marker above each `box-shadow:` in the keyframe (the 0%/100% step and the 50% step).

- [ ] **Step 5: Run the suite, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- home inbox decisions`
Expected: PASS.

- [ ] **Step 6: Format + commit.**

```bash
pnpm --filter @switchboard/dashboard exec prettier --write src/components/home/home.module.css src/components/decisions/swipe-decision-card.module.css src/components/inbox/inbox.css
git add apps/dashboard/src/components/home/home.module.css apps/dashboard/src/components/decisions/swipe-decision-card.module.css apps/dashboard/src/components/inbox/inbox.css
git commit -m "refactor(dashboard): single amber action-gloss token; mark arm-pulse (EL1)"
```

---

## Task 5: Cockpit shadows

**Files:**
- Modify: `src/components/cockpit/sprite/sprite-frame.tsx` (line 29)
- Modify: `src/components/cockpit/mission-popover.tsx` (line 67)

- [ ] **Step 1: Sprite frame inset.** Change the inline style:

```tsx
boxShadow: "inset 0 -8px 14px rgba(14,12,10,0.04)",
```

to:

```tsx
boxShadow: "inset 0 -8px 14px hsl(var(--shadow-color) / 0.04)",
```

- [ ] **Step 2: Mission popover.** In the className on the popover content (line 67), change `shadow-lg` to `shadow-[var(--shadow-3)]`.

- [ ] **Step 3: Run cockpit tests, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- cockpit`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
pnpm --filter @switchboard/dashboard exec prettier --write src/components/cockpit/sprite/sprite-frame.tsx src/components/cockpit/mission-popover.tsx
git add apps/dashboard/src/components/cockpit/sprite/sprite-frame.tsx apps/dashboard/src/components/cockpit/mission-popover.tsx
git commit -m "refactor(dashboard): cockpit shadows onto the ladder base (EL1)"
```

---

## Task 6: Warm-skin the shadcn overlay primitives

**Files:**
- Modify: `src/components/ui/dialog.tsx` (modal, level 5)
- Modify: `src/components/ui/sheet.tsx` (drawer, level 4)
- Modify: `src/components/ui/popover.tsx` (level 3)
- Modify: `src/components/ui/dropdown-menu.tsx` (level 3; two sites)
- Modify: `src/components/ui/select.tsx` (level 3)
- Modify: `src/components/ui/toast.tsx` (level 3)

Read each file first; replace the named Tailwind shadow class only (leave all other classes). The arbitrary class composes with Tailwind's ring vars exactly as the named class did.

- [ ] **Step 1: dialog.** `shadow-lg` to `shadow-[var(--shadow-5)]`.
- [ ] **Step 2: sheet.** `shadow-lg` to `shadow-[var(--shadow-4)]`.
- [ ] **Step 3: popover.** `shadow-md` to `shadow-[var(--shadow-3)]`.
- [ ] **Step 4: dropdown-menu.** both the content `shadow-lg` and the subcontent `shadow-md` to `shadow-[var(--shadow-3)]`.
- [ ] **Step 5: select.** `shadow-md` to `shadow-[var(--shadow-3)]`.
- [ ] **Step 6: toast.** `shadow-lg` to `shadow-[var(--shadow-3)]`.

- [ ] **Step 7: Run the ui + render tests, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- ui dialog sheet popover dropdown select toast`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
pnpm --filter @switchboard/dashboard exec prettier --write src/components/ui/dialog.tsx src/components/ui/sheet.tsx src/components/ui/popover.tsx src/components/ui/dropdown-menu.tsx src/components/ui/select.tsx src/components/ui/toast.tsx
git add apps/dashboard/src/components/ui/dialog.tsx apps/dashboard/src/components/ui/sheet.tsx apps/dashboard/src/components/ui/popover.tsx apps/dashboard/src/components/ui/dropdown-menu.tsx apps/dashboard/src/components/ui/select.tsx apps/dashboard/src/components/ui/toast.tsx
git commit -m "refactor(dashboard): warm-skin shadcn overlays onto the ladder (EL1)"
```

---

## Task 7: Lock the ladder in with the recursive drift sweep

**Files:**
- Modify: `src/app/__tests__/token-governance.test.ts`

- [ ] **Step 1: Add the sweep.** Append:

```ts
describe("token governance — no literal-color box-shadow outside globals.css (EL1)", () => {
  const files = collectGovernedFiles();
  const rel = (p: string) => (p.includes("/src/") ? p.slice(p.indexOf("/src/") + 1) : p);
  const stripCssComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");

  it("the ladder is the single source — no --shadow* defined outside globals.css", () => {
    const offenders: string[] = [];
    for (const { path: p, content } of files) {
      if (p.replace(/\\/g, "/").endsWith("src/app/globals.css")) continue;
      for (const m of content.matchAll(/(--shadow[\w-]*)\s*:/g)) {
        offenders.push(`${rel(p)}: ${m[1]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every box-shadow usage resolves to a token / none / ring, never a literal color", () => {
    const offenders: string[] = [];
    for (const { path: p, content: raw } of files) {
      const content = stripCssComments(raw);
      const lines = content.split("\n");
      const decls = [
        ...content.matchAll(/box-shadow\s*:\s*([^;]+);/g),
        ...content.matchAll(/boxShadow\s*:\s*["']([^"']+)["']/g),
      ];
      for (const m of decls) {
        const value = m[1].trim();
        if (!LITERAL_SHADOW_COLOR.test(value)) continue; // var-only / none → ok
        const simplified = value.replace(/(?:rgba?|hsl)\([^)]*\)/g, "C");
        const ringOnly = !simplified.includes(",") && /^\s*(?:inset\s+)?0\s+0\s+0\s+\S/.test(simplified);
        if (ringOnly) continue; // focus ring / halo / pulse — not elevation
        const lineNo = content.slice(0, m.index ?? 0).split("\n").length - 1;
        const marked = [lines[lineNo], lines[lineNo - 1]].some(
          (l) => l != null && /shadow-allow:/.test(l),
        );
        if (!marked) {
          offenders.push(`${rel(p)}: ${value.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect pass.**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance`
Expected: PASS. If any offender prints, migrate that literal to a ladder token (or, for a genuine one-off, add a `shadow-allow:` marker) and re-run.

- [ ] **Step 3: Prove the guard bites.** Temporarily add `box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);` to any governed module CSS, run the test, confirm it FAILS naming that file, then revert.

- [ ] **Step 4: Commit.**

```bash
pnpm --filter @switchboard/dashboard exec prettier --write src/app/__tests__/token-governance.test.ts
git add apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "test(dashboard): drift guard bans literal-color box-shadows (EL1)"
```

---

## Task 8: Full verification and before/after screenshots

- [ ] **Step 1: Full dashboard suite.**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS (the full suite, ~2000 tests).

- [ ] **Step 2: Typecheck + build + format.**

Run: `pnpm --filter @switchboard/dashboard typecheck` then `pnpm --filter @switchboard/dashboard build` then `pnpm --filter @switchboard/dashboard exec prettier --check "src/**/*.{ts,tsx,css}"`
Expected: PASS for all three.

- [ ] **Step 3: Capture before/after live screenshots.** Launch the dashboard detached on an alternate port (reuse a running API if present; do not kill another session's servers). Capture the trust-critical surfaces from `git stash` (before) and the branch (after): Home cards, the approval/decision sheet, a dropdown/popover, and a modal. Save under `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/el1/`. Confirm the warm normalization reads calm and the cool-to-warm overlay shift looks intentional.

- [ ] **Step 4: Code review.** Dispatch a reviewer subagent (requesting-code-review) and run `/codex:adversarial-review` focused on the guard's correctness and false-positive risk and the ladder/dark-readiness decisions. Address all Critical and Important findings.

- [ ] **Step 5: Open the impl PR.** Push `feat/el1-shadow-ladder`, open a PR to `main` (no merge, no auto-merge). Confirm the four required checks (typecheck, lint, test, security) plus the full dashboard suite and the new drift guard are green. Embed the before/after screenshots. No em-dashes in the PR body.

---

## Self-review

**Spec coverage:** Ladder values (Task 1), repoints (Task 1), directional sheet (Task 1), dark hook (Task 1), inbox redef removal + drift fix (Task 2), literal migrations (Task 3), amber gloss tokenization + armPulse allow (Task 4), cockpit (Task 5), shadcn overlays (Task 6), drift guard token assertions (Task 1) + recursive sweep + single-source (Task 7), screenshots + review + PR (Task 8). Out-of-scope residuals (small Tailwind shadows, landing, login rings, z-index) are documented in the spec, intentionally untouched.

**Placeholder scan:** none. Every step has exact strings or exact commands.

**Type/name consistency:** `LITERAL_SHADOW_COLOR` defined once (Task 1), reused in Task 7. `collectGovernedFiles`, `tokenValue`, `RAW_HSL_TRIPLE` are pre-existing module-scope helpers. `--shadow-1..5`, `--shadow-color`, `--shadow-action-gloss`, `--shadow-sheet` names are consistent across spec and plan.
