# Marketing copy truth-up — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-29-marketing-copy-truth-up-design.md` (head `68a7deb7` on branch `docs/marketing-copy-truth-up`)
**Implementation branch:** `feat/landing-v6-truth-up` (off `main`)

**Goal:** Edit the v6 landing page copy so every claim it makes is currently backed by the product, until billing/metering (slice D) and the Nova approval gate (slice B) ship.

**Architecture:** Pure copy-only edit across 12 files inside `apps/dashboard/`. No backend, billing, integration, or visual changes. The pricing section gets the largest restructure (price block prefixed `From`, capacity bullets dropped, CTAs become `mailto:`, bundle/overage/credits sections deleted). One regression test is added that fails if any banned claim string returns to the source files.

**Tech Stack:** Next.js 14 (App Router) · React 18 · Tailwind · Vitest. The v6 landing components live under `apps/dashboard/src/components/landing/v6/` and the home route is `apps/dashboard/src/app/(public)/page.tsx`.

---

## Dependency: v6 must be on main before this plan runs

This plan edits files that exist on `feat/landing-v6` but not yet on `main`. Order of merge:

1. Merge `feat/landing-v6` → `main` (the v6 page itself).
2. Merge `docs/marketing-copy-truth-up` → `main` (this spec + plan).
3. Create the implementation worktree off `main` and execute this plan.

If you must execute this plan before step 1, branch off `feat/landing-v6` instead and rebase later.

---

## File inventory

All paths relative to `apps/dashboard/`.

| File                                                           | Why we touch it                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/components/landing/v6/agent-context.tsx`                  | Alex hero rotating-headline string                                            |
| `src/components/landing/v6/hero.tsx`                           | Sub copy + proof line                                                         |
| `src/components/landing/v6/synergy.tsx`                        | Body paragraph rewrite                                                        |
| `src/components/landing/v6/beat-alex.tsx`                      | H2 heavy line + bullet 1                                                      |
| `src/components/landing/v6/beat-nova.tsx`                      | H2 (both lines) + deadpan paragraph + `BULLETS` array + new dashboard caption |
| `src/components/landing/v6/beat-mira.tsx`                      | Deadpan paragraph + bullet 1                                                  |
| `src/components/landing/v6/control.tsx`                        | Lede + four accordion item titles/details                                     |
| `src/components/landing/v6/pricing.tsx`                        | Pricing-head sub copy + Card type/data + card JSX + footer block              |
| `src/components/landing/v6/closer.tsx`                         | Sub copy + foot proof line                                                    |
| `src/components/landing/v6/footer.tsx`                         | Brand tagline + drop pulsing status indicator                                 |
| `src/app/(public)/page.tsx`                                    | `metadata.description`                                                        |
| `src/app/(public)/layout.tsx`                                  | `metadata.description` + `openGraph.description` + `twitter.description`      |
| `src/components/landing/v6/__tests__/no-banned-claims.test.ts` | **NEW** regression test                                                       |

No files deleted. No new dependencies. No CSS, Tailwind, or config changes.

---

## Task 0: Create implementation worktree

**Files:** none yet.

- [ ] **Step 1: From the main repo, create the worktree off `main`**

```bash
cd /Users/jasonli/switchboard
git fetch origin main --quiet
git worktree add -b feat/landing-v6-truth-up ../switchboard-truth-up-impl origin/main
cd ../switchboard-truth-up-impl
```

Expected: `Preparing worktree (new branch 'feat/landing-v6-truth-up')` followed by `HEAD is now at <sha>` matching origin/main.

- [ ] **Step 2: Verify the v6 components exist on this branch**

```bash
ls apps/dashboard/src/components/landing/v6/
```

Expected: 14 files including `agent-context.tsx`, `hero.tsx`, `pricing.tsx`, etc. If the directory does not exist, `feat/landing-v6` has not yet merged to main — see "Dependency" note above.

- [ ] **Step 3: Install deps and rebuild the dependency chain**

```bash
pnpm install
pnpm reset
```

Expected: pnpm completes; reset rebuilds schemas → core → db.

- [ ] **Step 4: Capture baseline test count**

```bash
pnpm --filter @switchboard/dashboard test 2>&1 | tail -5
```

Expected: `Test Files <N> passed (<N>)` and `Tests <M> passed (<M>)` (record the baseline `M`; the new regression test will add ~1 to it).

---

## Task 1: Alex hero rotating-headline string

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/agent-context.tsx`

- [ ] **Step 1: Read the current `AGENTS.alex.head` value**

```bash
rg -n "twelve" apps/dashboard/src/components/landing/v6/agent-context.tsx
```

Expected: `25:    head: 'replies in twelve <em class="text-v6-coral not-italic">seconds</em>.',`

- [ ] **Step 2: Apply the edit**

In `apps/dashboard/src/components/landing/v6/agent-context.tsx`, replace:

```tsx
    head: 'replies in twelve <em class="text-v6-coral not-italic">seconds</em>.',
```

with:

```tsx
    head: 'replies in <em class="text-v6-coral not-italic">seconds</em>.',
```

Only the Alex `head` line changes. Nova and Mira are unchanged.

- [ ] **Step 3: Verify**

```bash
rg -n "twelve" apps/dashboard/src/components/landing/v6/agent-context.tsx
rg -n "head: 'replies in <em" apps/dashboard/src/components/landing/v6/agent-context.tsx
```

Expected: first command returns nothing. Second command returns line 25 with the new string.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/agent-context.tsx
git commit -m "fix(landing-v6): drop unmeasured 'twelve seconds' from Alex hero headline"
```

---

## Task 2: Hero sub copy + proof line

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/hero.tsx`

- [ ] **Step 1: Read both target lines**

```bash
rg -n "share what they learn|Setup in minutes" apps/dashboard/src/components/landing/v6/hero.tsx
```

Expected:

