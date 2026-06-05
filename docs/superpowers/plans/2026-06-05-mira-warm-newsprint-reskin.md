# Mira Warm-Newsprint Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every surface Mira owns (Director's Desk `/mira`, review feed `/mira/review`, creative detail `/mira/creatives/[id]`, Home panel) onto the app's locked warm-newsprint canon: printed-portrait identity, Fraunces/Geist/mono type honesty, the inbox commit-moment pattern, and a sanctioned tokenized night register for the feed.

**Architecture:** Four sequential PRs off `main`: (A) decision-free quick wins (tokens, type honesty, greeting, guards), (B) the visible crew-skin (new `MiraHeader` with `PrintedPortraitAvatar`, card anatomy, display faces, panel minimal-parity, mobile nav), (C) commit-moment parity (Keep/Pass undo toast + silent-409), (D) the night register (new `--night-*` tokens replacing the feed's raw `#000/#fff` literals + reduced motion). Each PR is independently shippable; order matters because B/C/D edit the same files.

**Tech Stack:** Next.js app dir (dashboard, port 3002), React Query, vitest + @testing-library/react (jsdom), CSS modules + globals.css token system, pnpm + Turborepo.

**Spec:** `docs/audits/2026-06-05-mira-coherence-audit/report.md` (verified findings + the four LOCKED operator decisions: night-register feed · amber Keep · route + mobile nav parity · panel minimal-now). Canon sources: `apps/dashboard/src/app/globals.css`, `apps/dashboard/src/app/__tests__/token-governance.test.ts`, `docs/voice/in-app-voice.md`.

---

## Repo ground rules (read first)

- Worktree per `superpowers:using-git-worktrees`. After `git worktree add`: run `pnpm install` then `pnpm db:generate` (fresh worktrees fail `next build` on missing Prisma client otherwise). Postgres is NOT needed for any task in this plan (all tests are jsdom/mocked-Prisma).
- Every commit: lowercase first word after the conventional-commit type (`feat(dashboard): add ...`, never `feat(dashboard): Add ...`). lint-staged reformats on commit; if it changes files, `git add` again and re-commit.
- Before each push: `pnpm format:check` (CI prettier covers `*.ts` only but lint-staged formats `.tsx` at commit; a clean check avoids CI surprises).
- Dashboard test command: `pnpm --filter @switchboard/dashboard test -- <pattern>`. Core: `pnpm --filter @switchboard/core test -- <pattern>`. DB: `pnpm --filter @switchboard/db test -- <pattern>` (mocked Prisma; no live DB).
- Do NOT run `prettier --write` on any `.css` file (it reformats the whole file and has broken token tests before). Hand-format CSS to match neighbors.
- File size: new files in this plan are all far below the 600-line arch-check cap. `token-governance.test.ts` is large; if a new block tips it over the eslint max-lines cap for tests, move the block to a sibling `mira-governance.test.ts` importing from `./token-governance.lib` (same pattern as `type-body-governance.test.ts`).

## File structure

**PR-A (quick wins)** modifies: `components/cockpit/tokens.ts`, `components/cockpit/identity.tsx`, `components/cockpit/mira/{mira-ready-to-review,mira-in-production-tray,mira-kept-shelf,mira-desk-skeleton}.tsx`, `app/(auth)/mira/creatives/[id]/{creative-detail-page,page}.tsx`, `components/cockpit/mira/mira-brief-box.tsx`, `app/globals.css`, `app/__tests__/token-governance.test.ts`, `src/__tests__/in-app-voice.test.ts`, `next.config.mjs`, `packages/core/src/agent-home/greeting.ts`, `packages/db/src/stores/prisma-greeting-signal-store.ts`.

**PR-B (crew skin)** creates: `components/cockpit/mira/mira-header.tsx` + `mira-header.module.css`, `components/cockpit/mira/mira-desk.module.css`, `hooks/use-prefers-reduced-motion.ts`. Modifies: desk/feed pages, the four desk modules, `mira-clip-actions.tsx` (Keep color), `agent-panel/mira-panel.tsx` + `agent-panel.module.css`, `hooks/use-mira-desk.ts`, `layout/primary-nav.tsx`, `agent-avatar/printed-portrait-avatar.tsx`, detail page.

**PR-C (commit moment)** modifies: `hooks/use-review-decision.ts`, `components/cockpit/mira/{mira-clip-actions,mira-clip-card,mira-creative-feed}.tsx`.

**PR-D (night register)** modifies: `app/globals.css`, `app/__tests__/token-governance.test.ts`, `components/cockpit/mira/{mira-feed-page,mira-clip-card,mira-clip-actions,mira-creative-feed}.tsx`, `app/(auth)/mira/review/page.tsx`, `hooks/use-mira-feed.ts`.

---

# PR-A: coherence quick wins (`feat/mira-reskin-a-quick-wins`)

No design decisions in this PR; everything is mechanical honesty.

### Task A0: Branch + baseline

- [ ] **Step 1: Create worktree + branch off fresh main**

```bash
git fetch origin main
git worktree add .claude/worktrees/mira-reskin-a -b feat/mira-reskin-a-quick-wins origin/main
cd .claude/worktrees/mira-reskin-a
pnpm install && pnpm db:generate
```

- [ ] **Step 2: Baseline green**

Run: `pnpm --filter @switchboard/dashboard test -- mira`
Expected: all current Mira suites PASS (record the count).

### Task A1: Cockpit token additions (`T.mono`, `T.display`, `T.actionFg`)

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/tokens.ts`
- Test: `apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts
import { describe, it, expect } from "vitest";
import { T } from "../tokens";

describe("cockpit T tokens (mira reskin additions)", () => {
  it("exposes the loaded mono face as a var token (never a raw family name)", () => {
    expect(T.mono).toBe("var(--font-mono-editorial)");
  });
  it("exposes the app display face (Fraunces)", () => {
    expect(T.display).toBe("var(--font-display-app)");
  });
  it("exposes the AA action foreground", () => {
    expect(T.actionFg).toBe("hsl(var(--action-foreground))");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- cockpit/__tests__/tokens`
Expected: FAIL (`T.mono` undefined).

- [ ] **Step 3: Implement**

In `tokens.ts`, extend the `T` object (after the `red` line, before `} as const;`):

```ts
  red: "hsl(var(--destructive))",
  // Type + foreground honesty (mira reskin): the loaded next/font faces and the
  // AA amber foreground, so inline cockpit styles never name a raw family or #fff.
  mono: "var(--font-mono-editorial)",
  display: "var(--font-display-app)",
  actionFg: "hsl(var(--action-foreground))",
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- cockpit/__tests__/tokens`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/tokens.ts apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts
git commit -m "feat(dashboard): add mono/display/actionFg cockpit tokens"
```

### Task A2: Guard + kill raw `"JetBrains Mono"` strings and synthetic 700s

The loaded JetBrains cut is 400/500/600 (`layout.tsx`); a raw family string only matches a system-installed font and `fontWeight: 700` renders synthetic bold. Guard first (red), then fix (green).

**Files:**
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (append block)
- Modify: `components/cockpit/mira/mira-ready-to-review.tsx`, `components/cockpit/mira/mira-in-production-tray.tsx`, `components/cockpit/mira/mira-kept-shelf.tsx`, `components/cockpit/identity.tsx`, `app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`

- [ ] **Step 1: Write the failing guard (append at end of token-governance.test.ts)**

```ts
describe("type honesty: no raw font-family strings in governed TSX (mira reskin)", () => {
  it("inline fontFamily must be a var() token or inherit, never a raw family name", () => {
    const offenders: string[] = [];
    for (const f of collectGovernedFiles()) {
      if (!/\.(ts|tsx)$/.test(f.path)) continue;
      if (!typeVoiceGoverned(f.path)) continue;
      const re = /fontFamily:\s*["'`](?!inherit\b|var\()/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const line = f.content.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(f.path)}:${line}`);
      }
    }
    expect(
      offenders,
      "raw font-family strings bypass next/font (use T.mono / T.display / var(--font-*))",
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run guard to verify it fails and enumerate every hit**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance`
Expected: FAIL listing at least these 8 sites: `mira-ready-to-review.tsx:24`, `mira-in-production-tray.tsx:40`, `mira-in-production-tray.tsx:84`, `mira-kept-shelf.tsx:26`, `identity.tsx:105`, `creative-detail-page.tsx:105`, `creative-detail-page.tsx:238`, `creative-detail-page.tsx:313`. If the sweep flags ADDITIONAL governed cockpit files (e.g. `status-pill.tsx`), apply the identical substitution there too.

- [ ] **Step 3: Fix every site**

In each flagged style object: import `T` is already present in all five files. Replace `fontFamily: "JetBrains Mono"` with `fontFamily: T.mono`, and wherever that same style object declares `fontWeight: 700`, change to `fontWeight: 600` (the loaded cut tops out at 600). Example, `mira-ready-to-review.tsx` eyebrow:

```tsx
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: T.ink3,
            }}
          >
```

Apply the same two-line change in `mira-in-production-tray.tsx` (h2 at ~40 and status span at ~84: the span has no fontWeight, family only), `mira-kept-shelf.tsx` (h2 at ~26), `identity.tsx` (subtitle wrapper at ~105: family only), and the three `creative-detail-page.tsx` eyebrow spans (~105, ~238, ~313: family only).

- [ ] **Step 4: Give the hero numeral the mono tabular face (audit B4)**

In `mira-ready-to-review.tsx`, the count numeral (the `fontSize: 36` span) gains a family:

```tsx
          <span
            style={{
              marginTop: 4,
              fontFamily: T.mono,
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1,
              color: T.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </span>
```

- [ ] **Step 5: Run guard + the mira suites**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance` then `pnpm --filter @switchboard/dashboard test -- mira`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/dashboard/src
git commit -m "fix(dashboard): replace raw jetbrains mono strings with the loaded mono token"
```

### Task A3: Amber buttons use the AA foreground token (audit A8)

**Files:** `mira-brief-box.tsx`, `mira-ready-to-review.tsx`, `mira-clip-actions.tsx`, `creative-detail-page.tsx`

- [ ] **Step 1: Replace the white literals on AMBER grounds only**

(The dark-feed buttons on black grounds keep `#fff` until PR-D tokenizes the night register.)

- `mira-brief-box.tsx` `btn` const: `color: "#fff"` → `color: T.actionFg`
- `mira-brief-box.tsx` `chip()` active branch: `color: active ? "#fff" : T.ink2` → `color: active ? T.actionFg : T.ink2` (the chip ground changes to ink in PR-B; actionFg is correct on both)
- `mira-ready-to-review.tsx` Link: `color: "#fff"` → `color: T.actionFg`
- `mira-clip-actions.tsx` confirm-continue button (the one with `background: T.amber, color: "#fff"`): `color: T.actionFg`
- `creative-detail-page.tsx`: both `color: "white"` occurrences on `background: T.amber` buttons → `color: T.actionFg`; the stop button `background: T.red, color: "white"` → `color: T.actionFg`

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @switchboard/dashboard test -- mira`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -A apps/dashboard/src
git commit -m "fix(dashboard): amber buttons consume the action-foreground token"
```

### Task A4: Tokenize the stop-confirm risk wash (audit A7)

**Files:** `apps/dashboard/src/app/globals.css`, `app/__tests__/token-governance.test.ts`, `creative-detail-page.tsx`

- [ ] **Step 1: Write the failing token-definition test (append to the new block from A2)**

```ts
describe("risk tint (mira stop confirm)", () => {
  it("defines the terracotta risk-tint primitive and semantic alias", () => {
    expect(tokenValue("palette-risk-tint")).toBe("14 45% 93%");
    expect(tokenValue("risk-tint")).toBe("var(--palette-risk-tint)");
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- token-governance`
Expected: FAIL (`token --palette-risk-tint is not defined`).

- [ ] **Step 2: Add the tokens to globals.css**

In the `:root` primitives, directly under the `--palette-violet-tint` line:

```css
    --palette-risk-tint: 14 45% 93%; /* dusty terracotta wash, spec §4 high-risk ground */
```

In the semantic alias section (near the other one-line semantics such as `--action`), add:

```css
    --risk-tint: var(--palette-risk-tint); /* destructive-confirm ground (consumed hsl(var())) */
```

- [ ] **Step 3: Point the detail stop wash at it**

In `creative-detail-page.tsx`, the `confirm === "stop"` panel: delete the two-line "Intentional red wash" comment and replace `background: "#F6ECEC",` with:

```tsx
                background: "hsl(var(--risk-tint))",
```

- [ ] **Step 4: Run tests, then commit**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance mira`
Expected: PASS

```bash
git add -A apps/dashboard/src
git commit -m "feat(dashboard): tokenize the stop-confirm risk tint"
```

### Task A5: Greeting honesty (pluralization + count alignment + em-dash removal)

Live bug: the desk header reads "You've got 1 drafts" while the hero says 3. Three fixes: (1) `inboxCount` for mira counts only `awaitingReview`, not what the surfaces call drafts; align it to the desk hero's `readyToReviewCount`. (2) `countNoun` is a static plural. (3) Four greeting strings carry em-dashes (banned, `docs/voice/in-app-voice.md` §5) and render live on the desk.

**Files:**
- Modify: `packages/core/src/agent-home/greeting.ts`
- Modify: `packages/db/src/stores/prisma-greeting-signal-store.ts`
- Tests: the existing greeting suites (locate with `pnpm --filter @switchboard/core test -- greeting` and `pnpm --filter @switchboard/db test -- greeting-signal`)

- [ ] **Step 1: Write the failing core tests (append to the existing greeting test file in `packages/core/src/agent-home/__tests__/`)**

```ts
describe("busy-count pluralization", () => {
  const signal = { inboxCount: 1, oldestOpenItemAgeHours: 30, hoursSinceLastOperatorAction: 1 };
  it("singularizes the busy noun at count 1", () => {
    const segs = buildSegments("busy", signal, AGENT_CONFIGS_FOR_TEST.mira, null);
    expect(segs.map((s) => s.text).join("")).toBe("You've got 1 draft");
  });
  it("keeps the plural above 1", () => {
    const segs = buildSegments(
      "busy",
      { ...signal, inboxCount: 3 },
      AGENT_CONFIGS_FOR_TEST.mira,
      null,
    );
    expect(segs.map((s) => s.text).join("")).toBe("You've got 3 drafts");
  });
});

describe("voice: greeting prose carries no em-dash", () => {
  it("every variant/agent combination is em-dash free", () => {
    const agents = ["alex", "riley", "mira"] as const;
    const variants = ["welcome", "quiet", "busy", "named-lead"] as const;
    for (const agentKey of agents) {
      for (const variant of variants) {
        const segs = buildSegments(
          variant,
          { inboxCount: 2, oldestOpenItemAgeHours: 1, hoursSinceLastOperatorAction: 1 },
          AGENT_CONFIGS_FOR_TEST[agentKey],
          null,
        );
        const text = segs.map((s) => s.text).join("");
        expect(text, `${agentKey}/${variant}`).not.toMatch(/—/);
      }
    }
  });
});
```

Note: the file's existing tests show how configs are accessed (the registry is module-private; existing tests either export a test handle or construct configs inline). Mirror whatever access pattern the file already uses; if none exists, export `AGENT_CONFIGS` as `AGENT_CONFIGS_FOR_TEST` from `greeting.ts` (it is already pure data).

Run: `pnpm --filter @switchboard/core test -- greeting`
Expected: FAIL (singular case renders "1 drafts"; em-dash scan hits 4 strings).

- [ ] **Step 2: Implement in `greeting.ts`**

Config type (line ~73) gains a singular:

```ts
  busyThreshold: number;
  busyAgeHoursThreshold: number;
  /** Plural noun for the busy count ("3 drafts"). */
  countNoun: string;
  /** Singular form ("1 draft"). */
  countNounSingular: string;
```

Registry values: alex `countNounSingular: "lead"`, riley `countNounSingular: "ad set"`, mira `countNounSingular: "draft"`.

Busy branch (line ~178):

```ts
  if (variant === "busy") {
    const noun = inboxCount === 1 ? config.countNounSingular : countNoun;
    return [
      { kind: "text", text: "You've got " },
      { kind: "accent", text: `${inboxCount} ${noun}` },
    ];
  }
```

The four em-dash strings:

- line ~156 (mira welcome): `"Ready to create. I'll bring you drafts to review. Never published without you."`
- line ~211 (alex named-lead fallback): `"I've got a few leads lined up, ready when you are."`
- line ~218 (riley named-lead fallback): `"A few items need review. Let me know when you're ready."`
- line ~222 (mira named-lead fallback): `"A few drafts are ready for review, whenever you are."`

- [ ] **Step 3: Run core tests**

Run: `pnpm --filter @switchboard/core test -- greeting`
Expected: PASS

- [ ] **Step 4: Align the mira signal count (failing db test first)**

In the existing `prisma-greeting-signal-store` test (mocked Prisma), find the mira signal case and add: seed the mocked read-model jobs with two undecided `draft_ready` jobs, one `kept` job, and one mid-pipeline job with no video; assert `inboxCount === 2` (kept and in-production jobs are NOT "drafts you've got"). Follow the file's existing mock shape exactly; the assertion is the new part:

```ts
expect(signal.inboxCount).toBe(2); // = buildMiraDeskModel(rm).readyToReviewCount, the desk-hero count
```

Run: `pnpm --filter @switchboard/db test -- greeting-signal`
Expected: FAIL (current value counts only awaitingReview).

- [ ] **Step 5: Implement in `prisma-greeting-signal-store.ts`**

Add `buildMiraDeskModel` to the core import (it is exported from `@switchboard/core`; verify with `grep -rn "buildMiraDeskModel" packages/core/src/index.ts packages/core/src/creative-read-model/index.ts`):

```ts
import type { PrismaClient } from "@prisma/client";
import type { AgentKey } from "@switchboard/schemas";
import { buildMiraDeskModel, type agentHome, type MiraCreativeJobSummary } from "@switchboard/core";
```

In `getMiraSignal`, replace the return's count line:

```ts
    return {
      // The desk hero's exact count (undecided, ready-to-review drafts): the
      // greeting must agree with the surface it sits above.
      inboxCount: buildMiraDeskModel(readModel).readyToReviewCount,
      oldestOpenItemAgeHours,
      hoursSinceLastOperatorAction,
    };
```

- [ ] **Step 6: Run db + core suites, rebuild, commit**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test`
Expected: PASS (pre-existing pg_advisory_xact_lock integrity flakes are known; only judge the greeting suites).

```bash
git add packages/core/src/agent-home packages/db/src/stores
git commit -m "fix(core,db): pluralize greeting count, align mira count with the desk hero, drop em-dashes"
```

### Task A6: Voice-corpus ratchet (+5 mira files)

**Files:** `apps/dashboard/src/__tests__/in-app-voice.test.ts`

- [ ] **Step 1: Add the five missing copy-bearing files to `CORPUS` (after the existing mira entries at ~99-102)**

```ts
  "components/cockpit/mira/mira-clip-card.tsx",
  "components/cockpit/mira/mira-feed-page.tsx",
  "components/cockpit/mira/mira-ready-to-review.tsx",
  "components/cockpit/mira/mira-kept-shelf.tsx",
  "components/cockpit/mira/mira-in-production-tray.tsx",
```

- [ ] **Step 2: Run the voice guard; fix any surfaced violation in those files (expected: zero today)**

Run: `pnpm --filter @switchboard/dashboard test -- in-app-voice`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/__tests__/in-app-voice.test.ts
git commit -m "test(dashboard): ratchet five mira files into the voice corpus"
```

### Task A7: Detail metadata title em-dash

**Files:** `apps/dashboard/src/app/(auth)/mira/creatives/[id]/page.tsx`

- [ ] **Step 1: Replace the title**

```ts
export const metadata: Metadata = {
  title: "Draft · Mira",
  description: "Draft-only review for a single creative. Nothing is published without you.",
};
```

- [ ] **Step 2: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/mira/creatives/[id]/page.tsx"
git commit -m "fix(dashboard): drop the em-dash from the draft detail title"
```

### Task A8: CSP media-src (videos are dead in every environment that serves media cross-origin)

**Files:** `apps/dashboard/next.config.mjs`

- [ ] **Step 1: Add a media-src directive to the CSP array (after the `img-src` line, mirroring its breadth)**

```js
      "default-src 'self'",
      "img-src 'self' data: https:",
      "media-src 'self' blob: https:",
```

- [ ] **Step 2: Verify the dev server serves the header**

Run: `pnpm --filter @switchboard/dashboard dev` (or against a running instance) then `curl -sI http://localhost:3002/ | grep -i content-security`
Expected: the printed policy contains `media-src 'self' blob: https:`. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/next.config.mjs
git commit -m "fix(dashboard): allow https media sources in the csp"
```

### Task A9: Desk skeleton parity (audit D9)

**Files:** `apps/dashboard/src/components/cockpit/mira/mira-desk-skeleton.tsx`

- [ ] **Step 1: Extend the skeleton to preview the real desk order (header band, brief box, hero, tray, shelf)**

```tsx
import { type CSSProperties } from "react";

const block = "animate-pulse";
const blockStyle: CSSProperties = { background: "var(--canvas-3)", borderRadius: 10 };

/** Layout-matched skeleton for Mira's desk: header band, brief box, hero CTA,
 *  in-production tray, kept shelf (the real module order). Shared by the route shell. */
export function MiraDeskSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading Mira's desk"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div
          data-skeleton-block
          className={block}
          style={{ ...blockStyle, width: 44, height: 44, borderRadius: 12 }}
        />
        <div data-skeleton-block className={block} style={{ ...blockStyle, height: 36, flex: 1 }} />
      </div>
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 150 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 120 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 64 }} />
      <div data-skeleton-block className={block} style={{ ...blockStyle, height: 110 }} />
    </div>
  );
}
```

- [ ] **Step 2: Run the desk suites (`mira-desk-skeleton.test.tsx` exists; update its block-count expectation if it asserts 3 blocks → now 6)**

Run: `pnpm --filter @switchboard/dashboard test -- mira-desk`
Expected: PASS after updating the count assertion.

- [ ] **Step 3: Commit**

```bash
git add -A apps/dashboard/src/components/cockpit/mira
git commit -m "feat(dashboard): desk skeleton previews the real module order"
```

### Task A10: PR-A wrap

- [ ] **Step 1: Full gates**

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/db test
pnpm typecheck
pnpm format:check
```

