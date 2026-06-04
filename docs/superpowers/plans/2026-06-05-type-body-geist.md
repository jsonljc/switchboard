# TY4 Body Face (Geist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geist becomes the authed app register's body face, scoped so zero pixels change outside the register, with Hanken retired and the locked card/button metric voice landed.

**Architecture:** One next/font variable loader (`--font-geist`), one canonical token (`--font-body-app`), one UNLAYERED register rule on `body:has(.app-header):not(:has([data-register="mercury"]))` (body-level so portals inherit), one route-group marker layout for Mercury. Hanken retires by repointing `--font-home-sans`. Metric voice lands on enumerated classes only. Spec: `docs/superpowers/specs/2026-06-05-type-body-geist-design.md`.

**Tech Stack:** Next 16 app router, next/font/google, vitest (jsdom, css:false: structural contracts only), playwright-core + system Chrome for all live proofs.

**Standing rules:** no em-dashes anywhere; no italics; commit subjects lowercase, header under 100 chars, body for detail; every commit ends with the Co-Authored-By line; `git checkout -- apps/dashboard/next-env.d.ts` before every commit while a dev server runs; never full `pnpm build` while next dev is up.

---

### Task 0: Branch and environment

**Files:** none (environment)

- [ ] **Step 0.1: Verify ports 3000/3001/3002 are free BEFORE worktree:init** (the script kills dev-port listeners; a parallel session may own them)

Run: `lsof -ti :3000 -ti :3001 -ti :3002 || echo "ports free"`
Expected: `ports free`. If PIDs print, STOP: check `ps -p <pid> -o command=` and do not kill another session's servers; wait or coordinate.

- [ ] **Step 0.2: Cut the impl branch off fresh main and init** (the worktree sits on the docs branch after the docs PR; the impl branch must base off main, no stacking)

```bash
git fetch origin
git checkout -b feat/ty4-body-geist origin/main
pnpm worktree:init
```

Note: init reports "DB not reachable" even when Postgres is up. Verify yourself:
`psql "postgresql://switchboard:switchboard@localhost:5432/switchboard" -c "select 1"`

- [ ] **Step 0.3: Fix the known env corruption** in `apps/dashboard/.env.local`: the sync concatenates two `DATABASE_URL`s onto one line (replace with the single value from `apps/dashboard/.env.local.example`) and comments out `DEV_BYPASS_AUTH=true` (uncomment it).

- [ ] **Step 0.4: Install and build**

```bash
pnpm install          # init skips deps
pnpm db:generate      # next build fails on PrismaClient without it
pnpm build            # FULL build before any typecheck (no dev server running yet)
```

- [ ] **Step 0.5: Baseline green**

Run: `pnpm --filter @switchboard/dashboard test 2>&1 | tail -5`
Expected: full dashboard suite passes (record the count). If main is red, STOP and re-check against `pnpm reset` + full build before blaming the slice.

### Task 1: Red guards first (TY4 drift guards + token test flips + marker test)