```
81:            <b className="font-medium text-v6-graphite">they share what they learn.</b>
104:            Setup in minutes · Approval-first · Stays in your control
```

- [ ] **Step 2: Replace the sub copy**

In `apps/dashboard/src/components/landing/v6/hero.tsx`, change:

```tsx
<b className="font-medium text-v6-graphite">they share what they learn.</b>
```

to:

```tsx
<b className="font-medium text-v6-graphite">they share context as they go.</b>
```

- [ ] **Step 3: Replace the proof line**

In the same file, change:

```tsx
            Setup in minutes · Approval-first · Stays in your control
```

to:

```tsx
            Setup in a day · Agents draft, you publish · Stays in your control
```

- [ ] **Step 4: Verify**

```bash
rg -n "share what they learn|Setup in minutes|Approval-first" apps/dashboard/src/components/landing/v6/hero.tsx
rg -n "share context as they go|Setup in a day|Agents draft, you publish" apps/dashboard/src/components/landing/v6/hero.tsx
```

Expected: first command returns nothing. Second command returns two hits (sub copy + proof line).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/hero.tsx
git commit -m "fix(landing-v6): soften hero sub copy + proof line until slice B"
```

---

## Task 3: Pricing-head sub copy

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/pricing.tsx` (head block only — card restructure happens in Task 9)

The pricing section's heading sub copy contains a fifth `share what they learn` occurrence that the spec captured under copy-rule 3 ("shared context language"). Fix it now so we don't forget when Task 9 restructures the card grid.

- [ ] **Step 1: Find the line**

```bash
rg -n "share" apps/dashboard/src/components/landing/v6/pricing.tsx
```

Expected: line 86–88 — `Each agent does one thing exceptionally. Bundle when you're ready — they share what they learn.`

- [ ] **Step 2: Edit**

Replace:

```tsx
<p className="max-w-[36rem] text-base text-v6-graphite-2">
  Each agent does one thing exceptionally. Bundle when you&rsquo;re ready — they share what they
  learn.
</p>
```

with:

```tsx
<p className="max-w-[36rem] text-base text-v6-graphite-2">
  Each agent does one thing exceptionally. Bundle when you&rsquo;re ready — they share context as
  they go.
</p>
```

- [ ] **Step 3: Verify**

```bash
rg -n "share what they learn|share context as they go" apps/dashboard/src/components/landing/v6/pricing.tsx
```

Expected: one hit, the new "share context as they go" line.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/pricing.tsx
git commit -m "fix(landing-v6): drop 'share what they learn' from pricing head"
```

---

## Task 4: Synergy body paragraph

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/synergy.tsx`

The body paragraph is replaced wholesale. The three-row `sf-item` flow list below it (Alex tells Nova / Nova tells Mira / Mira tells Alex) stays — those describe direction, not measured cross-agent telemetry.

- [ ] **Step 1: Find the paragraph**

```bash
rg -n "Alex sees a lead|one memory" apps/dashboard/src/components/landing/v6/synergy.tsx
```

Expected: lines around 50–56 with the existing paragraph and `<b>The desk shares one memory.</b>`.

- [ ] **Step 2: Replace the paragraph**

In `apps/dashboard/src/components/landing/v6/synergy.tsx`, replace:

```tsx
<Reveal as="p" className="max-w-[30rem] text-[1.125rem] leading-[1.55] text-v6-graphite-2">
  Alex sees a lead asking about a product Nova is currently advertising — and tells Nova which
  audience converted. Nova spots a saturated ad set — and tells Mira which angle to retire. Mira
  ships a new variant — and Alex knows how to talk about it.{" "}
  <b className="font-medium text-v6-graphite">The desk shares one memory.</b>
</Reveal>
```

with:

```tsx
<Reveal as="p" className="max-w-[30rem] text-[1.125rem] leading-[1.55] text-v6-graphite-2">
  Built so each agent&rsquo;s signal can flow to the others — what Alex hears in chat, what Nova
  sees in spend, what Mira learns from creative reviews.{" "}
  <b className="font-medium text-v6-graphite">The desk shares context as it grows.</b>
</Reveal>
```

- [ ] **Step 3: Verify**

```bash
rg -n "one memory|Alex sees a lead|share what they learn" apps/dashboard/src/components/landing/v6/synergy.tsx
rg -n "shares context as it grows|signal can flow" apps/dashboard/src/components/landing/v6/synergy.tsx
```

Expected: first command empty, second command two hits.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/synergy.tsx
git commit -m "fix(landing-v6): synergy paragraph drops 'one memory' for shared-context framing"
```

---

## Task 5: Alex beat — H2 heavy + bullet 1

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/beat-alex.tsx`

The H2 light line ("Leads die in twelve minutes.") is kept — it's market framing, not a product claim. Only the heavy line and bullet 1 change.

- [ ] **Step 1: Find the targets**

```bash
rg -n "Alex replies in twelve|12-second median" apps/dashboard/src/components/landing/v6/beat-alex.tsx
```

Expected:

```
77:                Alex replies in twelve{" "}
88:                "12-second median first reply",
```

- [ ] **Step 2: Replace the H2 heavy line**

The current JSX wraps the word "twelve" then "{` `}" then `<em>seconds</em>.`. Replace the entire `<span>` block. Find:

```tsx
<span className="block font-semibold text-v6-graphite">
  Alex replies in twelve <em className="font-semibold not-italic text-v6-coral">seconds</em>.
</span>
```

Replace with:

```tsx
<span className="block font-semibold text-v6-graphite">
  Alex replies in <em className="font-semibold not-italic text-v6-coral">seconds</em>.
</span>
```

- [ ] **Step 3: Replace bullet 1**

In the bullets array directly below the deadpan paragraph, find:

```tsx
                "12-second median first reply",
```

Replace with:

```tsx
                "Fast first reply, every time",
```

- [ ] **Step 4: Verify**