Expected: all green (known flakes: `pg_advisory_xact_lock` integrity tests, chat attribution under load; rerun before investigating).

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/mira-reskin-a-quick-wins
gh pr create --title "fix(dashboard,core): mira coherence quick wins (type honesty, greeting, risk tint, csp)" --body "PR-A of the Mira warm-newsprint reskin (plan: docs/superpowers/plans/2026-06-05-mira-warm-newsprint-reskin.md). Decision-free mechanical fixes: T.mono/T.display/T.actionFg + raw-font guard, hero numeral mono, risk-tint token, greeting pluralization + desk-aligned count + em-dash removal, voice-corpus ratchet, detail title, CSP media-src, skeleton parity.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR-B: Mira joins the crew (`feat/mira-reskin-b-crew-skin`)

Branch off main AFTER PR-A merges. The visible reskin: printed-portrait identity, Fraunces moments, card anatomy, violet back to identity-only, panel minimal-parity, mobile nav.

### Task B0: Branch + baseline (same recipe as A0, branch `feat/mira-reskin-b-crew-skin`, worktree `.claude/worktrees/mira-reskin-b`)

- [ ] Create worktree, install, db:generate, baseline `pnpm --filter @switchboard/dashboard test -- mira` green.

### Task B1: Shared reduced-motion hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-prefers-reduced-motion.ts`
- Modify: `apps/dashboard/src/components/agent-avatar/printed-portrait-avatar.tsx`
- Test: `apps/dashboard/src/hooks/__tests__/use-prefers-reduced-motion.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-prefers-reduced-motion.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe("usePrefersReducedMotion", () => {
  it("reads the OS preference after mount", async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("defaults to false when motion is allowed", async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- use-prefers-reduced-motion`