**Files:**
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (append after the TY3 describe block)
- Modify: `apps/dashboard/src/app/__tests__/tokens.test.ts:73-83`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/__tests__/mercury-layout.test.tsx`

- [ ] **Step 1.1: Append the TY4 describe block** to token-governance.test.ts (module-scope helpers `css`, `rel`, `collectGovernedFiles`, `typeVoiceGoverned`, `readFileSync`, `path` already exist; mirror the TY3 block):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// TY4: the authed body face (spec 2026-06-05). Geist loaded as a variable font,
// the register rule on body (portal coverage), the mercury exclusion pairing,
// and one body sans (Hanken retired).
// ─────────────────────────────────────────────────────────────────────────────
describe("token governance: type body (TY4)", () => {
  const governed = collectGovernedFiles().filter((f) => typeVoiceGoverned(f.path));

  it("layout.tsx loads Geist as a variable font (no weight array: the 450 cut must be real)", () => {
    const layout = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/Geist\(/);
    const geistBlock = layout.slice(layout.indexOf("Geist("));
    const block = geistBlock.slice(0, geistBlock.indexOf("})"));
    expect(block).toMatch(/variable:\s*"--font-geist"/);
    expect(block).not.toMatch(/weight:/);
  });

  it("the body face chains to the loaded Geist primitive (token honesty)", () => {
    expect(css).toMatch(/--font-body-app:\s*var\(--font-geist\)/);
    expect(css).toMatch(/--font-home-sans:\s*var\(--font-body-app\)/);
  });

  it("the register rule carries the mercury exclusion in the same selector", () => {
    expect(css).toMatch(
      /body:has\(\.app-header\):not\(:has\(\[data-register="mercury"\]\)\)\s*\{[^}]*font-family:\s*var\(--font-body-app\)/,
    );
  });

  it("the mercury marker producer exists (the exclusion is inert without it)", () => {
    const mercuryLayout = readFileSync(
      path.resolve(process.cwd(), "src/app/(auth)/(mercury)/layout.tsx"),
      "utf8",
    );
    expect(mercuryLayout).toMatch(/data-register="mercury"/);
  });

  it("no governed CSS names Geist or Hanken raw (the face rides the token)", () => {
    const offenders: string[] = [];
    for (const f of governed) {
      if (!f.path.endsWith(".css")) continue;
      if (f.path.endsWith("globals.css")) {
        if (/Hanken/.test(f.content)) offenders.push("globals.css: Hanken survives");
        continue; // the token definition site may name the "Geist" fallback head
      }
      if (/"Geist"|Hanken/.test(f.content)) offenders.push(rel(f.path));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
```

- [ ] **Step 1.2: Flip tokens.test.ts.** Replace the hanken assertion and extend honesty:

```ts
  it("declares the Home editorial font stacks", () => {
    expect(css).toMatch(/--font-body-app:\s*var\(--font-geist\)/);
    expect(css).toMatch(/--font-home-sans:\s*var\(--font-body-app\)/);
    expect(css).toMatch(/--font-display-app:\s*var\(--font-fraunces\)/);
    expect(css).toMatch(/--font-home-serif:\s*var\(--font-display-app\)/);
  });

  it("font tokens never name an unloaded family (token honesty)", () => {
    expect(css).not.toMatch(/Instrument Sans/);
    expect(css).not.toMatch(/Newsreader/);
    expect(css).not.toMatch(/Hanken/);
  });
```

- [ ] **Step 1.3: Write the marker co-located test** at `apps/dashboard/src/app/(auth)/(mercury)/__tests__/mercury-layout.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import MercuryLayout from "../layout";

afterEach(cleanup);

describe("MercuryLayout (the register marker)", () => {
  it("renders a hidden mercury register marker alongside children, never wrapping them", () => {
    const { container, getByText } = render(
      <MercuryLayout>
        <p>mercury content</p>
      </MercuryLayout>,
    );
    const marker = container.querySelector('[data-register="mercury"]');
    expect(marker).not.toBeNull();
    expect(marker!.hasAttribute("hidden")).toBe(true);
    expect(marker!.childElementCount).toBe(0);
    const content = getByText("mercury content");
    expect(marker!.contains(content)).toBe(false);
  });
});
```

- [ ] **Step 1.4: Run all three, verify RED for the right reasons**

Run: `pnpm --filter @switchboard/dashboard test -- token-governance tokens.test mercury-layout 2>&1 | tail -20`
Expected failures: TY4 block (no Geist loader, no tokens, no rule, no marker file), tokens.test (hanken still aliased, Hanken named), mercury-layout (cannot resolve `../layout`). The pre-existing suites must NOT be newly red.