```bash
rg -n "twelve|12-second" apps/dashboard/src/components/landing/v6/beat-alex.tsx
rg -n "Alex replies in \{|Fast first reply" apps/dashboard/src/components/landing/v6/beat-alex.tsx
```

Expected: first command returns one hit (the kept line "Leads die in twelve minutes."). Second command returns the new H2 fragment and the new bullet.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/beat-alex.tsx
git commit -m "fix(landing-v6): Alex beat drops unmeasured 12-second SLA claims"
```

---

## Task 6: Nova beat — H2 + deadpan + BULLETS + dashboard caption

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/beat-nova.tsx`

This is the largest non-pricing change. Five edits, one file.

- [ ] **Step 1: Find the targets**

```bash
rg -n "Plans the campaign|Pauses what|never auto-publishes|BULLETS = \[|Reports.*Monday" apps/dashboard/src/components/landing/v6/beat-nova.tsx
```

Expected hits include the `BULLETS = [` definition near the top of the file, plus the H2 + deadpan in the bottom half.

- [ ] **Step 2: Replace the `BULLETS` array (top of file)**

Find:

```tsx
const BULLETS = [
  ["Plans", " campaigns from a brief — objectives, audiences, budgets"],
  ["Launches", " ad sets, creative variants, lookalikes, retargeting"],
  ["Scans", " spend, CPL, CPA, ROAS by ad set, every hour"],
  ["Drafts", " pauses, budget reallocations, audience swaps"],
  ["Tests", " new variants against control with a guardrail"],
  ["Reports", " a Monday recap: what shipped, what it earned"],
];
```

Replace with:

```tsx
const BULLETS = [
  ["Plans", " campaigns from a brief — objective, audience, budget, structure"],
  ["Reads", " spend, CPL, CPA, ROAS by ad set"],
  ["Finds", " budget leaks before they become habits"],
  ["Drafts", " pauses, reallocations, audience swaps, and launch plans"],
  ["Compares", " what changed against what happened"],
  ["Reports", " the next move in plain English"],
];
```

- [ ] **Step 3: Replace the H2 (light + heavy lines)**

In the JSX (around line 324–335), find:

```tsx
<h2
  className="text-balance font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
  style={{ fontSize: "clamp(2rem, 3.8vw, 3.5rem)" }}
>
  <span className="block font-normal text-v6-graphite-2">Plans the campaign. Watches it run.</span>
  <span className="block font-semibold text-v6-graphite">
    Pauses what&rsquo;s <em className="font-semibold not-italic text-v6-coral">underperforming</em>.
  </span>
</h2>
```

Replace with:

```tsx
<h2
  className="text-balance font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
  style={{ fontSize: "clamp(2rem, 3.8vw, 3.5rem)" }}
>
  <span className="block font-normal text-v6-graphite-2">
    Bad ad sets don&rsquo;t pause themselves.
  </span>
  <span className="block font-semibold text-v6-graphite">
    Nova finds the waste and{" "}
    <em className="font-semibold not-italic text-v6-coral">drafts the fix</em>.
  </span>
</h2>
```

- [ ] **Step 4: Replace the deadpan paragraph**

Directly below the H2, find:

```tsx
<p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Nova is your full digital marketing optimizer on shift 24/7. She plans and launches campaigns,
  builds audiences, picks budgets, watches every ad set, drafts the fix when something slips, and
  measures lift after you ship.{" "}
  <b className="font-medium text-v6-graphite">Never auto-publishes the big stuff.</b> You review.
  You publish. Or you don&rsquo;t.
</p>
```

Replace with:

```tsx
<p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Nova is your ad operator on shift. She plans campaigns, reads performance, spots budget leaks,
  prepares changes, and turns the next move into a reviewable draft.{" "}
  <b className="font-medium text-v6-graphite">You approve what goes live.</b>
</p>
```

- [ ] **Step 5: Add the "Illustrative example" caption under the dashboard mock**

The dashboard surface ends with the closing `</Reveal>` of the `nova-bleed` block, and the body-text section starts with `<div className="mx-auto w-full max-w-[78rem] px-4 pb-32 ...">`. The new caption is inserted **between** them.

Find this exact transition in the file (look for `</Reveal>` followed by `</div>` followed by the body-text grid container):

```tsx
        </Reveal>
      </div>

      {/* Body text below dashboard */}
      <div className="mx-auto w-full max-w-[78rem] px-4 pb-32 pt-16 max-[900px]:pb-20 max-[900px]:pt-12">
```

Insert a new `<p>` between the closing `</div>` of `nova-bleed` and the opening of the body-text `<div>`:

```tsx
        </Reveal>
      </div>

      <p className="font-mono-v6 mx-auto mt-4 max-w-none text-center text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
        Illustrative example. Actual numbers vary by account.
      </p>

      {/* Body text below dashboard */}
      <div className="mx-auto w-full max-w-[78rem] px-4 pb-32 pt-16 max-[900px]:pb-20 max-[900px]:pt-12">
```

- [ ] **Step 6: Verify**

```bash
rg -n "Pauses what|Plans the campaign|every hour|Monday recap|Never auto-publishes the big stuff" apps/dashboard/src/components/landing/v6/beat-nova.tsx
rg -n "Bad ad sets|drafts the fix|next move in plain English|Illustrative example" apps/dashboard/src/components/landing/v6/beat-nova.tsx
```

Expected: first command returns nothing. Second command returns at least four hits (H2 light + H2 heavy + bullet 6 + caption).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/beat-nova.tsx
git commit -m "fix(landing-v6): Nova reframed as ad operator, dashboard mock captioned"
```

---

## Task 7: Mira beat — deadpan + bullet 1

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/beat-mira.tsx`