Expected: FAIL (module not found).

- [ ] **Step 2: Create the hook (lifted verbatim from printed-portrait-avatar.tsx)**

```ts
// apps/dashboard/src/hooks/use-prefers-reduced-motion.ts
"use client";

import { useEffect, useState } from "react";

/** OS reduced-motion preference. Shared by the printed-portrait avatar and the
 *  Mira feed autoplay gate. jsdom mocks may omit the listener API, hence the
 *  optional chaining. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
```

- [ ] **Step 3: Point printed-portrait-avatar at it**

In `printed-portrait-avatar.tsx`: delete the local `usePrefersReducedMotion` function (lines ~44-58) and add the import:

```ts
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
```

- [ ] **Step 4: Run hook + avatar suites**

Run: `pnpm --filter @switchboard/dashboard test -- use-prefers-reduced-motion printed-portrait agent-avatar`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A apps/dashboard/src
git commit -m "refactor(dashboard): share the reduced-motion hook"
```

### Task B2: `MiraHeader` (printed-portrait identity + hydration-safe mission trigger)

Replaces the legacy cockpit `Identity` on Mira surfaces: real sprite instead of the letter "M", Fraunces name in the deep ink, no in-band Halt button (the masthead `HaltButtonClient` is the one halt affordance; this kills the live duplicate-halt). The hydration mismatch (server text vs client mission-button) is fixed with a mounted gate.

**Files:**
- Create: `apps/dashboard/src/components/cockpit/mira/mira-header.tsx`
- Create: `apps/dashboard/src/components/cockpit/mira/mira-header.module.css`
- Test: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/src/components/cockpit/mira/__tests__/mira-header.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MiraHeader } from "../mira-header";

vi.stubGlobal(
  "matchMedia",
  vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
);

describe("MiraHeader", () => {
  it("renders the printed-portrait sprite, not a letter monogram", () => {
    const { container } = render(
      <MiraHeader halted={false} subtitle="Creative drafts, ready for your review" line={null} />,
    );
    const avatar = container.querySelector('[data-agent="mira"]');
    expect(avatar).not.toBeNull();
    expect(avatar!.getAttribute("data-sprite-state")).toBe("idle");
    expect(screen.getByText("Mira")).toBeInTheDocument();
  });

  it("drives the draft sprite state from working status", () => {
    const { container } = render(
      <MiraHeader status="working" halted={false} subtitle="sub" line={null} />,
    );
    expect(container.querySelector('[data-agent="mira"]')!.getAttribute("data-sprite-state")).toBe(
      "draft",
    );
  });

  it("upgrades the subtitle to a mission button only after hydration (no SSR mismatch)", async () => {
    const onOpenMission = vi.fn();
    render(
      <MiraHeader
        halted={false}
        subtitle="Creative drafts, ready for your review"
        line={null}
        missionInteractive
        onOpenMission={onOpenMission}
      />,
    );
    // After mount (the effect has run) the trigger exists and works.
    await waitFor(() =>
      expect(screen.getByTitle("Edit Mira's mission")).toBeInTheDocument(),
    );
    screen.getByTitle("Edit Mira's mission").click();
    expect(onOpenMission).toHaveBeenCalled();
  });

  it("renders no halt button (the masthead owns halt)", () => {
    render(<MiraHeader halted={false} subtitle="sub" line={null} />);
    expect(screen.queryByText(/halt/i)).toBeNull();
  });

  it("renders the greeting line when present", () => {
    render(<MiraHeader halted={false} subtitle="sub" line="You've got 3 drafts" />);
    expect(screen.getByText("You've got 3 drafts")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- mira-header`