- [ ] **Step 1.5: Commit the red guards**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A apps/dashboard/src/app
git commit -m "test(dashboard): ty4 body-face guards red first" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(If the hook blocks committing red tests, squash 1.5 into Task 2's commit instead; record which way it went.)

### Task 2: Green core (loader, token, register rule, marker)

**Files:**
- Modify: `apps/dashboard/src/app/layout.tsx`
- Modify: `apps/dashboard/src/app/globals.css`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/layout.tsx`

- [ ] **Step 2.1: layout.tsx.** Import swap (Hanken_Grotesk out, Geist in):

```ts
import {
  Inter,
  DM_Sans,
  Space_Mono,
  Source_Serif_4,
  JetBrains_Mono,
  Fraunces,
  Geist,
} from "next/font/google";
```

Delete the whole `hanken` const and its comment block. Add in its place:

```ts
// The authed app register's body face (locked direction, section 4 TYPE):
// Geist, loaded as a VARIABLE font (no weight array) so the card-body 450 is
// a real instance, not a synthetic cut. Scoped to the authed register by the
// body:has(.app-header) rule in globals.css; legacy registers (login, landing,
// onboarding, Mercury, operator) keep Inter via inter.className on <body>.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});
```

In the `<html>` className template literal, replace `${hanken.variable}` with `${geist.variable}`. `<body className={inter.className}>` stays EXACTLY as is.

- [ ] **Step 2.2: globals.css token block.** Replace the line

```css
    --font-home-sans: var(--font-hanken), "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
```

with

```css
    /* The authed app register's BODY face (TY4): Geist, loaded in layout.tsx
       as a variable font. Applied at the register boundary by the body:has
       rule at the end of this file. Consumer CSS rides the token, never the
       raw family name. --font-home-sans is the legacy alias (zero churn for
       its 32 declarations); new code references --font-body-app. */
    --font-body-app: var(--font-geist), "Geist", ui-sans-serif, system-ui, sans-serif;
    --font-home-sans: var(--font-body-app);
```

- [ ] **Step 2.3: globals.css register rule.** Append at the very END of the file (top level, after the final closing brace; UNLAYERED is load-bearing):

```css

/* ===== TY4: the authed app register's body face =====
   UNLAYERED on purpose: next/font's inter.className on <body> is an unlayered
   (0,1,0) rule, and any @layer rule loses to it for font-family regardless of
   specificity. This selector is unlayered (0,2,1): it beats the Inter binding
   deterministically, order independent. body-level (not a shell wrapper) so
   Radix portals (sheets, drawers, popovers, toasts) inherit the register face.
   .app-header is the register hook (same condition as the cream + grain rule);
   the (mercury) route-group layout renders the exclusion marker. */
body:has(.app-header):not(:has([data-register="mercury"])) {
  font-family: var(--font-body-app);
}
```

- [ ] **Step 2.4: Create `apps/dashboard/src/app/(auth)/(mercury)/layout.tsx`:**

```tsx
/**
 * Mercury register marker (TY4). The body-face rule in globals.css excludes
 * any route that renders [data-register="mercury"], so every Mercury route
 * keeps the legacy Inter body face end to end (page content AND portals).
 * A hidden SIBLING, not a wrapper: zero layout impact, no new ancestor for
 * Mercury selectors, and :has() matches hidden elements. Server-rendered so
 * the exclusion holds on first paint.
 */
export default function MercuryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-register="mercury" hidden />
      {children}
    </>
  );
}
```

- [ ] **Step 2.5: Verify green**

Run: `pnpm --filter @switchboard/dashboard test 2>&1 | tail -5`
Expected: full suite green including the Task 1 guards.

- [ ] **Step 2.6: Build + typecheck** (no dev server running yet)

```bash
pnpm --filter @switchboard/dashboard build && pnpm typecheck
```

Expected: both green. If routes falsely fail typecheck: `rm -rf apps/dashboard/.next` and rerun.

- [ ] **Step 2.7: Commit**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A apps/dashboard/src
git commit -m "feat(dashboard): geist body face for the authed register (ty4)" -m "Geist variable loader + --font-body-app + unlayered body:has register rule with the (mercury) marker exclusion; Hanken retired via the --font-home-sans repoint." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: Metric voice (enumerated classes only, sizes preserved)

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox.css`
- Modify: `apps/dashboard/src/components/home/home.module.css`
- Modify: `apps/dashboard/src/components/decisions/swipe-decision-card.module.css`

- [ ] **Step 3.1: inbox.css card-body voice.** Eight edits; sizes/colors/layout untouched. For classes that already declare `letter-spacing: -0.003em` (`.decision-contact-quiet`, `.ds-datalines li` if present, `.ds-turn-bubble` if present), change it to `-0.006em`; otherwise add it. Add `font-weight: 450;` to each block:

```
.decision-contact-quiet  (~:325)  + font-weight: 450;  letter-spacing: -0.003em -> -0.006em
.ds-datalines li         (~:680)  + font-weight: 450;  + letter-spacing: -0.006em
.ds-contact-strip        (~:694)  + font-weight: 450;  + letter-spacing: -0.006em
.ds-lead-interest, .ds-lead-source (~:1007) + font-weight: 450; + letter-spacing: -0.006em
.ds-lead-contact         (~:1013) + font-weight: 450;  + letter-spacing: -0.006em
.ds-qual-line            (~:1021) + font-weight: 450;  + letter-spacing: -0.006em
.ds-turn-bubble          (~:1222) + font-weight: 450;  + letter-spacing: -0.006em
```

Example (first block):

```css
.decision-contact-quiet {
  font-size: 12.5px;
  font-weight: 450;
  color: var(--ink-2);
  letter-spacing: -0.006em;
}
```

CAREFUL: `.decision-contact-quiet::before` (the mono `For` eyebrow) keeps its own mono declarations untouched. `.ds-qual-line` has child spans with their own weights; the 450 lands on the block only.

- [ ] **Step 3.2: inbox.css button voice.** In `.ds-action` (~:880): `letter-spacing: -0.005em` becomes `-0.01em`. Nothing else in the block changes.

- [ ] **Step 3.3: home.module.css.** `.quietText` (~:276): add `font-weight: 450;`, change `letter-spacing: -0.003em` to `-0.006em`. `.btn` (~:350): `letter-spacing: -0.005em` becomes `-0.01em` (the only `-0.005em` inside the `.btn` block; verify by block, not by line number).

- [ ] **Step 3.4: swipe-decision-card.module.css.** `.btn` (~:225, the block declaring `font-family: var(--font-home-sans)` at :239): `letter-spacing: -0.005em` becomes `-0.01em`. This resolves the spec 3.5 conditional: the swipe action button declares the same 14/600/-.005 voice, so it joins. `.confirmRowValueSmall` (:438) re-faces via the token only: record in the addenda, no metric edits. results.module.css `.windowBtn`/`.recomputeBtn` (tuned 500 small controls): token re-face only, untouched.

- [ ] **Step 3.5: Suite + build still green** (vitest is css:false, so this proves no structural regressions only)

```bash
pnpm --filter @switchboard/dashboard test 2>&1 | tail -3 && pnpm --filter @switchboard/dashboard build 2>&1 | tail -3
```

- [ ] **Step 3.6: Commit**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A apps/dashboard/src/components
git commit -m "style(dashboard): card-body 450/-.006 and action-button tracking (ty4 voice)" -m "Enumerated set only: inbox card/sheet reading text + quietText at 450/-.006em; .ds-action, home .btn, swipe .btn tracking to -.01em. Sizes preserved per the TY2/TY3 precedent." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4: Static gates

- [ ] **Step 4.1:** `pnpm format:check` (prettier on `*.ts` only; NEVER prettier a lone CSS file). Fix + re-add if flagged.
- [ ] **Step 4.2:** `pnpm arch:check` (raw-line gate; excludes `*.test.ts`).
- [ ] **Step 4.3:** `pnpm typecheck 2>&1 | tail -3` (if dashboard routes falsely fail: `rm -rf apps/dashboard/.next`, rerun).
- [ ] **Step 4.4:** Full `pnpm test 2>&1 | tail -4` (cross-package safety; db/api flakes per memory are rerun-once-before-investigating).
- [ ] **Step 4.5:** Commit any fixes; verify `git status --short` clean and `git branch --show-current` = `feat/ty4-body-geist`.

### Task 5: Live evidence (the load-bearing verification)

**Files:** evidence committed under `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-body/`; scripts live in `/tmp/sbshot` (NOT committed).

- [ ] **Step 5.1: Recreate the scratch harness** (if /tmp was cleared):

```bash
mkdir -p /tmp/sbshot && cd /tmp/sbshot && npm init -y >/dev/null 2>&1 && npm i playwright-core pngjs pixelmatch >/dev/null 2>&1
```

- [ ] **Step 5.2: Launch the stack DETACHED from the worktree** (house pattern; API needs root .env, no dotenv):