The H2 lines and the "Mira never auto-publishes" claim are kept (Mira's pipeline really does wait for approval at every stage).

- [ ] **Step 1: Find the targets**

```bash
rg -n "Trend scan" apps/dashboard/src/components/landing/v6/beat-mira.tsx
```

Expected: two hits — the deadpan paragraph (line ~50) and bullet 1 (line ~56).

- [ ] **Step 2: Replace the deadpan paragraph**

Find:

```tsx
<p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Trend scan, hook generation, scripts, storyboards, video.{" "}
  <b className="font-medium text-v6-graphite">Stop at any stage</b> and take what fits. You stay
  director — Mira never auto-publishes.
</p>
```

Replace with:

```tsx
<p className="max-w-[26rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Hooks, scripts, storyboards, video drafts.{" "}
  <b className="font-medium text-v6-graphite">Stop at any stage</b> and take what fits. You stay
  director — Mira never auto-publishes.
</p>
```

- [ ] **Step 3: Replace bullet 1**

Find the bullets array. The first row is currently:

```tsx
                ["Trend scan + ", "hook generation"],
```

Replace with:

```tsx
                [null, "Hook generation tuned to your brief"],
```

(Pass `null` for the first element so the bullet renders without a leading non-bold prefix; the `b && <b>` guard in the existing JSX handles a falsy first element. Skip a manual JSX rewrite.)

Wait — re-read the existing JSX in this file:

```tsx
                <li ... >
                  {a}
                  {b && <b className="font-medium">{b}</b>}
                </li>
```

That renders `{a}` as plain text and `{b}` as bold. We want the new bullet to read **Hook generation** … meaning the bold word leads. Adjust both the array and the rendering. Replace the bullet entry with:

```tsx
                [<b key="hook" className="font-medium">Hook generation</b>, " tuned to your brief"],
```

That keeps the existing render shape (`{a}{b}`) and produces "**Hook generation** tuned to your brief".

If the implementer prefers no JSX in a tuple, an alternative is to rewrite the bullet renderer to accept a `bold` field at the start. Either is fine. The above keeps the rest of the bullet rendering untouched.

- [ ] **Step 4: Verify**

```bash
rg -n "Trend scan" apps/dashboard/src/components/landing/v6/beat-mira.tsx
rg -n "Hooks, scripts|Hook generation tuned" apps/dashboard/src/components/landing/v6/beat-mira.tsx
```

Expected: first command empty. Second command two hits.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/beat-mira.tsx
git commit -m "fix(landing-v6): Mira deadpan drops 'trend scan' until verified"
```

---

## Task 8: Control accordion — lede + 4 items

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/control.tsx`

Five edits in one file: lede (in JSX) + four `ITEMS` entries (titles and details).

- [ ] **Step 1: Read the file**

```bash
wc -l apps/dashboard/src/components/landing/v6/control.tsx
sed -n '1,40p' apps/dashboard/src/components/landing/v6/control.tsx
```

Expected: ~120 lines with `ITEMS` defined near the top and the lede inside the JSX.

- [ ] **Step 2: Replace `ITEMS`**

Find the entire `const ITEMS: Item[] = [ ... ];` array and replace it with:

```tsx
const ITEMS: Item[] = [
  {
    num: "/01/",
    title: "Agents draft. You publish.",
    detail:
      "Every action can start supervised — you see the draft, you click send. Loosen specific actions to autonomous when you trust the pattern. The desk is built around reviewable drafts, clear logs, and human control.",
  },
  {
    num: "/02/",
    title: "Audited",
    detail:
      "Every reply, every ad-set change, every draft — logged with timestamp, agent, and reasoning. Queryable from your dashboard.",
  },
  {
    num: "/03/",
    title: "Where your work lives",
    detail:
      "Connects to the tools you already pay for: WhatsApp, Telegram, Meta Ads, Google Calendar. We don't ask you to migrate. Disconnect with one click.",
  },
  {
    num: "/04/",
    title: "Hands-off when ready",
    detail:
      "Once a workflow is proven — Alex's first replies, Nova's draft pauses — graduate it to autonomous as the agent earns trust. You stay in control of the leash.",
  },
];
```

- [ ] **Step 3: Replace the lede**

In the JSX, find:

```tsx
<p className="max-w-[22rem] text-base leading-[1.5] text-v6-graphite-2">
  Every agent runs through the same controls. Approval-first by default. You loosen the leash on
  your own time, not ours.
</p>
```

Replace with:

```tsx
<p className="max-w-[22rem] text-base leading-[1.5] text-v6-graphite-2">
  Every agent runs through the same controls. Agents draft, you publish. You loosen the leash on
  your own time, not ours.
</p>
```

- [ ] **Step 4: Verify**

```bash
rg -n "Approval-first|Exportable|Searchable|Cal\.com|Notion|in one toggle|per agent, per action|moves money|No agent ever" apps/dashboard/src/components/landing/v6/control.tsx
rg -n "Agents draft. You publish.|Queryable from your dashboard|earns trust" apps/dashboard/src/components/landing/v6/control.tsx
```

Expected: first command empty. Second command at least three hits (item 01 title + item 02 detail tail + item 04 detail tail).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/control.tsx
git commit -m "fix(landing-v6): control accordion drops unbacked claims (export/Notion/toggle/etc.)"
```

---

## Task 9: Pricing card restructure + footer replacement

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/pricing.tsx`

This is the structurally largest change: the `Card` type drops `strap` and `bullets` and gains `subtitle` + `ctaHref`; the `CARDS` data is rewritten with new prices ($249 / $249 / $399); the JSX adds a `From` mono eyebrow, drops the strap `<p>`, drops the bullet `<ul>`, and points the CTA at `c.ctaHref`; the entire pricing-foot block (bundle pills + overage `<details>` + "We recommend Alex") collapses to a single `<p>` caption.

Because the JSX edit spans ~70 contiguous lines, the cleanest approach is to **rewrite the whole file** with the canonical content below. The Read tool must be called before Write per dashboard convention, then a single Write replaces the file.

- [ ] **Step 1: Read the current file (required before Write)**

```bash
cat apps/dashboard/src/components/landing/v6/pricing.tsx | head -5
```

Expected: the import lines (`import { ArrowSig } from "./glyphs";` etc).

- [ ] **Step 2: Overwrite the file with the canonical truth-up version**

Write this exact content to `apps/dashboard/src/components/landing/v6/pricing.tsx`:

```tsx
import { ArrowSig } from "./glyphs";
import { Reveal } from "./reveal";

interface Card {
  agent: "alex" | "nova" | "mira";
  name: string;
  job: string;
  /** Pilot floor. Always rendered as "From $X / month". */
  price: string;
  /** One-line description of what the operator does. */
  subtitle: string;
  cta: string;
  /** mailto: target — pilot inbound goes through email until a real onboarding flow exists. */
  ctaHref: string;
  featured: boolean;
  hint?: string;
}

const CARDS: Card[] = [
  {
    agent: "alex",
    name: "Alex",
    job: "lead reply",
    price: "$249",
    subtitle: "Lead response and booking operator.",
    cta: "Start with Alex",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Alex",
    featured: true,
    hint: "Recommended starting point",
  },
  {
    agent: "nova",
    name: "Nova",
    job: "ad optimizer",
    price: "$249",
    subtitle: "Ad planning and optimization operator.",
    cta: "Start with Nova",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Nova",
    featured: false,
  },
  {
    agent: "mira",
    name: "Mira",
    job: "creative",
    price: "$399",
    subtitle: "Creative direction and production operator.",
    cta: "Start with Mira",
    ctaHref: "mailto:hello@switchboard.ai?subject=Start%20with%20Mira",
    featured: false,
  },
];

export function V6Pricing() {
  return (
    <section
      id="pricing"
      data-screen-label="07 Pricing"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-28 max-[900px]:py-20"
    >
      <div className="v6-beat-frame">
        <div className="mx-auto flex max-w-[80rem] items-center justify-between px-10 font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
          <span className="inline-flex items-center gap-[0.6rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
            <span>07 — Plans</span>
          </span>
          <span>Hire by the seat</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <Reveal className="mb-14 flex flex-col items-center gap-3 text-center">
          <h2
            className="max-w-[18ch] font-medium leading-[1.05] tracking-[-0.018em] text-v6-graphite"
            style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
          >
            Hire one. Or hire the <em className="font-semibold not-italic">desk</em>.
          </h2>
          <p className="max-w-[36rem] text-base text-v6-graphite-2">
            Each agent does one thing exceptionally. Bundle when you&rsquo;re ready — they share
            context as they go.
          </p>
        </Reveal>

        <div className="mx-auto grid w-full grid-cols-3 gap-5 max-[900px]:max-w-[28rem] max-[900px]:grid-cols-1">
          {CARDS.map((c) => (
            <Reveal key={c.agent}>
              <article
                className={`relative flex flex-col gap-5 rounded-2xl border p-8 pb-7 transition-[transform,box-shadow] duration-300 hover:-translate-y-[3px] ${
                  c.featured
                    ? "v6-pcard-featured border-[hsl(14_75%_55%_/_0.35)] bg-white shadow-[0_1px_0_hsl(20_12%_4%_/_0.03),0_0_0_1px_hsl(14_75%_55%_/_0.18)_inset,0_20px_50px_hsl(20_30%_30%_/_0.06)]"
                    : "border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 shadow-[0_1px_0_hsl(20_12%_4%_/_0.03),0_16px_40px_hsl(20_30%_30%_/_0.03)] hover:shadow-[0_1px_0_hsl(20_12%_4%_/_0.03),0_24px_60px_hsl(20_30%_30%_/_0.07)]"
                }`}
              >
                <header className="flex items-center gap-[0.7rem] border-b border-[hsl(20_8%_14%_/_0.06)] pb-[1.1rem]">
                  <span className="flex h-[2.4rem] w-[2.4rem] items-center justify-center rounded-lg border border-[hsl(20_8%_14%_/_0.06)] bg-white">
                    <svg viewBox="0 0 48 48" className="h-[1.6rem] w-[1.6rem]">
                      <use href={`#mark-${c.agent}`} />
                    </svg>
                  </span>
                  <span className="text-[1.25rem] font-semibold tracking-[-0.012em] text-v6-graphite">
                    {c.name}
                  </span>
                  <span className="font-mono-v6 ml-auto text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                    {c.job}
                  </span>
                </header>

                <div className="-mt-1 flex flex-col gap-[0.4rem]">
                  <span className="font-mono-v6 text-[10.5px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
                    From
                  </span>
                  <div className="flex items-baseline gap-[0.5rem]">
                    <span
                      className="whitespace-nowrap text-[2.875rem] font-medium leading-none tracking-[-0.025em] text-v6-graphite"
                      style={{ fontFeatureSettings: '"tnum","ss01"' }}
                    >
                      {c.price}
                    </span>
                    <span className="inline-flex items-baseline whitespace-nowrap text-[0.9375rem] tracking-[0.005em] text-v6-graphite-2">
                      <span className="mr-[0.3em] inline-block translate-y-[0.06em] text-[1.125rem] font-light leading-none text-v6-graphite-3">
                        /
                      </span>
                      month
                    </span>
                  </div>
                </div>

                <p className="text-[0.95rem] leading-[1.4] text-v6-graphite">{c.subtitle}</p>

                <a
                  href={c.ctaHref}
                  className={`mt-auto inline-flex w-full items-center justify-center gap-[0.65rem] whitespace-nowrap rounded-full px-6 py-[0.85rem] text-sm font-medium tracking-[-0.005em] transition-[transform,background-color,box-shadow] duration-[250ms] hover:-translate-y-px ${
                    c.featured
                      ? "bg-v6-graphite text-v6-cream shadow-[0_1px_0_hsl(20_12%_4%_/_0.15)] hover:bg-black hover:text-v6-cream hover:shadow-[0_8px_24px_hsl(20_12%_4%_/_0.18)]"
                      : "border border-[hsl(20_8%_14%_/_0.12)] bg-v6-cream-2 text-v6-graphite hover:bg-v6-cream"
                  }`}
                >
                  {c.cta}
                  <ArrowSig className="!h-[0.7rem] !w-[1.05rem]" />
                </a>

                {c.hint && (
                  <span className="v6-pcard-hint font-mono-v6 -mt-2 inline-flex items-center justify-center gap-[0.45rem] text-center text-[10px] font-medium uppercase tracking-[0.08em] text-v6-coral">
                    {c.hint}
                  </span>
                )}
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-14 flex flex-col items-center">
          <p className="font-mono-v6 max-w-[36rem] text-center text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
            Pilot pricing. Final pricing may vary by channels, spend level, and operator setup.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
```

Key differences from the previous file:

1. `Card` interface gains `subtitle` + `ctaHref`, loses `strap` + `bullets`.
2. `CARDS` data: prices update to $249 / $249 / $399; each card gets a `subtitle` and a `ctaHref` mailto:.
3. Pricing-head sub copy says "share context as they go" (rolls Task 3's intent forward — Task 3 already committed this same change, so the line is unchanged here; Write is idempotent).
4. Card body adds `From` eyebrow above the price block. Strap `<p>` becomes `<p>{c.subtitle}</p>` with `leading-[1.4]` and no `font-medium`. Bullet `<ul>` is gone.
5. Card CTA `href` is now `c.ctaHref`.
6. Pricing-foot collapses from `gap-8 (bundle pills + details + recommend-alex)` to `(single mono caption)`.

- [ ] **Step 3: Verify**

```bash
rg -n "Pick any two|Hire all three|save 15%|save 25%|14-day pilot|0\.15 / conversation|0\.75% of incremental|\$0\.20 / chat|\$0\.50 / credit|image = 1 credit|short video = 10|avatar video = 20|HD video = 50|Soft caps|We recommend Alex|Replies to leads in seconds|Catches bad ad sets|Ships creative while" apps/dashboard/src/components/landing/v6/pricing.tsx
rg -n "From|Pilot pricing\." apps/dashboard/src/components/landing/v6/pricing.tsx
rg -n "\$249|\$399" apps/dashboard/src/components/landing/v6/pricing.tsx
```

Expected: first command empty (no banned strings; old straps gone too). Second command returns the new "From" eyebrow and "Pilot pricing." caption. Third command returns the three new prices ($249 twice, $399 once).

- [ ] **Step 4: Typecheck (catches the problem early because the `Card` shape changed)**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
```

Expected: exit 0. The `Card` interface is local to `pricing.tsx` (not exported), so no other file should be affected. If a stale Prisma generation throws unrelated `@switchboard/core` errors, run `pnpm reset` once and retry.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/pricing.tsx
git commit -m "fix(landing-v6): pricing cards become From-priced pilot cards; drop bundles/overages/credits"
```

---

## Task 10: Closer — sub copy + foot proof line

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/closer.tsx`

The closer's primary CTA target stays as `meta.anchor` (i.e., `#alex` / `#nova` / `#mira`) — the closer's job is to anchor the visitor back to an agent beat, and the request-pricing action lives once on the pricing card (per spec).

- [ ] **Step 1: Find the targets**

```bash
rg -n "Approval-first from day one|14-day pilot of the desk" apps/dashboard/src/components/landing/v6/closer.tsx
```

Expected: two hits.

- [ ] **Step 2: Replace the sub copy**

Find:

```tsx
<p className="mx-auto mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Pick the seat that hurts most. Add another when ready. Approval-first from day one.
</p>
```

Replace with:

```tsx
<p className="mx-auto mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
  Pick the seat that hurts most. Add another when ready. Agents draft, you publish — from day one.
</p>
```

- [ ] **Step 3: Replace the foot proof line**

Find:

```tsx
<span className="font-mono-v6 mt-10 text-[11px] tracking-[0.08em] text-v6-graphite-3">
  14-day pilot of the desk · $199 · Cancel anytime
</span>
```

Replace with:

```tsx
<span className="font-mono-v6 mt-10 text-[11px] tracking-[0.08em] text-v6-graphite-3">
  Pilot access · Cancel anytime
</span>
```

- [ ] **Step 4: Verify**

```bash
rg -n "Approval-first|14-day pilot|\$199" apps/dashboard/src/components/landing/v6/closer.tsx
rg -n "Agents draft, you publish|Pilot access · Cancel anytime" apps/dashboard/src/components/landing/v6/closer.tsx
```

Expected: first command empty. Second command two hits.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/closer.tsx
git commit -m "fix(landing-v6): closer drops Approval-first claim and 14-day pilot SKU"
```

---

## Task 11: Footer — brand tagline + drop status pulse

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/footer.tsx`

- [ ] **Step 1: Find the targets**

```bash
rg -n "share what they learn|All systems normal" apps/dashboard/src/components/landing/v6/footer.tsx
```

Expected: two hits.

- [ ] **Step 2: Replace the brand tagline**

Find:

```tsx
<span className="text-[0.8125rem] leading-[1.5] text-v6-graphite-2">
  Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative.
  They share what they learn.
</span>
```

Replace with:

```tsx
<span className="text-[0.8125rem] leading-[1.5] text-v6-graphite-2">
  Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative.
  They share context as they go.
</span>
```

- [ ] **Step 3: Replace the status link**

Find:

```tsx
<a href="#" className="inline-flex items-center gap-[0.5rem]">
  <span className="v6-footer-pulse" />
  All systems normal
</a>
```

Replace with:

```tsx
<a href="#">Status</a>
```

The `v6-footer-pulse` CSS class still lives in `landing-v6.css` — that's fine; it's unused after this commit but cleaning the CSS is slice C scope.

- [ ] **Step 4: Verify**

```bash
rg -n "share what they learn|All systems normal|v6-footer-pulse" apps/dashboard/src/components/landing/v6/footer.tsx
rg -n "share context as they go" apps/dashboard/src/components/landing/v6/footer.tsx
```

Expected: first command empty. Second command one hit.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/footer.tsx
git commit -m "fix(landing-v6): footer drops 'share what they learn' and fake live-status pulse"
```

---

## Task 12: Page metadata description (4 occurrences)

**Files:**

- Modify: `apps/dashboard/src/app/(public)/page.tsx`
- Modify: `apps/dashboard/src/app/(public)/layout.tsx`

All four occurrences of the `description` string update in lockstep. The `title` stays.

- [ ] **Step 1: Find all occurrences**

```bash
rg -n "share what they learn" apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx
```

Expected: 4 hits — `page.tsx:20`, `layout.tsx:6`, `layout.tsx:10`, `layout.tsx:18`.

- [ ] **Step 2: Update `page.tsx`**

In `apps/dashboard/src/app/(public)/page.tsx`, replace all occurrences of:

```
They share what they learn.
```

with:

```
They share context as they go.
```

(Single occurrence inside `metadata.description`.)

- [ ] **Step 3: Update `layout.tsx` (3 occurrences — `description`, `openGraph.description`, `twitter.description`)**

In `apps/dashboard/src/app/(public)/layout.tsx`, apply the same replacement. Use `replace_all: true` (the find string is identical in all three places).

- [ ] **Step 4: Verify**

```bash
rg -n "share what they learn" apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx
rg -n "share context as they go" apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx
```

Expected: first command empty. Second command 4 hits.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx
git commit -m "fix(landing-v6): page + layout metadata description match new tagline"
```

---

## Task 13: Regression test — banned claim strings

**Files:**

- Create: `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts`

The verification grep from the spec is codified as a vitest test so any future edit that reintroduces a banned string fails CI. This test reads the v6 source files and the home page metadata files at runtime.

- [ ] **Step 1: Create the test directory if missing**

```bash
mkdir -p apps/dashboard/src/components/landing/v6/__tests__
```

- [ ] **Step 2: Write the failing test (with all banned patterns)**

Create `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts` with:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const V6_DIR = join(__dirname, "..");
const PUBLIC_DIR = join(__dirname, "../../..", "app", "(public)");

const sourceFiles = (): string[] => {
  const v6 = readdirSync(V6_DIR)
    .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
    .map((f) => join(V6_DIR, f));
  return [...v6, join(PUBLIC_DIR, "page.tsx"), join(PUBLIC_DIR, "layout.tsx")];
};

interface Banned {
  pattern: RegExp;
  reason: string;
}

const BANNED: Banned[] = [
  {
    pattern: /twelve seconds/,
    reason: "no SLA telemetry — Alex's first-reply timing is unmeasured",
  },
  { pattern: /12-second/, reason: "no SLA telemetry — Alex's first-reply timing is unmeasured" },
  { pattern: /one memory/, reason: "no shared-memory layer between agents" },
  { pattern: /14-day pilot/, reason: "no pilot SKU exists in billing" },
  { pattern: /Cal\.com/, reason: "Cal.com integration is URL-only, not a real connector" },
  { pattern: /Notion/, reason: "Notion connector does not exist" },
  { pattern: /Exportable/, reason: "no audit export endpoint" },
  { pattern: /Searchable/, reason: "no full-text audit search" },
  { pattern: /Pick any two/, reason: "no bundle discount logic" },
  { pattern: /Hire all three/, reason: "no bundle discount logic" },
  { pattern: /save 15%/, reason: "no bundle discount logic" },
  { pattern: /save 25%/, reason: "no bundle discount logic" },
  { pattern: /0\.15 \/ conversation/, reason: "no overage billing" },
  { pattern: /0\.75% of incremental/, reason: "no overage billing" },
  { pattern: /\$0\.20 \/ chat/, reason: "no overage billing" },
  { pattern: /\$0\.50 \/ credit/, reason: "no Mira credit system" },
  { pattern: /image = 1 credit/, reason: "no Mira credit system" },
  { pattern: /short video = 10/, reason: "no Mira credit system" },
  { pattern: /avatar video = 20/, reason: "no Mira credit system" },
  { pattern: /HD video = 50/, reason: "no Mira credit system" },
  { pattern: /in one toggle/, reason: "no per-action autonomy toggle UI" },
  { pattern: /per agent, per action/, reason: "no per-action autonomy toggle UI" },
  { pattern: /moves money/, reason: "Nova has no approval gate (slice B)" },
  { pattern: /Never auto-publishes the big stuff/, reason: "Nova has no approval gate (slice B)" },
  { pattern: /All systems normal/, reason: "no real status feed wired" },
  {
    pattern: /\$199(?!\d)/,
    reason: "no $199 14-day pilot SKU; new pilot prices are $249/$249/$399",
  },
  {
    pattern: /[Aa]pproval-first/,
    reason: "doctrine softened to 'agents draft, you publish' until slice B ships",
  },
];

describe("v6 landing — no banned marketing claims", () => {
  const files = sourceFiles();

  it("source file inventory is non-empty (smoke test)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const banned of BANNED) {
    it(`pattern ${banned.pattern} is absent (${banned.reason})`, () => {
      const offenders: string[] = [];
      for (const path of files) {
        const content = readFileSync(path, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (banned.pattern.test(line)) {
            offenders.push(`${path}:${idx + 1} → ${line.trim()}`);
          }
        });
      }
      if (offenders.length > 0) {
        const message = `Banned pattern ${banned.pattern} found:\n${offenders.join("\n")}\nReason: ${banned.reason}\nIf this claim is now backed by product code, update this test.`;
        throw new Error(message);
      }
    });
  }
});
```

- [ ] **Step 3: Run the test — expect PASS**

If Tasks 1–12 are complete, every banned pattern should already be absent from the source. Run:

```bash
pnpm --filter @switchboard/dashboard exec vitest run src/components/landing/v6/__tests__/no-banned-claims.test.ts 2>&1 | tail -30
```

Expected: every `it` passes (28 tests). If a banned pattern still appears, the test prints the file:line, the offending line text, and the reason — fix the source and re-run.

If you reach this task and a banned pattern is found, do **not** weaken the test. Go back to the relevant earlier task and fix the source.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts
git commit -m "test(landing-v6): regression test for banned marketing-claim strings"
```