Expected: FAIL (module not found).

- [ ] **Step 2: Create the CSS module**

```css
/* apps/dashboard/src/components/cockpit/mira/mira-header.module.css
   Mira surface header: printed-portrait identity on the warm canvas.
   Fraunces name in the deep identity ink (canon: inbox .ds-head-name,
   team-band .mateName); mono status line; Geist greeting prose.
   No halt control here: the masthead HaltButtonClient is the one halt
   affordance per screen. */
.header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 24px 16px 18px;
}
.text {
  min-width: 0;
  flex: 1;
}
.name {
  display: block;
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 24;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.1;
  color: hsl(var(--agent-mira-deep));
}
.subtitle {
  margin-top: 4px;
  font-family: var(--font-mono-editorial);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ink-3);
}
.missionBtn {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: left;
}
.missionBtn:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.editGlyph {
  font-size: 10px;
  color: var(--ink-4);
}
.line {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-2);
  max-width: 640px;
}
```

- [ ] **Step 3: Create the component**

```tsx
// apps/dashboard/src/components/cockpit/mira/mira-header.tsx
"use client";

import { useEffect, useState } from "react";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import type { AgentActivity } from "@/components/agent-avatar/agent-status-visual";
import styles from "./mira-header.module.css";

export interface MiraHeaderProps {
  /** Live activity for the avatar (pip + draft animation). Honest default: idle. */
  status?: AgentActivity;
  halted: boolean;
  /** Mono status line under the name (mission subtitle or the feed count line). */
  subtitle: string;
  /** Greeting prose (from useAgentGreeting). */
  line: string | null;
  /** With missionInteractive, turns the subtitle into the mission-popover trigger. */
  onOpenMission?: () => void;
  missionInteractive?: boolean;
}

/**
 * Mira's surface header: the canonical printed-portrait identity (one frame
 * everywhere) replacing the legacy cockpit Identity letter-monogram. The
 * mission trigger renders only after hydration: mission data arrives via React
 * Query and can be present at first client render but never in server HTML,
 * which previously caused a live hydration mismatch on /mira and /mira/review.
 */
export function MiraHeader({
  status = "idle",
  halted,
  subtitle,
  line,
  onOpenMission,
  missionInteractive = false,
}: MiraHeaderProps) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const interactive = hydrated && missionInteractive && !!onOpenMission;

  return (
    <div className={styles.header}>
      <PrintedPortraitAvatar agentKey="mira" size={44} status={status} halted={halted} />
      <div className={styles.text}>
        <span className={styles.name}>Mira</span>
        <div className={styles.subtitle}>
          {interactive ? (
            <button
              type="button"
              onClick={onOpenMission}
              title="Edit Mira's mission"
              className={styles.missionBtn}
            >
              <span>{subtitle}</span>
              <span className={styles.editGlyph} aria-hidden="true">
                ✎
              </span>
            </button>
          ) : (
            subtitle
          )}
        </div>
        {line ? <p className={styles.line}>{line}</p> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @switchboard/dashboard test -- mira-header`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-header.tsx apps/dashboard/src/components/cockpit/mira/mira-header.module.css "apps/dashboard/src/components/cockpit/mira/__tests__/mira-header.test.tsx"
git commit -m "feat(dashboard): mira printed-portrait surface header"
```

### Task B3: Desk adopts `MiraHeader` + stops repainting over the grain

**Files:** `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx` (+ its test)

- [ ] **Step 1: Replace the file body**

```tsx
"use client";

import { useState } from "react";
import { MiraHeader } from "@/components/cockpit/mira/mira-header";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraDesk } from "@/hooks/use-mira-desk";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { QueryStates, ConnectionTrouble } from "@/components/query-states";
import { MiraReadyToReview } from "./mira-ready-to-review";
import { MiraInProductionTray } from "./mira-in-production-tray";
import { MiraBriefBox } from "./mira-brief-box";
import { MiraKeptShelf } from "./mira-kept-shelf";
import { MiraDeskSkeleton } from "./mira-desk-skeleton";

// Phase-2 Director's Desk. Module order (Decision 3): brief box · the one hero
// Ready-to-review CTA · calm In-production tray · Kept-drafts shelf. The page
// paints NO background of its own: the body's warm canvas + riso grain ground
// shows through (the old hsl(var(--canvas)) repaint hid the grain).
export function MiraDeskPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const deskQ = useMiraDesk();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;

  // Honest working signal: renders in flight = Mira is drafting (the sprite's
  // viewfinder state). No /api/agents/state row exists for mira, so the desk
  // read-model is the live source.
  const working = (deskQ.data?.inProduction.length ?? 0) > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ position: "relative" }}>
        <MiraHeader
          status={working ? "working" : "idle"}
          halted={haltCtx.halted}
          subtitle={MIRA_MISSION_SUBTITLE}
          line={line}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
        />
        {mission.data ? (
          <MissionPopover
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            mission={mission.data.mission}
            agentLabel="Mira"
          />
        ) : null}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* No empty slot: an empty desk still renders the modules — crucially the
            MiraBriefBox, the operator's only way to request a first draft. The
            trays/hero own their own empty copy. Halt shows in the masthead. */}
        <QueryStates
          query={deskQ}
          loading={<MiraDeskSkeleton />}
          error={<ConnectionTrouble agentName="Mira" onRetry={deskQ.refetch} />}
        >
          {(desk) => (
            <>
              <MiraBriefBox />
              <MiraReadyToReview count={desk.readyToReviewCount} />
              <MiraInProductionTray items={desk.inProduction} />
              <MiraKeptShelf items={desk.keptDrafts} />
            </>
          )}
        </QueryStates>
      </div>
    </div>
  );
}
```

Note: `T`, `Identity`, `MIRA_ACCENT` imports are gone; the halt toggle prop is gone (masthead owns halt).

- [ ] **Step 2: Update the desk-page test**

Run: `pnpm --filter @switchboard/dashboard test -- mira-desk-page`
Expected failures: queries that asserted the Identity header (e.g. halt button text, subtitle-button behavior). Update those assertions to: `container.querySelector('[data-agent="mira"]')` is non-null (the sprite), the subtitle text still renders, and there is NO `/halt/i` text. Do not weaken module-content assertions.

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira`
Expected: PASS

```bash
git add -A apps/dashboard/src
git commit -m "feat(dashboard): desk wears the printed-portrait header on the grain canvas"
```

### Task B4: Feed adopts `MiraHeader`

**Files:** `apps/dashboard/src/components/cockpit/mira/mira-feed-page.tsx` (+ its test)

- [ ] **Step 1: Replace the header block**

Full new file body:

```tsx
"use client";

import { useState } from "react";
import { MiraHeader } from "@/components/cockpit/mira/mira-header";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";
import { MiraCreativeFeed } from "./mira-creative-feed";

export function MiraFeedPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const feedQ = useMiraFeed();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;
  const meta = feedQ.data?.feed;
  const countLine = meta
    ? `${meta.reviewableCount} draft${meta.reviewableCount === 1 ? "" : "s"} to review${meta.renderingCount > 0 ? ` · ${meta.renderingCount} still rendering` : ""}`
    : null;
  const working = (meta?.renderingCount ?? 0) > 0;

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      {/* Light chrome band above the immersive feed body: the header stays on
          the warm canvas; only the clip viewport below is the night register. */}
      <div style={{ position: "relative", background: T.bg }}>
        <MiraHeader
          status={working ? "working" : "idle"}
          halted={haltCtx.halted}
          subtitle={countLine ?? MIRA_MISSION_SUBTITLE}
          line={line}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
        />
        {mission.data ? (
          <MissionPopover
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            mission={mission.data.mission}
            agentLabel="Mira"
          />
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MiraCreativeFeed />
      </div>
    </div>
  );
}
```

(`background: "#000"` survives until PR-D tokenizes the night register.)

