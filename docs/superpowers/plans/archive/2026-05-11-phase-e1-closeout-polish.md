# Phase E1 closeout polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply two copy edits (Riley body bullets, synergy headline) and one roadmap update to close out Phase E1 of the agent-first redesign.

**Architecture:** Pure copy/data changes in two existing React components plus a one-line roadmap update. No new files, no test additions, no API or schema changes.

**Tech Stack:** TypeScript, React, Next.js 14, Tailwind CSS, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-11-phase-e1-closeout-polish-design.md`

---

## File Structure

- **Modify** `apps/dashboard/src/components/landing/v6/beat-riley.tsx` — `BULLETS` constant + its render block.
- **Modify** `apps/dashboard/src/components/landing/v6/synergy.tsx` — the `<Reveal as="h2">` headline.
- **Modify** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` — line 148.

No new files. No tests added (no existing snapshot/visual tests on these components, and the spec explicitly excludes test additions for copy changes).

---

## Task 0: Create the feature branch

**Files:** none.

- [ ] **Step 1: Verify clean working tree on main.**

```bash
git branch --show-current
git status --short
```

Expected: `main` on the first command, empty output on the second. If either fails, stop and surface it.

- [ ] **Step 2: Create the branch.**

```bash
git checkout -b feat/phase-e1-closeout-polish
```

Expected: `Switched to a new branch 'feat/phase-e1-closeout-polish'`.

---

## Task 1: Rewrite Riley body bullets

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/beat-riley.tsx` — `BULLETS` const at lines 72–79, render block at lines 356–366.

- [ ] **Step 1: Replace the `BULLETS` constant.**

Find this block (currently lines 72–79):

```ts
const BULLETS = [
  ["Plans", " campaigns from a brief — objective, audience, budget, structure"],
  ["Reads", " spend, CPL, CPA, ROAS by ad set"],
  ["Finds", " budget leaks before they become habits"],
  ["Drafts", " pauses, reallocations, audience swaps, and launch plans"],
  ["Compares", " what changed against what happened"],
  ["Reports", " the next move in plain English"],
];
```

Replace with:

```ts
const BULLETS = [
  "Builds the plan, ships the ad sets",
  "Watches spend before it leaks",
  "Drafts the next move for approval",
  "Reports in plain English",
];
```

- [ ] **Step 2: Update the bullet render block to match Alex's pattern.**

Find this block (currently lines 356–366 inside the `<ul>` — note this is a JSX expression inline in the parent, so the outer braces in the snippets below are the JSX expression braces, NOT TS/JS block-statement braces; the fences are `text` to prevent prettier from rewriting them):

```text
{BULLETS.map(([head, tail]) => (
  <li
    key={head}
    className="relative pl-[1.05rem] text-[0.95rem] leading-[1.4] text-v6-graphite before:absolute before:left-0 before:top-[0.55rem] before:h-[5px] before:w-[5px] before:rounded-full before:bg-v6-graphite-4 before:content-['']"
  >
    <b className="font-medium">{head}</b>
    {tail}
  </li>
))}
```

Replace with:

```text
{BULLETS.map((b, i) => (
  <li
    key={i}
    className="relative pl-[1.05rem] text-[0.95rem] leading-[1.4] text-v6-graphite before:absolute before:left-0 before:top-[0.55rem] before:h-[5px] before:w-[5px] before:rounded-full before:bg-v6-graphite-4 before:content-['']"
  >
    {b}
  </li>
))}
```

This mirrors Alex's render in `apps/dashboard/src/components/landing/v6/beat-alex.tsx` lines 91–98 exactly (Alex uses `(b, i) => …` over plain strings).

- [ ] **Step 3: Typecheck the dashboard package.**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: passes with no errors. If errors mention `BULLETS` element shape, double-check the array is plain strings and the render uses `(b, i) => …` (not `([head, tail]) => …`).

---

## Task 2: Replace the synergy headline

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/synergy.tsx` — the `<Reveal as="h2">` block at lines 43–53.

- [ ] **Step 1: Replace the headline contents.**

Find this block (currently lines 47–52, inside the `<Reveal as="h2">`):

```tsx
They&rsquo;re better{" "}
<em className="v6-synergy-accent relative inline-block font-semibold not-italic text-v6-coral">
  together
</em>
.
```

Replace with:

```tsx
One desk, three voices,{" "}
<em className="v6-synergy-accent relative inline-block font-semibold not-italic text-v6-coral">
  one signal
</em>
.
```