---

## Task 14: Final verification

- [ ] **Step 1: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 2: Full test suite**

```bash
pnpm --filter @switchboard/dashboard test 2>&1 | tail -10
```

Expected: `Test Files <N+1> passed` and `Tests <M+28> passed` (the new file adds 28 tests — 27 banned-pattern tests plus the smoke inventory test). The exact baseline `M` was captured in Task 0 step 4.

- [ ] **Step 3: Production build**

```bash
pnpm --filter @switchboard/dashboard build 2>&1 | grep -E "Compiled|^├|^└|error|warn" | head -20
```

Expected: `✓ Compiled successfully`, then the route table includes `○ /` (statically prerendered home page).

- [ ] **Step 4: Manual grep (mirrors the test, but runs over the working tree directly)**

```bash
rg -nP "twelve seconds|12-second|one memory|14-day pilot|\$199(?!\d)|Cal\.com|Notion|Exportable|Searchable|Pick any two|Hire all three|save 15%|save 25%|0\.15 / conversation|0\.75% of incremental|\$0\.20 / chat|\$0\.50 / credit|image = 1 credit|short video = 10|avatar video = 20|HD video = 50|in one toggle|per agent, per action|moves money|Never auto-publishes the big stuff|All systems normal|[Aa]pproval-first" apps/dashboard/src/components/landing/v6/ apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx 2>&1 | grep -v "no-banned-claims.test.ts"
```