```js
// /tmp/sbshot/launch.mjs  (run: node /tmp/sbshot/launch.mjs <worktree-root>)
import { spawn } from "child_process";
const root = process.argv[2];
const api = spawn("node", ["--env-file=.env", "-e",
  "require('child_process').spawn('pnpm',['--filter','@switchboard/api','dev'],{stdio:'inherit'})"],
  { cwd: root, detached: true, stdio: "ignore" });
api.unref();
const dash = spawn("pnpm", ["--filter", "@switchboard/dashboard", "dev"],
  { cwd: root, detached: true, stdio: "ignore" });
dash.unref();
console.log("launched detached");
```

Wait for `curl -s localhost:3002 -o /dev/null -w "%{http_code}"` = 200 (or 307) and `curl -s localhost:3000/health || curl -s localhost:3000` reachable.

- [ ] **Step 5.3: The font census (the negative AND positive structural proof).** Robust to live-data noise, unlike pixel diffs:

```js
// /tmp/sbshot/fontmap.mjs  (run: node fontmap.mjs <label>)
// Census: for each route, the set of computed font-families actually rendered
// on visible text nodes. Register proof: app routes resolve __Geist for sans
// text; legacy routes resolve __Inter exactly as before.
import { chromium } from "playwright-core";
import fs from "fs";
const label = process.argv[2];
const ROUTES = ["/", "/inbox", "/results", "/mira", "/settings/identity",
  "/reports", "/activity", "/contacts", "/automations",
  "/login", "/onboarding"];
const b = await chromium.launch({ executablePath:
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox"] });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const out = {};
for (const r of ROUTES) {
  await page.goto("http://localhost:3002" + r, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  out[r] = await page.evaluate(() => {
    const fams = {};
    for (const el of document.querySelectorAll("body *")) {
      const t = (el.childNodes && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      if (!t) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const f = cs.fontFamily;
      fams[f] = (fams[f] || 0) + 1;
    }
    return fams;
  });
}
fs.writeFileSync(`/tmp/sbshot/fontmap-${label}.json`, JSON.stringify(out, null, 2));
console.log("wrote fontmap-" + label);
```

- [ ] **Step 5.4: BEFORE captures.** In the worktree: `git checkout --detach origin/main` (dashboard-only diff, so no package rebuild; next dev hot-reloads). Then:
  - `node /tmp/sbshot/fontmap.mjs before`
  - Matrix shots (390x844 and 1280x900) of: Home, /inbox, approval sheet open (click a HIGH-RISK card), handoff sheet open, /results, agent panel open (Home avatar click), /mira, /settings/identity, one settings panel, inbox drawer open, live-signal popover open, one undo toast (approve then capture); save as `/tmp/sbshot/before/<surface>-<w>.png`.
  - Negative set: /reports, /activity, /contacts, /automations, /login, landing `/` logged out if reachable, one onboarding step; same two widths; `/tmp/sbshot/neg-before/`.
  - FOUT wrap baseline (Step 5.6 script with label `before`).
- [ ] **Step 5.5: AFTER captures.** `git checkout feat/ty4-body-geist`, wait for recompile, repeat all of 5.4 with `after` labels.

- [ ] **Step 5.6: FOUT line-count gate** (fonts-blocked vs loaded wrap counts; the body-swap check):

```js
// /tmp/sbshot/fout.mjs  (run: node fout.mjs <label> <blocked|loaded>)
import { chromium } from "playwright-core";
import fs from "fs";
const [label, mode] = process.argv.slice(2);
const PROBES = {
  "/": [".quietText", "[class*='weeknoteBody']", "[class*='btn']"],
  "/inbox": [".decision-contact-quiet", ".decision-title", ".filter-chip"],
  "/results": ["[class*='campaignCard']", "[class*='stateBanner']"],
  "/settings/identity": ["main p", "main label"],
};
const b = await chromium.launch({ executablePath:
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox"] });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
if (mode === "blocked") await page.route("**/*.woff2", (r) => r.abort());
const out = {};
for (const [route, sels] of Object.entries(PROBES)) {
  await page.goto("http://localhost:3002" + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  out[route] = await page.evaluate((sels) => {
    const res = {};
    for (const s of sels) {
      res[s] = [...document.querySelectorAll(s)].slice(0, 8).map((el) => {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
        return { lines: Math.round(el.getBoundingClientRect().height / lh),
                 fam: cs.fontFamily.slice(0, 40) };
      });
    }
    return res;
  }, sels);
}
fs.writeFileSync(`/tmp/sbshot/fout-${label}-${mode}.json`, JSON.stringify(out, null, 2));
console.log(`wrote fout-${label}-${mode}`);
```