- [ ] **Step 2: Update `mira-feed-page` tests (same class of changes as B3), run, commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-feed`
Expected: PASS after assertion updates.

```bash
git add -A apps/dashboard/src
git commit -m "feat(dashboard): feed header wears the printed portrait"
```

### Task B5: Desk card anatomy + serif module headers

**Files:**
- Create: `apps/dashboard/src/components/cockpit/mira/mira-desk.module.css`
- Modify: `mira-ready-to-review.tsx`, `mira-in-production-tray.tsx`, `mira-kept-shelf.tsx`, `mira-brief-box.tsx`

- [ ] **Step 1: Create the module CSS**

```css
/* apps/dashboard/src/components/cockpit/mira/mira-desk.module.css
   Desk module anatomy: the canonical resting card (Home .card family) on the
   warm canvas: surface ground, soft hairline, radius 18 (spec §4 r-lg), ladder
   shadow. Module titles speak the serif moduleH voice (Home home.module.css
   .moduleH); the hero keeps a mono eyebrow + big mono numeral (KPI block). */
.card {
  background: hsl(var(--surface));
  border: 1px solid var(--hair-soft);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  padding: 18px;
}
.shelfCard {
  composes: card;
  background: transparent;
  box-shadow: none;
}
.moduleH {
  margin: 0 0 10px;
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 24;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.018em;
  line-height: 1.1;
  color: var(--ink);
  text-transform: lowercase;
}
.moduleHSentence {
  composes: moduleH;
  text-transform: none;
}
.eyebrow {
  font-family: var(--font-mono-editorial);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}
```

- [ ] **Step 2: Ready-to-review adopts card + eyebrow classes**

In `mira-ready-to-review.tsx`: add `import styles from "./mira-desk.module.css";`. The `<section>` drops its inline box styles for the class:

```tsx
    <section aria-label={DESK_COPY.readyTitle} className={styles.card}>
```

The eyebrow span keeps only its non-class inline bits gone; replace the whole eyebrow span opening with:

```tsx
          <span className={styles.eyebrow}>{DESK_COPY.readyTitle}</span>
```

The amber Link gains the gloss (one new property): `boxShadow: "var(--shadow-action-gloss)",` inside its style object, and its `borderRadius: 8` becomes `borderRadius: 999` (pill, matching `.ds-action-primary` and Home `.btnPrimary`).

- [ ] **Step 3: Tray + shelf adopt card + serif headers**

`mira-in-production-tray.tsx`: import styles; `<section ... className={styles.card}>` (drop inline box styles); the `<h2>` becomes:

```tsx
      <h2 className={styles.moduleH}>{DESK_COPY.inProductionTitle}</h2>
```

`mira-kept-shelf.tsx`: import styles; section → `className={styles.shelfCard}` (drop inline box styles); `<h2 className={styles.moduleH}>{DESK_COPY.keptTitle}</h2>` (drop the inline h2 styles, keep the `keptSub` paragraph as-is).

- [ ] **Step 4: Brief box adopts card + sentence-case serif heading**

`mira-brief-box.tsx`: import styles; section → `className={styles.card}` (drop inline box styles); the `<h2>` becomes:

```tsx
      <h2 className={styles.moduleHSentence}>{BRIEF_HEADING_EMPTY}</h2>
```

Also: `btn` const `borderRadius: 4` → `borderRadius: 999` (pill); textarea `borderRadius: 8` → `borderRadius: 10`.

- [ ] **Step 5: Run mira suites; update any test asserting the old inline styles or h2 weight; commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira`
Expected: PASS

```bash
git add -A apps/dashboard/src/components/cockpit/mira
git commit -m "feat(dashboard): desk modules adopt canonical card anatomy and serif headers"
```

### Task B6: Violet returns to identity-only (LOCKED decision 2: Keep = amber)

**Files:** `mira-clip-actions.tsx`, `mira-brief-box.tsx`, `mira-in-production-tray.tsx`

- [ ] **Step 1: Write the failing test (extend `__tests__/mira-clip-actions.test.tsx`)**

```tsx
it("keep commits in amber, never the identity violet", () => {
  render(
    <MiraClipActions
      jobId="job1"
      reviewAction={{ label: "review_draft", canContinue: false, canStop: false }}
      onResolve={() => {}}
    />,
  );
  const keep = screen.getByRole("button", { name: "Keep" });
  // assert on the attribute: jsdom's CSSStyleDeclaration normalization of
  // hsl(var()) values is version-dependent, the raw attribute is stable
  expect(keep.getAttribute("style")).toContain("hsl(var(--action))");
  expect(keep.getAttribute("style")).not.toContain("--agent-mira");
});
```