Expected: no output (the test file itself is excluded since it intentionally contains all banned patterns as regexes).

- [ ] **Step 5: Visual smoke (optional — only run if you want eyes on the page)**

```bash
pnpm --filter @switchboard/dashboard dev
```

Open `http://localhost:3002/` and walk the page top to bottom. Confirm:

- Hero rotating headline reads "Alex replies in seconds." (not "twelve seconds").
- Hero proof line reads "Setup in a day · Agents draft, you publish · Stays in your control".
- Synergy paragraph reads "Built so each agent's signal can flow to the others …".
- Nova heading reads "Bad ad sets don't pause themselves. / Nova finds the waste and drafts the fix.".
- Below the Nova dashboard mock, "Illustrative example. Actual numbers vary by account." caption appears.
- Pricing cards each show `From` eyebrow + price ($249 / $249 / $399) + subtitle + `Start with X →` button. No bullet checkmark list. No bundle pills below cards. No "What happens if I go over?" details. No "We recommend Alex" line below the cards.
- Pricing footer shows the single mono caption "Pilot pricing. Final pricing may vary by channels, spend level, and operator setup."
- Closer foot reads "Pilot access · Cancel anytime".
- Footer bottom-right column "Status" shows a static link, no pulsing dot.

Press Cmd+. or Ctrl+C to stop the dev server.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/landing-v6-truth-up
gh pr create --title "fix(landing-v6): truth-up marketing copy (slice A)" --body "$(cat <<'EOF'
## Summary
- Implements slice A of the v6 landing post-ship audit: every claim that the 2026-04-29 codebase audit marked as ❌ NOT FOUND or ⚠️ CONTRADICTED is removed or softened.
- Pricing cards become From-priced pilot cards (Alex \$249, Nova \$249, Mira \$399). Bundle pills, overage table, and Mira-credits paragraph are deleted. CTAs are mailto:hello@switchboard.ai.
- Approval-first language softens to "agents draft, you publish" across hero, control, closer, and metadata until slice B (Nova approval gate) ships.
- Adds a regression test that fails if any banned claim string returns to the source.