Run on the branch: `node fout.mjs after loaded` and `node fout.mjs after blocked`; on detached main: `node fout.mjs before loaded`. Also capture the open approval sheet variant manually (datalines probe: `.ds-datalines li`, `.ds-lead-interest`). PASS = per-element line counts equal between blocked and loaded on the branch (no swap-rewrap), and after-loaded vs before-loaded deltas are line-level-explainable, no layout breaks at 390px (verify visually on the shots).

- [ ] **Step 5.7: Negative proof.** Compare `fontmap-before.json` vs `fontmap-after.json`: for /reports, /activity, /contacts, /automations, /login, /onboarding the family SETS must be identical (counts may drift with live data rows; the families may not). Run pixelmatch on the static negatives (login, onboarding) expecting ~0 diff. Record everything in the README table.

- [ ] **Step 5.8: AA probe** (real grounds, per-target 4.5 floors; face changes do not move color but the standing rule is pixel-proof): house pattern (scroll into view, `el.style.visibility="hidden"`, clip screenshot, pngjs average, WCAG vs `getComputedStyle(el).color`) on: `.ds-datalines li`, `.decision-contact-quiet`, `.ds-action-primary` text-on-amber, home `.btnPrimary`, one settings paragraph. Write `aa-report.json` with the tier stated per target.

- [ ] **Step 5.9: Read every PNG before claiming anything.** Curate evidence into the repo:

```bash
mkdir -p docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-body/{before,after,negative}
# copy curated before/after pairs + 4 representative negatives + fontmap/fout/aa reports
```

Write `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-body/README.md`: verdicts, the wrap-count table, the census equality table, AA table with tiers, and any tuning decisions taken at the gate (these also become spec addenda).

- [ ] **Step 5.10: Commit evidence**

```bash
git checkout -- apps/dashboard/next-env.d.ts; git add docs/audits
git commit -m "docs(audits): ty4 body-face live evidence (matrix, fout, census, aa)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 6: Spec addenda + PR

- [ ] **Step 6.1:** Append "## 10. Execution addenda (recorded outcomes)" to the spec ON THE IMPL BRANCH (the 8.1 pattern): gate outcomes (450 verdict, Hanken re-voice verdict, FOUT result, census result, any size nudges), each with measured numbers.
- [ ] **Step 6.2:** Final gates: `pnpm format:check && pnpm --filter @switchboard/dashboard test 2>&1 | tail -3 && pnpm typecheck 2>&1 | tail -3`. `git checkout -- apps/dashboard/next-env.d.ts`.
- [ ] **Step 6.3:** `git fetch origin && git rebase origin/main` (re-verify layout.tsx/globals.css/inbox.css if main moved them; rerun the suite if rebased).
- [ ] **Step 6.4:** Push + PR to main titled `style(dashboard): geist body face for the authed register (TY4)`. Body: spec/plan links, decision summary, before/after images via raw.githubusercontent URLs pinned to the HEAD SHA, the negative-proof table, the carve list (shadcn weight, Geist Mono deferral). End with the Claude Code generated-with line.

### Task 7: Reviews, merge, hygiene

- [ ] **Step 7.1:** `/code-review` skill at HIGH effort on the branch.
- [ ] **Step 7.2:** Fresh adversarial review by a skeptical Claude-native subagent (NOT Codex; if codex tools appear, flag and skip). Prompt it to attack: the cascade claim (unlayered vs inter.className), portal coverage, the Mercury census methodology, FOUT data honesty, guard bite-ness (would each TY4 guard actually fail on drift?).
- [ ] **Step 7.3:** receiving-code-review rigor: verify each finding against the live tree before implementing; expect convergent findings.
- [ ] **Step 7.4:** Merge when CI green (squash). Then hygiene scoped to MY artifacts only (re-check `gh pr list` + `git worktree list` first): delete `feat/ty4-body-geist` + `docs/ty4-body-geist-spec` local+remote, `git fetch origin main:main` only if no worktree holds main, remove this worktree, prune.