(Match the file's existing render/mock harness; only the assertion is new. If `reviewAction` is built by a fixture helper in that file, reuse it.)

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-actions`
Expected: FAIL (background is the violet `MIRA_ACCENT.deep`).

- [ ] **Step 2: Implement**

`mira-clip-actions.tsx` Keep button:

```tsx
        <button
          style={{ ...btn, background: T.amber, color: T.actionFg, border: `1px solid ${T.amberDeep}` }}
          disabled={decide.isPending}
          onClick={() => decideAndResolve("kept")}
        >
          Keep
        </button>
```

Remove the now-unused `MIRA_ACCENT` import if nothing else in the file uses it.

`mira-brief-box.tsx` chip: selection reads as ink, not violet:

```tsx
  const chip = (active: boolean) => ({
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${active ? T.ink : T.hair}`,
    background: active ? T.ink : "transparent",
    color: active ? T.paper : T.ink2,
  });
```

(`MIRA_ACCENT.paper` stays for the preview/offscope washes: tint grounds are sanctioned identity use. Remove `MIRA_ACCENT` from imports only if fully unused.)

`mira-in-production-tray.tsx` status span: violet text fails the identity-only rule (and AA as small text):

```tsx
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  color: it.problem ? T.red : T.ink2,
                }}
              >
```

Remove the `MIRA_ACCENT` import from the tray (now unused).

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira`
Expected: PASS

```bash
git add -A apps/dashboard/src/components/cockpit/mira
git commit -m "feat(dashboard): keep commits in amber; violet returns to identity-only"
```

### Task B7: Panel minimal-parity (LOCKED decision 4)

Avatar swap in BOTH branches + a live drafts-ready line + the CTA stops being a violet action (the canon's one identity-on-action contradiction, audit E4).

**Files:**
- Modify: `apps/dashboard/src/components/agent-panel/mira-panel.tsx`
- Modify: `apps/dashboard/src/components/agent-panel/agent-panel.module.css`
- Modify: `apps/dashboard/src/hooks/use-mira-desk.ts`
- Tests: `agent-panel/__tests__/mira-panel.test.tsx`, `hooks/__tests__/use-mira-desk.test.tsx`

- [ ] **Step 1: `useMiraDesk` gains an `enabled` gate (failing test first)**

Append to `hooks/__tests__/use-mira-desk.test.tsx` (reuse its existing QueryClient wrapper + fetch mock):

```tsx
it("does not fetch when disabled (panel for a non-enabled org)", async () => {
  const fetchSpy = vi.spyOn(global, "fetch");
  renderHook(() => useMiraDesk(false), { wrapper });
  await new Promise((r) => setTimeout(r, 10));
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

Run: `pnpm --filter @switchboard/dashboard test -- use-mira-desk` → FAIL (signature takes no arg; fetch fires).

Implement in `use-mira-desk.ts`:

```ts
/** Live Mira Director's Desk read-model. Pass enabled=false on surfaces that
 *  render for orgs without Mira (the desk route 404s there). */
export function useMiraDesk(enabled = true) {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.desk() ?? ["__disabled_mira_desk__"],
    queryFn: async (): Promise<MiraDeskModel> => {
      const res = await fetch("/api/dashboard/agents/mira/desk");
      if (!res.ok) throw new Error(`Mira desk fetch failed (HTTP ${res.status})`);
      return ((await res.json()) as { desk: MiraDeskModel }).desk;
    },
    enabled: !!keys && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  ...
```

(rest of the hook unchanged). Run → PASS.

- [ ] **Step 2: Panel test (failing first)**

In `mira-panel.test.tsx`, update/extend (match its existing mocks for `useMiraEnabled`; add a `useMiraDesk` mock):

```tsx
vi.mock("@/hooks/use-mira-desk", () => ({
  useMiraDesk: vi.fn().mockReturnValue({ data: { readyToReviewCount: 3 } }),
}));

it("renders the printed portrait, not a letter disc, in both branches", () => {
  // enabled branch
  const { container } = render(<MiraPanel />);
  expect(container.querySelector('[data-agent="mira"]')).not.toBeNull();
  expect(screen.queryByText("M")).toBeNull();
});

it("shows the live drafts-ready count when enabled", () => {
  render(<MiraPanel />);
  expect(screen.getByText("3 drafts ready to review")).toBeInTheDocument();
});
```

Run → FAIL.

- [ ] **Step 3: Implement the panel**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import { useMiraDesk } from "@/hooks/use-mira-desk";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
import styles from "./agent-panel.module.css";

/**
 * Enablement-aware Mira drill-in (minimal parity: portrait + live ready count +
 * route out; full 4-slot parity lands with the M1 enablement backlog). The
 * letter-disc monogram is retired: PrintedPortraitAvatar is the one frame.
 */
export function MiraPanel() {
  const router = useRouter();
  const { enabled } = useMiraEnabled();
  // Desk read-model only when enabled (the API 404s otherwise).
  const deskQ = useMiraDesk(enabled);

  if (enabled) {
    const ready = deskQ.data?.readyToReviewCount;
    return (
      <div className={styles.notset}>
        <PrintedPortraitAvatar agentKey="mira" size={84} hero />
        <h3 className={styles.notsetHeading}>Mira is set up</h3>
        <p className={styles.notsetSub}>
          Review her latest creative drafts and decide what moves forward.
        </p>
        {typeof ready === "number" ? (
          <span className={styles.notsetMeta}>
            {ready === 0
              ? "No drafts waiting"
              : `${ready} draft${ready === 1 ? "" : "s"} ready to review`}
          </span>
        ) : null}
        <button type="button" className={styles.miraOpenCta} onClick={() => router.push("/mira")}>
          Open Mira&apos;s workspace →
        </button>
      </div>
    );
  }

  return (
    <div className={styles.notset}>
      <PrintedPortraitAvatar agentKey="mira" size={84} hero showPip={false} />
      <h3 className={styles.notsetHeading}>Mira isn&apos;t set up yet</h3>
      <p className={styles.notsetSub}>
        Mira handles creative and content. She becomes available as your workspace grows.
      </p>
      <span className={styles.notsetMeta}>Coming soon</span>
    </div>
  );
}
```

- [ ] **Step 4: CSS: delete the monogram, neutralize the CTA**

In `agent-panel.module.css`: DELETE the `.notsetMark` and `.notsetMark::after` rules entirely (lines ~201-223). Replace `.miraOpenCta`'s violet fill with the secondary-button anatomy (Home `.btnSecondary`):

```css
.miraOpenCta {
  align-self: center;
  margin-top: 4px;
  padding: 8px 18px;
  border-radius: var(--radius-pill);
  background: var(--canvas-2);
  color: var(--ink);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.003em;
  font-family: var(--font-home-sans);
  border: 1px solid var(--hair);
  cursor: pointer;
  transition: background 160ms ease;
}

.miraOpenCta:hover {
  background: hsl(var(--surface));
}
```

- [ ] **Step 5: Run panel suites + the token guard (the guard asserts agent-hue discipline; deleting the violet CTA must not break any existing expectation), commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-panel agent-panel token-governance`
Expected: PASS

```bash
git add -A apps/dashboard/src
git commit -m "feat(dashboard): mira panel wears the portrait with a live ready count"
```

### Task B8: Mobile nav parity (LOCKED decision 3)

**Files:** `apps/dashboard/src/components/layout/primary-nav.tsx` (+ test `layout/__tests__/primary-nav.test.tsx`, create if absent)

- [ ] **Step 1: Failing test**

```tsx
// apps/dashboard/src/components/layout/__tests__/primary-nav.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrimaryNav } from "../primary-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const mockEnabled = vi.fn().mockReturnValue({ enabled: true });
vi.mock("@/hooks/use-mira-enabled", () => ({ useMiraEnabled: () => mockEnabled() }));

describe("PrimaryNav", () => {
  it("includes Mira when the org has her enabled", () => {
    mockEnabled.mockReturnValue({ enabled: true });
    render(<PrimaryNav />);
    expect(screen.getByRole("link", { name: "Mira" })).toHaveAttribute("href", "/mira");
  });
  it("omits Mira when not enabled", () => {
    mockEnabled.mockReturnValue({ enabled: false });
    render(<PrimaryNav />);
    expect(screen.queryByRole("link", { name: "Mira" })).toBeNull();
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- primary-nav` → FAIL.

- [ ] **Step 2: Implement**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";

const ITEMS = [
  { label: "Home", href: "/" },
  { label: "Inbox", href: "/inbox" },
  { label: "Results", href: "/results" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function PrimaryNav() {
  const pathname = usePathname() ?? "/";
  // On narrow viewports this nav is the only primary entry (the sidebar is
  // hidden at < lg), so Mira joins it when enabled: she is the one agent with
  // a route (IA decision, 2026-06-05 coherence audit).
  const { enabled: miraEnabled } = useMiraEnabled();
  const items: ReadonlyArray<{ label: string; href: string }> = miraEnabled
    ? [...ITEMS, { label: "Mira", href: "/mira" }]
    : ITEMS;
  return (
    <nav className="primary-nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className="primary-nav__item"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @switchboard/dashboard test -- primary-nav`
Expected: PASS

```bash
git add -A apps/dashboard/src/components/layout
git commit -m "feat(dashboard): mira joins the mobile primary nav when enabled"
```

### Task B9: Detail page: display headline, byline, halt gate

**Files:** `apps/dashboard/src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`

- [ ] **Step 1: Imports**

```tsx
import { useHalt } from "@/components/layout/halt/halt-context";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";
```

and inside the component: `const { halted } = useHalt();`

- [ ] **Step 2: Byline + Fraunces headline (replace the bare `<h1>` block)**

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PrintedPortraitAvatar agentKey="mira" size={22} showPip={false} />
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: T.ink3,
          }}
        >
          Drafted by Mira
        </span>
      </div>

      <h1
        style={{
          margin: 0,
          fontFamily: T.display,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          color: T.ink,
        }}
      >
        {job.title}
      </h1>
```

- [ ] **Step 3: Halt gate on Continue (both the entry button and the confirm)**

The `canContinue` entry button branch becomes:

```tsx
              {canContinue &&
                (halted ? (
                  <button
                    disabled
                    title="Resume Mira to continue drafts."
                    style={{
                      padding: "10px 16px",
                      borderRadius: 8,
                      background: T.ink5,
                      color: T.ink3,
                      border: "none",
                      cursor: "not-allowed",
                    }}
                  >
                    Halted
                  </button>
                ) : (
                  <button
                    disabled={approve.isPending}
                    onClick={() => setConfirm("continue")}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 8,
                      background: T.amber,
                      color: T.actionFg,
                      border: `1px solid ${T.amberDeep}`,
                    }}
                  >
                    Continue draft
                  </button>
                ))}
```

(Stop stays available under halt: stopping is governance-safe; this mirrors the feed, which disables only Continue.)

- [ ] **Step 4: Run detail/mira suites (update assertions touching the h1 styles), commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira creative-detail`
Expected: PASS

```bash
git add -A "apps/dashboard/src/app/(auth)/mira"
git commit -m "feat(dashboard): detail page gains the display headline, mira byline, and halt gate"
```

### Task B10: PR-B wrap + live visual acceptance

- [ ] **Step 1: Full gates** (same as A10; also `pnpm --filter @switchboard/dashboard exec next build` to catch RSC/module issues)

- [ ] **Step 2: Live visual pass (required for a reskin PR)**

Boot the stack (API from repo root: `node --env-file=.env --import tsx apps/api/src/server.ts`; dashboard: `pnpm --filter @switchboard/dashboard dev`; org_dev has Mira enabled + seeded demo drafts). Screenshot `/mira`, `/mira/review`, `/mira/creatives/dev_mira_demo_polished`, Home panel (click "The maker" tile) at 1280x900 + 390x844 via the playwright-core + system-Chrome recipe (`/tmp/sbshot`). Verify: sprite (not "M") on every surface, Fraunces name + headings, card shadows/radius, amber Keep, no hydration error in the console probe, no duplicate halt. Commit the PNGs under `docs/audits/2026-06-05-mira-coherence-audit/screenshots/pr-b/`.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/mira-reskin-b-crew-skin
gh pr create --title "feat(dashboard): mira joins the crew (printed-portrait identity + warm-newsprint anatomy)" --body "PR-B of the Mira reskin plan. MiraHeader (sprite + Fraunces + hydration-safe mission trigger, masthead-owned halt), desk card anatomy + serif module headers, amber Keep + ink selection chips, panel minimal-parity with live ready count, mobile nav parity, detail byline/headline/halt gate. Screenshots in docs/audits/2026-06-05-mira-coherence-audit/screenshots/pr-b/.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR-C: commit-moment parity (`feat/mira-reskin-c-commit-moment`)

Branch off main AFTER PR-B merges (clip-actions/feed files overlap).

### Task C0: Branch + baseline (worktree `.claude/worktrees/mira-reskin-c`, branch `feat/mira-reskin-c-commit-moment`)

### Task C1: `useReviewDecision` swallows 409 as silent success

**Files:**
- Modify: `apps/dashboard/src/hooks/use-review-decision.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-review-decision.test.tsx` (create; mirror the QueryClient wrapper from `use-mira-desk.test.tsx`)

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReviewDecision } from "../use-review-decision";
// reuse the wrapper/useScopedQueryKeys mock pattern from use-mira-desk.test.tsx

describe("useReviewDecision", () => {
  it("treats 409 (already decided) as silent success, like the inbox commit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 409 })),
    );
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    result.current.mutate({ id: "job1", decision: "kept" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: "job1", decision: "kept", silent: true });
  });

  it("still throws on real failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    result.current.mutate({ id: "job1", decision: "kept" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- use-review-decision` → FAIL.

- [ ] **Step 2: Implement**

```ts
type Decision = "kept" | "passed" | null;
export interface ReviewDecisionResult {
  id: string;
  decision: Decision;
  /** 409 = already decided elsewhere; both clients agree on the outcome. */
  silent?: boolean;
}

/** Mira Keep/Pass (and un-keep) review decision. Invalidates the feed + desk. */
export function useReviewDecision() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string;
      decision: Decision;
    }): Promise<ReviewDecisionResult> => {
      const res = await fetch(
        `/api/dashboard/agents/mira/creatives/${encodeURIComponent(id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      // Canon (use-recommendation-action.ts): 409 = already-terminal; swallow as
      // silent success so the commit moment never error-flashes a settled outcome.
      if (res.status === 409) return { id, decision, silent: true };
      if (!res.ok) throw new Error(`Review decision failed (HTTP ${res.status})`);
      return (await res.json()) as ReviewDecisionResult;
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @switchboard/dashboard test -- use-review-decision mira`
Expected: PASS

```bash
git add -A apps/dashboard/src/hooks
git commit -m "feat(dashboard): review decisions swallow 409 as silent success"
```

### Task C2: Keep/Pass undo toast (Pass becomes recoverable: fixes the friction inversion)

The feed owns the `resolved` set, so the toast + undo live there: undo must both reverse the decision AND un-hide the clip.

**Files:**
- Modify: `mira-clip-actions.tsx` (thread the decision out), `mira-clip-card.tsx` (pass-through), `mira-creative-feed.tsx` (toast + undo)
- Tests: extend `__tests__/mira-clip-actions.test.tsx` and `__tests__/mira-creative-feed.test.tsx`

- [ ] **Step 1: Failing feed test (extend the existing harness; add a use-toast mock)**

```tsx
const toastSpy = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

it("keep raises an undo toast and undo restores the clip", async () => {
  // existing harness: feed rendered with one draft_ready job + mocked useReviewDecision
  // whose mutate calls onSuccess with { silent: false }.
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  await waitFor(() => expect(toastSpy).toHaveBeenCalled());
  const call = toastSpy.mock.calls[0][0];
  expect(call.title).toBe("Kept");
  // simulate pressing Undo: the action element's onClick
  // (render call.action into the container or invoke its props.onClick directly)
});

it("a silent (409) decision dismisses without a toast", async () => {
  // mocked decision resolves { silent: true }
  fireEvent.click(screen.getByRole("button", { name: "Pass" }));
  await waitFor(() => expect(screen.queryAllByTestId("mira-clip")).toHaveLength(0));
  expect(toastSpy).not.toHaveBeenCalled();
});
```

(Adapt to the file's existing mock style for `useReviewDecision`; the contract under test: toast on non-silent, no toast on silent, undo un-hides.)

Run: `pnpm --filter @switchboard/dashboard test -- mira-creative-feed` → FAIL.

- [ ] **Step 2: `mira-clip-actions.tsx`: report the decision outcome upward**

Props gain:

```tsx
  /** Called after Keep/Pass commits; silent = the server said already-decided (409). */
  onDecided: (jobId: string, decision: "kept" | "passed", silent: boolean) => void;
```

and the review branch becomes:

```tsx
  if (reviewAction.label === "review_draft") {
    const decideAndResolve = (decision: "kept" | "passed") =>
      decide.mutate(
        { id: jobId, decision },
        { onSuccess: (data) => onDecided(jobId, decision, data.silent === true) },
      );
```

(the two buttons keep calling `decideAndResolve("kept" | "passed")`).

- [ ] **Step 3: `mira-clip-card.tsx`: accept + thread `onDecided` to `MiraClipActions`** (one new prop, passed straight through alongside `onResolve`).

- [ ] **Step 4: `mira-creative-feed.tsx`: toast + undo**

```tsx
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useReviewDecision } from "@/hooks/use-review-decision";
```

Inside the component:

```tsx
  const { toast } = useToast();
  const decide = useReviewDecision();

  function undoDecision(jobId: string) {
    decide.mutate(
      { id: jobId, decision: null },
      {
        onSuccess: () => {
          setResolved((prev) => {
            const next = new Set(prev);
            next.delete(jobId);
            return next;
          });
        },
      },
    );
  }

  function handleDecided(jobId: string, decision: "kept" | "passed", silent: boolean) {
    const job = jobs.find((j) => j.id === jobId);
    handleResolve(jobId);
    if (silent) return; // already decided elsewhere: no undo to offer
    toast({
      title: decision === "kept" ? "Kept" : "Passed",
      description: job?.title,
      action: (
        <ToastAction altText="Undo" onClick={() => undoDecision(jobId)}>
          Undo
        </ToastAction>
      ),
    });
  }
```

and pass `onDecided={handleDecided}` down through `MiraClipCard`.

- [ ] **Step 5: Run all mira suites + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira`
Expected: PASS (clip-actions tests need the new required `onDecided` prop in their renders: add `onDecided={() => {}}`).

```bash
git add -A apps/dashboard/src
git commit -m "feat(dashboard): keep/pass commit with a branded undo and silent-409"
```

### Task C3: PR-C wrap

- [ ] Full gates (as A10) + push + PR:

```bash
gh pr create --title "feat(dashboard): mira keep/pass adopts the commit-moment pattern" --body "PR-C of the Mira reskin plan. Undo toast + silent-409 reconciliation for Keep/Pass; Pass is now recoverable (fixes the friction-proportionality inversion: it was the most irreversible gesture at zero friction).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR-D: the night register (`feat/mira-reskin-d-night-feed`)

LOCKED decision 1: the feed keeps its immersive full-bleed body, re-skinned from raw `#000` to a sanctioned warm-charcoal token set. Chrome stays light. Guard goes red first, migration turns it green.

### Task D0: Branch + baseline (worktree `.claude/worktrees/mira-reskin-d`, branch `feat/mira-reskin-d-night-feed`)

### Task D1: Night tokens in globals.css (+ definition gate)

**Files:** `apps/dashboard/src/app/globals.css`, `app/__tests__/token-governance.test.ts`

- [ ] **Step 1: Failing definition test (append near the risk-tint block from PR-A)**

```ts
describe("night register tokens (mira review feed)", () => {
  it("defines warm-charcoal primitives (never pure black) under night semantics", () => {
    expect(tokenValue("palette-night-canvas")).toBe("45 22% 7%");
    expect(tokenValue("palette-night-surface")).toBe("45 14% 12%");
    expect(tokenValue("palette-night-ink")).toBe("40 30% 94%");
    expect(tokenValue("palette-night-ink-2")).toBe("42 12% 74%");
    expect(tokenValue("palette-night-ink-3")).toBe("43 9% 60%");
    expect(tokenValue("palette-night-scrim")).toBe("45 22% 4%");
    expect(tokenValue("palette-night-risk")).toBe("0 42% 34%");
    for (const name of ["canvas", "surface", "ink", "ink-2", "ink-3", "scrim", "risk"]) {
      expect(tokenValue(`night-${name}`)).toBe(`var(--palette-night-${name})`);
    }
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- token-governance` → FAIL.

- [ ] **Step 2: Add to globals.css**

Primitives (directly under the `--palette-risk-tint` line added in PR-A):

```css
    /* Night register (the ONE sanctioned dark surface: Mira's review feed body).
       Warm charcoal derived from the spec's dark variant (#16140E family),
       never pure black. Chrome around the feed stays on the light canvas. */
    --palette-night-canvas: 45 22% 7%;
    --palette-night-surface: 45 14% 12%;
    --palette-night-ink: 40 30% 94%;
    --palette-night-ink-2: 42 12% 74%;
    --palette-night-ink-3: 43 9% 60%;
    --palette-night-scrim: 45 22% 4%;
    --palette-night-risk: 0 42% 34%;
```

Semantics (next to `--risk-tint`):

```css
    /* Night register semantics: consumed hsl(var(--night-*)) on feed surfaces only. */
    --night-canvas: var(--palette-night-canvas);
    --night-surface: var(--palette-night-surface);
    --night-ink: var(--palette-night-ink);
    --night-ink-2: var(--palette-night-ink-2);
    --night-ink-3: var(--palette-night-ink-3);
    --night-scrim: var(--palette-night-scrim);
    --night-risk: var(--palette-night-risk);
```

- [ ] **Step 3: Run (PASS) + commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "feat(dashboard): sanctioned warm-charcoal night register tokens"
```

### Task D2: Night guard (red first)

**Files:** `app/__tests__/token-governance.test.ts`

- [ ] **Step 1: Append the scoped literal ban**

```ts
describe("night register: mira surfaces carry no raw neutral literals", () => {
  it("mira feed/detail consume tokens, never #000/#fff/raw rgba", () => {
    const SCOPES = ["components/cockpit/mira/", "app/(auth)/mira/"];
    const offenders: string[] = [];
    for (const f of collectGovernedFiles()) {
      if (!SCOPES.some((s) => f.path.includes(s))) continue;
      const re = /#(?:000|fff)\b|rgba?\(\s*\d/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const line = f.content.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(f.path)}:${line}: ${m[0]}`);
      }
    }
    expect(offenders, "use hsl(var(--night-*)) / T.* tokens on Mira surfaces").toEqual([]);
  });
});
```

- [ ] **Step 2: Run to enumerate the full literal inventory (this is the migration checklist)**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance`
Expected: FAIL listing every remaining literal in `mira-feed-page.tsx`, `mira-clip-card.tsx`, `mira-clip-actions.tsx`, `mira-creative-feed.tsx`, `review/page.tsx`. Commit the red guard only together with D3 (one atomic commit), or commit now with `it.fails` and flip in D3; prefer the atomic option.

### Task D3: Migrate the feed onto night tokens (guard goes green)

**Files:** `mira-feed-page.tsx`, `mira-clip-card.tsx`, `mira-clip-actions.tsx`, `mira-creative-feed.tsx`, `app/(auth)/mira/review/page.tsx`, `hooks/use-mira-feed.ts`

- [ ] **Step 1: `use-mira-feed.ts` exposes refetch (needed for the shared error state)**

Add to the returned object: `refetch: query.refetch,` (mirror `use-mira-desk.ts`).

- [ ] **Step 2: `mira-feed-page.tsx`**

Wrapper: `background: "#000"` → `background: "hsl(var(--night-canvas))"`.

- [ ] **Step 3: `review/page.tsx` back pill**

```tsx
          background: "hsl(var(--night-scrim) / 0.7)",
          color: "hsl(var(--night-ink))",
```

- [ ] **Step 4: `mira-clip-card.tsx`**

- section `background: "#000"` → `background: "hsl(var(--night-canvas))"`
- missing-clip div `color: "#bbb"` → `color: "hsl(var(--night-ink-2))"`
- status chip `background: "rgba(0,0,0,0.55)"` → `background: "hsl(var(--night-scrim) / 0.7)"`, `color: "#fff"` → `color: "hsl(var(--night-ink))"`
- caption button `color: "#fff"` → `color: "hsl(var(--night-ink))"`

- [ ] **Step 5: `mira-clip-actions.tsx`**

- `btn` const: `color: "#fff"` → `color: "hsl(var(--night-ink))"` (amber buttons override with `T.actionFg` already)
- continue-confirm box `background: "rgba(14,12,10,0.92)"` → `background: "hsl(var(--night-scrim) / 0.92)"`; its copy spans `color: "#fff"` → `color: "hsl(var(--night-ink))"`
- cancel buttons `border: "1px solid #fff"` → `border: "1px solid hsl(var(--night-ink) / 0.45)"`
- stop-confirm box `background: "rgba(122,46,46,0.95)"` → `background: "hsl(var(--night-risk) / 0.95)"`; its copy `color: "#fff"` → `color: "hsl(var(--night-ink))"`; the white stop button `background: "#fff", color: T.red` → `background: "hsl(var(--night-ink))", color: "hsl(var(--night-risk))"`
- Pass button `background: "rgba(0,0,0,0.55)"` → `background: "hsl(var(--night-surface))"`; Stop-draft button same substitution
- halted button `background: "#555"` → `background: "hsl(var(--night-surface))", color: "hsl(var(--night-ink-3))"`
- error spans `color: "#fff"` → `color: "hsl(var(--night-ink))"`; pending-approval span likewise

- [ ] **Step 6: `mira-creative-feed.tsx`: night states + the shared error component**

```tsx
import { ConnectionTrouble } from "@/components/query-states";
import { T } from "@/components/cockpit/tokens";
```

(destructure `refetch` from `useMiraFeed()`), then:

```tsx
  if (isLoading) {
    return (
      <div
        data-testid="mira-feed-skeleton"
        style={{ height: "100%", background: "hsl(var(--night-canvas))" }}
      />
    );
  }
  if (isError) {
    // The shared failure vocabulary (role=alert, offline-aware) on a light card
    // floating over the night ground: same component, honest on both registers.
    return (
      <div
        style={{
          height: "100%",
          background: "hsl(var(--night-canvas))",
          display: "grid",
          placeItems: "center",
          padding: 28,
        }}
      >
        <div
          style={{
            background: T.paper,
            borderRadius: 18,
            boxShadow: "var(--shadow-3)",
            padding: 8,
            maxWidth: 420,
            width: "100%",
          }}
        >
          <ConnectionTrouble agentName="Mira" onRetry={refetch} />
        </div>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          background: "hsl(var(--night-canvas))",
          display: "grid",
          placeItems: "center",
          padding: 28,
        }}
      >
        <p
          style={{
            margin: 0,
            color: "hsl(var(--night-ink-2))",
            fontSize: 14,
            textAlign: "center",
            maxWidth: 360,
          }}
        >
          No drafts to review yet. Mira&apos;s drafts will appear here as she drafts them.
        </p>
      </div>
    );
  }
```

- [ ] **Step 7: Guard green + suites, one atomic commit with D2's guard**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance mira`
Expected: PASS (update any test asserting the old literal styles).

```bash
git add -A apps/dashboard/src
git commit -m "feat(dashboard): mira feed rides the night register tokens with a literal guard"
```

### Task D4: Reduced-motion autoplay gate

**Files:** `mira-clip-card.tsx` (+ its test)

- [ ] **Step 1: Failing test (extend `__tests__/mira-clip-card.test.tsx`; mock matchMedia matches=true)**

```tsx
it("does not autoplay under prefers-reduced-motion", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  const play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.play = play;
  render(<MiraClipCard job={jobFixture} isActive onResolve={() => {}} onDecided={() => {}} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(play).not.toHaveBeenCalled();
});
```

Run → FAIL (play fires).

- [ ] **Step 2: Implement**

```tsx
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
```

```tsx
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // Reduced motion: hold the poster frame; the existing tap-to-play toggle on
    // the video element remains the explicit opt-in.
    if (isActive && !reducedMotion) void el.play().catch(() => {});
    else el.pause();
    return () => {
      el.pause();
    };
  }, [isActive, reducedMotion]);
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-card`
Expected: PASS

```bash
git add -A apps/dashboard/src/components/cockpit/mira
git commit -m "feat(dashboard): feed autoplay respects reduced motion"
```

### Task D5: PR-D wrap + live AA verification

- [ ] **Step 1: Full gates** (as A10 + `next build`).

- [ ] **Step 2: Live visual + contrast pass (the token gate does not pixel-sample; do it live)**

Boot the stack, screenshot `/mira/review` desktop + mobile. With the playwright probe, sample rendered contrast: night-ink text vs night-canvas (expect >= 7:1), night-ink-2 vs night-canvas (>= 4.5), night-ink-3 labels vs night-canvas (>= 4.5), `T.actionFg` on amber (>= 4.5), stop-confirm copy vs night-risk wash (>= 4.5). If any pair misses, adjust the primitive's lightness in globals.css (test values too) and re-verify. Commit screenshots under `docs/audits/2026-06-05-mira-coherence-audit/screenshots/pr-d/`.

- [ ] **Step 3: Push + PR**

```bash
gh pr create --title "feat(dashboard): mira review feed rides a sanctioned night register" --body "PR-D of the Mira reskin plan (LOCKED decision 1). Warm-charcoal night tokens (never pure black) replace every raw #000/#fff/rgba literal across the feed, with a scoped CI guard, the shared ConnectionTrouble error on a floating light card, and a reduced-motion autoplay gate. Live contrast-sampled AA evidence + screenshots attached.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Out of scope (recorded, do not build here)

- Full 4-slot panel parity (`Exclude<PanelAgentKey,"mira">` fence lift): with the M1 enablement backlog (LOCKED decision 4).
- Deleting the legacy cockpit `Identity`/`SpriteFrame` after Mira stops using them: any on-disk importer breaks the build (orphan-import gotcha); audit consumers first in a dedicated cleanup.
- The blue operator-chat widget + DEV badge overlaps: pre-existing shell issues (Wave-0 #825 territory), not Mira files.
- Inbox white-literal cleanups (audit E1/E2): canon-side, separate quick-win PR.
- Hero "Review drafts" halt treatment: deliberately NOT gated (reviewing is read+verdict and stays available under halt; only cost-bearing Continue is gated, on feed and detail).

## Self-review checklist (done at plan time)

- Spec coverage: all four locked decisions have tasks (D1-D3 / B6 / B8 / B7); every verified critical+high audit finding maps to a task (A1->A2-A5 type+tokens, C1-C4->B2-B4+B7, D1-D2->C1-C2, A1/D5->D1-D3, B6->A5, hydration->B2, greeting count->A5, CSP->A8, skeleton->A9, halt-detail->B9, reduced-motion->D4, corpus->A6).
- Type consistency: `T.mono`/`T.display`/`T.actionFg` defined in A1, consumed in A2/A3/B5/B6/B9/D3; `onDecided(jobId, decision, silent)` defined in C2 and used in clip-card/feed; `useMiraDesk(enabled)` defined in B7 step 1, consumed in B7 step 3; `usePrefersReducedMotion` created in B1, consumed in D4; night token names in D1 match every consumer string in D3.
- No placeholders: every code step shows the actual code; test-update steps name the exact assertion to change and the contract not to weaken.