Spec: \`docs/superpowers/specs/2026-04-29-marketing-copy-truth-up-design.md\`
Plan: \`docs/superpowers/plans/2026-04-29-marketing-copy-truth-up-plan.md\`

## Test plan
- [ ] \`pnpm --filter @switchboard/dashboard typecheck\` passes
- [ ] \`pnpm --filter @switchboard/dashboard test\` passes (baseline + 28 new tests)
- [ ] \`pnpm --filter @switchboard/dashboard build\` succeeds with \`○ /\`
- [ ] Manual visual walk of the home page in dev confirms each beat reads as expected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Sequencing notes

- All tasks edit the v6 landing only. They do **not** require any backend, billing, or integration work.
- Tasks 1–12 are independent at the file level and could run in parallel if a subagent strategy uses isolated file diffs. With subagent-driven-development, dispatch one task per subagent in order; review between each.
- Task 13 (regression test) must run after all copy edits, since it asserts the edits succeeded.
- Task 14 (verification) must run last.

## Restoration after slice B and slice D ship

This plan does not include the language restoration that becomes possible after later slices. Reference for the future PR:

- After slice B (Nova approval gate) ships:
  - Hero proof line restores to `Setup in a day · Approval-first · Stays in your control`.
  - Closer sub copy restores to `Approval-first from day one.`
  - Control item 01 detail tail restores to "No external change goes live without approval."
  - The `[Aa]pproval-first` row in `BANNED` is removed from `no-banned-claims.test.ts`.

- After slice D (billing & metering MVP) ships and Stripe is wired:
  - Pricing cards regain capacity bullets and real prices/overages from the live config.
  - The `Card` interface regains `bullets`/`strap`/`overage` fields and the `<details>` overage block is restored with the live numbers.
  - The corresponding rows in `BANNED` (caps, overages, credit math, bundle discounts, $199 SKU) are removed from `no-banned-claims.test.ts`.

Do not anticipate either restoration in this PR.