The `<em>` wrapper, its classes, and the trailing `.` stay identical. Only the surrounding text and the emphasized word change. The `v6-synergy-accent` class is defined in `landing-v6.css` and continues to apply — do not touch the stylesheet.

- [ ] **Step 2: Typecheck.**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: passes.

---

## Task 3: Mark Phase E1 complete in the roadmap

**Files:**

- Modify: `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` — line 148.

- [ ] **Step 1: Replace the E1 roadmap line.**

Find (line 148):

```
- **E1.** Public marketing site three-wedge redesign (Alex + Riley + Mira instead of Alex-only)
```

Replace with:

```
- **E1.** ✅ Public marketing site three-wedge redesign — shipped via PR #426 (Nova→Riley), PR #430 (marketing truth-up), and the polish PR for this work.
```

Do not touch the E2 line (line 149) or surrounding sections.

---

## Task 4: Validation pass

**Files:** none modified.

- [ ] **Step 1: Lint.**

```bash
pnpm lint
```

Expected: passes. If failures, they should be in files this PR touched — fix in place, do not chase pre-existing warnings unrelated to this work.

- [ ] **Step 2: Repo-wide typecheck.**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 3: Dashboard production build (not run in CI).**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds. This step is required because `next build` is not part of CI — see memory `feedback_dashboard_build_not_in_ci.md`. `.js`-extension regressions and other Next-only issues only surface here.

- [ ] **Step 4: Visual check in browser.**

In one terminal:

```bash
pnpm --filter @switchboard/dashboard dev
```

In a browser, open `http://localhost:3002/` and verify:

1. **Synergy section headline** (scroll past hero): reads _"One desk, three voices, one signal."_ with the coral accent on the words `one signal`. Confirm no fallback to "better together" anywhere.
2. **Riley beat — body bullets:** four bullets, plain text, no bolded leading words, visually flush with Alex's four bullets above. The dashboard artifact above the bullets is unchanged.
3. **Responsive layout at narrow viewport:** resize the window below 900px (DevTools responsive mode). Both the synergy section and Riley's bullets render without overflow or alignment regressions.
4. **No console errors** in DevTools (React key warnings on the new bullet render would indicate the `key={i}` change was missed).

Stop the dev server (`Ctrl+C`) when done.

---

## Task 5: Commit and open PR

**Files:** all three modified files staged together as one commit.

- [ ] **Step 1: Stage and commit the three changes as one commit.**

```bash
git add apps/dashboard/src/components/landing/v6/beat-riley.tsx \
        apps/dashboard/src/components/landing/v6/synergy.tsx \
        docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md
git commit -m "$(cat <<'EOF'
chore(dashboard): close phase E1 — riley bullets + synergy headline polish

Riley body bullets now read as four outcomes matching Alex's render
pattern, replacing the six-item verb-led feature list. Synergy headline
replaces "They're better together" with "One desk, three voices, one
signal" — naming the mechanism the flow list below demonstrates.
Roadmap line 148 marked Phase E1 complete.

Spec: docs/superpowers/specs/2026-05-11-phase-e1-closeout-polish-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If a pre-commit hook (lint-staged + prettier) reformats files, that's fine — the commit will include the formatted result. Do not pass `--no-verify`.

- [ ] **Step 2: Push the branch.**

```bash
git push -u origin feat/phase-e1-closeout-polish
```

- [ ] **Step 3: Open the PR.**

```bash
gh pr create --title "chore(dashboard): close phase E1 — riley bullets + synergy headline polish" --body "$(cat <<'EOF'
## Summary
- Riley body bullets rewritten as four outcome bullets matching Alex's render pattern (was: six verb-led tuples with bolded leads).
- Synergy headline replaced: "They're better together" → "One desk, three voices, one signal" — names the mechanism the flow list below demonstrates.
- Roadmap line 148 marks Phase E1 complete.

Spec: `docs/superpowers/specs/2026-05-11-phase-e1-closeout-polish-design.md`

## Test plan
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @switchboard/dashboard build` (next build not in CI)
- [ ] Visual: synergy headline reads correctly with coral on "one signal"; Riley bullets show 4 outcomes flush with Alex's; no overflow at <900px

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL to the user.

---

## Out of scope

- Phase E2 (onboarding reframe).
- Per-agent voice differentiation on the marketing site.
- Cross-agent references inside beat artifacts.
- Any structural change to the home page or beats.
- Test additions.
