# Type Scale + Display-Token Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the locked type scale's voice to the money surfaces (inbox title, sheet proposal, greeting, value numerics, meta honesty) and consolidate the authed display token onto one semantic (`--font-display-app`), per `docs/superpowers/specs/2026-06-04-type-scale-display-consolidation-design.md`.

**Architecture:** Pure presentation slice in `apps/dashboard`: one new globals.css semantic token with zero-churn aliases beneath it, per-surface CSS metric changes, four shell-component migrations off the legacy `--font-display`, a JetBrains 600 cut load, bounded copy hygiene, and a new TY3 drift-guard block. No data, routing, or backend changes.

**Tech Stack:** Next.js 14 app router, next/font/google, vitest (jsdom, css:false, structural contracts only), playwright-core + system Chrome for all live verification.

**Standing rules for every task:** commit subjects start lowercase (commitlint); every commit ends with the Co-Authored-By line from CLAUDE.md; `git checkout -- apps/dashboard/next-env.d.ts` before every commit if a dev server ran; never run prettier on a lone CSS file; lint-staged reformats staged .ts/.tsx on commit so `git add` again if it touches them; no em-dashes in any copy, comment, or commit message; dashboard imports omit `.js`.

---

### Task 0: Preflight (main moves under us)

**Files:** none modified.

- [ ] **Step 0.1: Sync and re-verify the touched surfaces against today's main.**

```bash
git fetch origin && git rev-parse origin/main
git switch -c feat/type-scale-display-consolidation origin/main
# Each grep must match; if any misses, STOP and re-read that file before proceeding
grep -n 'variable: "--font-display"' apps/dashboard/src/app/layout.tsx
grep -n 'weight: \["400", "500"\]' apps/dashboard/src/app/layout.tsx   # the JetBrains block
grep -n -- '--font-home-serif: var(--font-fraunces)' apps/dashboard/src/app/globals.css
grep -n -- '--serif: var(--font-fraunces)' apps/dashboard/src/components/inbox/inbox-design-base.css
grep -n -- '--mono: "JetBrains Mono"' apps/dashboard/src/components/inbox/inbox-design-base.css
grep -n 'font-weight: 500' apps/dashboard/src/components/inbox/inbox.css | head -3
grep -n 'className="font-display"' apps/dashboard/src/components/layout/help-overlay.tsx
grep -n 'SheetTitle className="font-display"' apps/dashboard/src/components/layout/inbox-drawer.tsx
grep -n 'status-label font-display' apps/dashboard/src/components/layout/live-signal-popover.tsx
grep -n 'font-display font-light' 'apps/dashboard/src/app/(auth)/settings/identity/page.tsx'
```

- [ ] **Step 0.2: Baseline suite green before any change.**

```bash
pnpm --filter @switchboard/dashboard test 2>&1 | tail -5
```
Expected: all green (pre-existing flakes per memory are pg_advisory/chat-attribution, not dashboard).

---

### Task 1: The display-token chain (TDD)

**Files:**
- Modify: `apps/dashboard/src/app/__tests__/tokens.test.ts` (~line 75 and ~line 78)
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (TY2 honesty test ~line 611; new TY3 block at end of file)
- Modify: `apps/dashboard/src/app/globals.css` (~line 277)
- Modify: `apps/dashboard/src/components/inbox/inbox-design-base.css` (~line 55)

- [ ] **Step 1.1: Flip the existing assertions to the chain (red first).**

In `tokens.test.ts`, replace the `--font-home-serif` line inside "declares the Home editorial font stacks":

```ts
    expect(css).toMatch(/--font-display-app:\s*var\(--font-fraunces\)/);
    expect(css).toMatch(/--font-home-serif:\s*var\(--font-display-app\)/);
```

In `token-governance.test.ts`, the TY2 test `"the display voice aliases the loaded Fraunces primitive"` becomes:

```ts
  it("the display voice aliases the loaded Fraunces primitive through the canonical token", () => {
    expect(css).toMatch(/--font-display-app:\s*var\(--font-fraunces\)/);
    expect(css).toMatch(/--font-home-serif:\s*var\(--font-display-app\)/);
    const inboxBase = files.find((f) => f.path.endsWith("inbox-design-base.css"));
    expect(inboxBase).toBeDefined();
    expect(inboxBase!.content).toMatch(/--serif:\s*var\(--font-display-app\)/);
  });
```

- [ ] **Step 1.2: Run to verify red.**

```bash
pnpm --filter @switchboard/dashboard test -- token-governance tokens 2>&1 | tail -15
```
Expected: FAIL on the two flipped tests (no `--font-display-app` exists yet).

- [ ] **Step 1.3: Implement the chain.**

In `globals.css`, replace the single line `--font-home-serif: var(--font-fraunces), "Fraunces", "Iowan Old Style", Georgia, serif;` with:

```css
    /* The ONE authed display semantic (TY3). Consumers reference this token
       (or one of the legacy aliases below, kept so zero consumers churn).
       --font-display (DM Sans, bound in layout.tsx) is the LEGACY register
       token for Mercury, landing, onboarding, and pre-auth surfaces only;
       it retires when those registers do. */
    --font-display-app: var(--font-fraunces), "Fraunces", "Iowan Old Style", Georgia, serif;
    --font-home-serif: var(--font-display-app);
```

In `inbox-design-base.css`, replace the `--serif` line:

```css
  --serif: var(--font-display-app);
```

- [ ] **Step 1.4: Run to verify green.**

```bash
pnpm --filter @switchboard/dashboard test -- token-governance tokens 2>&1 | tail -5
```
Expected: PASS (TY2 grain/shadow/contrast suites included).

- [ ] **Step 1.5: Commit.**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A && git commit -m "feat(dashboard): add --font-display-app canonical display token, alias home-serif and inbox serif (TY3)"
```

---

### Task 2: Mono honesty (TDD; the guard is naturally red-first)

**Files:**
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (new TY3 block, end of file)
- Modify: `apps/dashboard/src/app/layout.tsx` (JetBrains weight array, ~line 46)
- Modify: `apps/dashboard/src/components/inbox/inbox-design-base.css` (~line 57)

- [ ] **Step 2.1: Write the TY3 block with both mono guards.**

Append at the end of `token-governance.test.ts` (after the TY2 block):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// TY3: type scale + display-token consolidation (spec 2026-06-04).
// The canonical display semantic, mono honesty (face + loaded weights), and
// the legacy --font-display demotion for migrated shell surfaces.
// ─────────────────────────────────────────────────────────────────────────────
describe("token governance: type scale + display consolidation (TY3)", () => {
  const governed = collectGovernedFiles().filter((f) => typeVoiceGoverned(f.path));

  it("the inbox mono aliases the loaded JetBrains primitive (no raw-family lie)", () => {
    const inboxBase = governed.find((f) => f.path.endsWith("inbox-design-base.css"));
    expect(inboxBase).toBeDefined();
    expect(inboxBase!.content).toMatch(/--mono:\s*var\(--font-mono-editorial\)/);
  });

  it("every mono font-weight declared in governed CSS is a loaded JetBrains cut", () => {
    const layout = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    const jb = layout.slice(layout.indexOf("JetBrains_Mono("));
    const weightArray = jb.slice(0, jb.indexOf("]")).match(/"(\d+)"/g) ?? [];
    const loaded = new Set(weightArray.map((w) => w.replaceAll('"', "")));
    expect(loaded.size).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { path: p, content } of governed) {
      if (!p.endsWith(".css")) continue;
      for (const block of content.split("}")) {
        if (!block.includes("var(--mono)")) continue;
        const w = block.match(/font-weight:\s*(\d+)/);
        if (w && !loaded.has(w[1])) offenders.push(`${rel2(p)}: mono weight ${w[1]} not loaded`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the legacy --font-display never reaches governed authed TSX (sweep + legacy allowlist)", () => {
    // The allowlist is the explicit statement of which registers may still hold
    // the legacy token (DM Sans). It shrinks as those registers retire.
    const LEGACY_ALLOWED = [
      "app/login/",
      "app/forgot-password/",
      "app/reset-password/",
      "components/onboarding/",
    ];
    const offenders = governed
      .filter((f) => f.path.endsWith(".tsx"))
      .filter((f) => !LEGACY_ALLOWED.some((a) => f.path.includes(a)))
      .filter((f) => /font-display(?!-app)/.test(f.content))
      .map((f) => rel2(f.path));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
```

Add this small helper next to the block (module scope, below `typeVoiceGoverned`):

```ts
const rel2 = (p: string): string => (p.includes("/src/") ? p.slice(p.indexOf("/src/") + 1) : p);
```

- [ ] **Step 2.2: Run to verify red (three ways).**

```bash
pnpm --filter @switchboard/dashboard test -- token-governance 2>&1 | tail -25
```
Expected: FAIL on `inbox mono aliases` (raw family today), FAIL on `loaded JetBrains cut` (12 blocks declare 600, loader has 400/500), FAIL on the legacy sweep naming exactly four offenders (inbox-drawer.tsx, live-signal-popover.tsx, help-overlay.tsx, settings/identity/page.tsx). The sweep stays red until Task 4; note it and proceed. If it names a FIFTH file, stop and re-verify scope before continuing.

- [ ] **Step 2.3: Implement the mono fixes.**

`layout.tsx`, JetBrains block:

```ts
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-editorial",
  display: "swap",
});
```

`inbox-design-base.css`, the `--mono` line:

```css
  --mono: var(--font-mono-editorial), "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

- [ ] **Step 2.4: Run; expect ONLY the migrated-shell test still red.**

```bash
pnpm --filter @switchboard/dashboard test -- token-governance 2>&1 | tail -15
```

- [ ] **Step 2.5: Commit (red guard documented in the message).**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A && git commit -m "feat(dashboard): load real JetBrains 600 cut + honest inbox mono token (TY3 guards; shell-migration guard lands red, green in the shell task)"
```

(If a strictly-green-at-every-commit history is preferred, move Step 2.1's third `it` into Task 4's first step instead; the plan keeps them together so the TY3 block lands as one readable unit.)

---

### Task 3: Money-surface metrics (CSS only; live-tuned in Task 8)

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox.css` (h1 ~line 26, `.ds-summary` ~line 659)
- Modify: `apps/dashboard/src/components/home/home.module.css` (`.hello` ~line 79)

- [ ] **Step 3.1: Inbox pagehead h1 (spec row: weight 700, tracking -.025em; sizes/opsz stay).**

```css
.inbox-pagehead h1 {
  font-family: var(--serif);
  font-variation-settings: "opsz" 48;
  font-size: 36px;
  line-height: 1;
  letter-spacing: -0.025em;
  font-weight: 700;
  color: var(--ink-1);
}
```

- [ ] **Step 3.2: Sheet proposal (weight 600, tracking -.018em; sizes/opsz stay).**

```css
.ds-summary {
  font-family: var(--serif);
  font-variation-settings: "opsz" 36;
  font-size: 26px;
  line-height: 1.22;
  letter-spacing: -0.018em;
  color: var(--ink-1);
  font-weight: 600;
  text-wrap: pretty;
}
```

- [ ] **Step 3.3: Home greeting joins the display voice (18/500/-.01, opsz 24).**

```css
.hello {
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 24;
  font-size: 18px;
  color: var(--ink-2);
  letter-spacing: -0.01em;
  font-weight: 500;
}
```

- [ ] **Step 3.4: Suite still green (jsdom asserts no computed styles; this is a no-red change).**

```bash
pnpm --filter @switchboard/dashboard test 2>&1 | tail -3
```

- [ ] **Step 3.5: Commit.**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A && git commit -m "style(dashboard): apply locked scale voice to inbox title, sheet proposal, home greeting"
```

---

### Task 4: Shell-heading migration off the legacy token (turns the Task 2 guard green)

**Files:**
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx` (~line 129)
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.css`
- Modify: `apps/dashboard/src/components/layout/live-signal-popover.tsx` (~line 107)
- Modify: `apps/dashboard/src/components/layout/live-signal-popover.css` (~line 32)
- Modify: `apps/dashboard/src/components/layout/help-overlay.tsx` (~lines 68, 75-79)
- Modify: `apps/dashboard/src/app/(auth)/settings/identity/page.tsx` (~lines 284-287)
- Modify: `apps/dashboard/src/app/globals.css` (the `.font-display` utility comment, ~line 466)

- [ ] **Step 4.1: Drawer title adopts the display voice.**

`inbox-drawer.tsx`: `<SheetTitle className="font-display">Inbox</SheetTitle>` becomes

```tsx
            <SheetTitle className="drawer-title">Inbox</SheetTitle>
```

`inbox-drawer.css`, append (two-class specificity beats the shadcn `text-lg font-semibold` utilities):

```css
/* Drawer title: the mini-inbox shares the inbox page's display voice
   (sheet-title scale row: 22/600/-.018, opsz pinned for display character). */
.inbox-drawer .drawer-title {
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 28;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.018em;
}
```

- [ ] **Step 4.2: Status label stays sans, gains lead weight.**

`live-signal-popover.tsx`: `className="status-label font-display"` becomes `className="status-label"`.

`live-signal-popover.css`:

```css
.live-popover-head .status-label {
  flex: 1;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: -0.005em;
}
```

- [ ] **Step 4.3: Identity h1 becomes the crew display voice (tuned sizes kept, light becomes 600).**

`settings/identity/page.tsx`:

```tsx
          <h1
            className="text-5xl md:text-6xl tracking-tight text-foreground leading-none"
            style={{ fontFamily: "var(--font-display-app)", fontWeight: 600 }}
          >
            {displayName}
          </h1>
```

- [ ] **Step 4.4: Help overlay leaves the legacy token unconditionally (the display-voice rule itself is Task 8's conditional).**

`help-overlay.tsx`: `<h2 id="help-overlay-title" className="font-display">` becomes

```tsx
          <h2 id="help-overlay-title">
```

and the copy em-dash dies:

```tsx
        <p>
          Three agents work on your behalf. The <b>Inbox</b> shows decisions that need you. Each
          agent has a home page with their own work. <b>Live</b> in the header is the system pulse.
          Open it to halt or resume everyone, or to glance at recent activity.
        </p>
```

- [ ] **Step 4.5: Document the demoted utility.**

`globals.css`, the `.font-display` utility comment becomes:

```css
  /* LEGACY display utility: DM Sans via --font-display (layout.tsx binding).
     Remaining consumers are legacy registers (onboarding attribution-coverage,
     pre-auth, Mercury, landing). Authed surfaces use --font-display-app.
     Retires with those registers. */
  .font-display {
    font-family: var(--font-display);
  }
```

- [ ] **Step 4.6: Run; the Task 2 sweep guard goes green, component tests stay green.**

```bash
pnpm --filter @switchboard/dashboard test -- token-governance inbox-drawer live-signal identity help 2>&1 | tail -8
```
Expected: PASS all.

- [ ] **Step 4.7: Commit.**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A && git commit -m "feat(dashboard): migrate authed shell headings off legacy --font-display (drawer title + identity h1 adopt display voice, status label stays sans)"
```

---

### Task 5: Voice hygiene on the approval sheet + help overlay (corpus-first TDD)

**Files:**
- Modify: `apps/dashboard/src/__tests__/in-app-voice.test.ts` (CORPUS, ~line 89)
- Modify: `apps/dashboard/src/components/inbox/approval-detail-sheet.tsx` (four strings + bullet markup)

- [ ] **Step 5.1: Add the sheet and the help overlay to the corpus (red).**

In the CORPUS array, after `"components/layout/live-signal-popover.tsx"`:

```ts
  "components/layout/help-overlay.tsx",
  "components/inbox/approval-detail-sheet.tsx",
```

```bash
pnpm --filter @switchboard/dashboard test -- in-app-voice 2>&1 | tail -12
```
Expected: FAIL listing FIVE em-dash nodes in the sheet (the four copy strings PLUS the `.ds-datalines-bullet` whitespace-padded glyph: the exemption requires text EXACTLY "the lone glyph" and the bullet is a multi-line JSX text node). help-overlay shows clean only if Task 4.4 already ran; task order in this plan guarantees it.

- [ ] **Step 5.2: Collapse the bullet markup to the exact lone glyph (markup-only; never widen the exemption).**

In `approval-detail-sheet.tsx`, the datalines bullet span becomes one line:

```tsx
                  <span className="ds-datalines-bullet" aria-hidden="true">—</span>{" "}
```

- [ ] **Step 5.3: Fix the four strings (green).**

In `approval-detail-sheet.tsx`:

```tsx
          One last check: {agentName}&apos;s {primaryLabel.toLowerCase()}.
```

```tsx
        placeholder="Optional: leave a note for the audit log"
```

```tsx
                Needs review before this can run. This item was logged before risk-tracking was
                on.
```

```tsx
          <p className="ds-pending-caption">
            We&apos;re saving a slot here for live before-and-after numbers, wiring it up next
            week.
          </p>
```

- [ ] **Step 5.4: Run voice + sheet suites (the existing `/one last check/i` and `/Needs review before this can run/` assertions still match).**

```bash
pnpm --filter @switchboard/dashboard test -- in-app-voice approval-detail-sheet 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 5.5: Commit.**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A && git commit -m "fix(dashboard): de-em-dash approval sheet + help overlay copy, both join the voice corpus"
```

---

### Task 6: Stack up + the tabular-figures gate

**Files:** none in-repo (scratch scripts in /tmp/sbshot).

- [ ] **Step 6.1: Ports, env, deps, build (the worktree boot ritual).**

```bash
lsof -ti:3000 -ti:3001 -ti:3002 || echo "ports free"      # if owned, STOP: a parallel session may own them
psql "postgresql://switchboard:switchboard@localhost:5432/switchboard" -c "select 1"
pnpm worktree:init || true                                  # reports DB not reachable falsely; psql above is the truth
# fix the known env corruption:
#   apps/dashboard/.env.local: keep exactly ONE DATABASE_URL line (value from .env.local.example)
#   and uncomment DEV_BYPASS_AUTH=true
pnpm install
pnpm db:generate
pnpm build          # FULL build (reset skips ad-optimizer/creative-pipeline)
```

- [ ] **Step 6.2: Launch detached (tracked background tasks get reaped).**

```bash
mkdir -p /tmp/sbshot && cd /tmp/sbshot && npm init -y >/dev/null 2>&1 && npm i playwright-core pngjs >/dev/null 2>&1
node --env-file=/Users/jasonli/switchboard/.claude/worktrees/type-scale/.env -e "require('child_process').spawn('pnpm',['--filter','@switchboard/api','dev'],{cwd:'/Users/jasonli/switchboard/.claude/worktrees/type-scale',detached:true,stdio:['ignore',require('fs').openSync('/tmp/sb-api.log','a'),require('fs').openSync('/tmp/sb-api.log','a')]}).unref()"
node -e "require('child_process').spawn('pnpm',['--filter','@switchboard/dashboard','dev'],{cwd:'/Users/jasonli/switchboard/.claude/worktrees/type-scale',detached:true,stdio:['ignore',require('fs').openSync('/tmp/sb-dash.log','a'),require('fs').openSync('/tmp/sb-dash.log','a')]}).unref()"
sleep 12 && curl -s localhost:3002 -o /dev/null -w "%{http_code}\n" && curl -s localhost:3000/health -o /dev/null -w "%{http_code}\n"
```
Remember: a running next dev rewrites `apps/dashboard/next-env.d.ts`; checkout before every commit from here on. Never `pnpm build` while next dev is up.

- [ ] **Step 6.3: The tnum gate.** `/tmp/sbshot/tnum-gate.mjs`:

```js
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox"] });
const page = await b.newPage();
await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => document.fonts.ready);
const r = await page.evaluate(() => {
  const mk = (digits) => {
    const el = document.createElement("span");
    el.style.cssText = "font-family: var(--font-display-app); font-variant-numeric: tabular-nums; font-size: 40px; position: absolute; visibility: hidden; top: 0; left: 0;";
    el.textContent = digits;
    document.body.appendChild(el);
    return el.getBoundingClientRect().width;
  };
  const fam = getComputedStyle(document.body).getPropertyValue("--font-display-app");
  return { fam, ones: mk("1111111111"), zeros: mk("0000000000"), mixed: mk("1234567890") };
});
console.warn(JSON.stringify(r));
console.warn(Math.abs(r.ones - r.zeros) < 0.5 && Math.abs(r.ones - r.mixed) < 0.5 ? "TNUM: PASS" : "TNUM: FAIL");
await b.close();
```

```bash
cd /tmp/sbshot && node tnum-gate.mjs
```
PASS: proceed to Task 7. FAIL: skip Task 7 entirely, append the recorded outcome to the spec's section 3.4 as an addendum line in the impl PR, and continue at Task 8.

---

### Task 7: Numerics re-face (ONLY if the tnum gate passed)

**Files:**
- Modify: `apps/dashboard/src/components/results/results.module.css` (`.heroRevenueNum` ~55, `.heroStatNum` ~98, `.worthItNum` ~274)
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (TY3 block, one more guard)

- [ ] **Step 7.1: Guard first (red): display-faced numerics must keep tabular figures.**

Add inside the TY3 describe block:

```ts
  it("display-faced value numerics keep tabular figures", () => {
    const results = governed.find((f) => f.path.endsWith("results.module.css"));
    expect(results).toBeDefined();
    for (const cls of ["heroRevenueNum", "heroStatNum", "worthItNum"]) {
      const m = results!.content.match(new RegExp(`\\.${cls}\\s*{([^}]+)}`));
      expect(m, `.${cls} exists`).not.toBeNull();
      expect(m![1]).toMatch(/font-family:\s*var\(--font-display-app\)/);
      expect(m![1]).toMatch(/font-variant-numeric:\s*tabular-nums/);
    }
  });
```

```bash
pnpm --filter @switchboard/dashboard test -- token-governance 2>&1 | tail -8
```
Expected: FAIL (classes still mono).

- [ ] **Step 7.2: Re-face the three hero value moments (sizes/weights/tracking stay; opsz pinned).**

```css
.heroRevenueNum {
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 48;
  font-variant-numeric: tabular-nums;
  font-size: 2.5rem; /* 40px, large but not full editorial hero-num */
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--ink);
}
```

and the existing 768px media block for it gains the responsive opsz (56px outgrows a flat 48; house rule pins at or above px):

```css
@media (min-width: 768px) {
  .heroRevenueNum {
    font-size: 3.5rem; /* 56px */
    font-variation-settings: "opsz" 64;
  }
}
```

```css
.heroStatNum {
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 36;
  font-variant-numeric: tabular-nums;
  font-size: 1.75rem; /* 28px */
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.015em;
  color: var(--ink);
}
```

```css
.worthItNum {
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 36;
  font-variant-numeric: tabular-nums;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.015em;
  color: var(--ink);
}
```

`.heroAdSpendNum`, `.delta`, campaign and comparison numerics STAY mono (dense-data instrument face; spec 3.4.3).

- [ ] **Step 7.3: Guard green; full token suite green.**

```bash
pnpm --filter @switchboard/dashboard test -- token-governance 2>&1 | tail -5
```

- [ ] **Step 7.4: The taste gate.** Screenshot /results before committing (live page, 390 + 1280). Compare against a stash-shot of main if needed: `git stash && <shot> && git stash pop`. Decision rule from the spec: Fraunces money must read MORE at-home than mono on the warm-editorial page without losing instrument credibility; if it reads costume-y or soft, revert Steps 7.1-7.2 (`git checkout -- apps/dashboard/src/components/results/results.module.css` and drop the guard) and record the verdict.

- [ ] **Step 7.5: Commit (or record the revert).**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git add -A && git commit -m "style(dashboard): results hero value numerics adopt the display face with tabular figures (tnum-gated)"
```

---

### Task 8: Help-overlay conditional + the live verification matrix

**Files:**
- Possibly create: `apps/dashboard/src/components/layout/help-overlay.css` (+ its one-line import in help-overlay.tsx)
- Create: screenshots + AA report under `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-scale/`

- [ ] **Step 8.1: Help-overlay evidence.** Drive the running app: press `?` on Home (`page.keyboard.press("?")`), screenshot. Decision per spec 3.2: the class strip, copy fix, and corpus membership already landed (Tasks 4.4 + 5.1); what is conditional is ONLY the display-voice rule. If the overlay renders as a usable card, do Step 8.2; if structurally broken, record the shot as the pre-existing gap and skip to 8.3.

- [ ] **Step 8.2 (conditional): The h2 adopts the display voice.**

Create `apps/dashboard/src/components/layout/help-overlay.css`:

```css
/* Help overlay title only: the overlay's broader styling is a named follow-up.
   Sheet-title scale row (22/600/-.018), display voice. */
.help-card h2 {
  font-family: var(--font-display-app);
  font-variation-settings: "opsz" 28;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.018em;
}
```

In `help-overlay.tsx`: add `import "./help-overlay.css";` below the `"use client"` line. Run:

```bash
pnpm --filter @switchboard/dashboard test -- token-governance help 2>&1 | tail -5
```
Commit: `git add -A && git commit -m "style(dashboard): help overlay title adopts the display voice"`

- [ ] **Step 8.3: The screenshot matrix** (390x844 and 1280x900, every row of spec section 5): Home (greeting + verdict + week-note), /inbox (pagehead + cards), approval sheet open on a real HIGH-RISK item (tap a high-risk card), handoff sheet open, /results (full), inbox drawer open (masthead inbox button), live-signal popover open, settings/identity, /login + /reports as negative spot-checks. Before/after pairs: "before" shots from a `git stash`-ed tree (or main checkout served on :3012) at the same routes/viewports. Name files `<surface>-<vw>-{before,after}.png` under `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-scale/`.

- [ ] **Step 8.4: AA probe** (per-target floors; pixel-sample real grounds). For each changed element (spec section 6 list): scroll into view, read `getComputedStyle(el).color` and font metrics, hide the element, clip-screenshot its box, pngjs-average the ground, compute WCAG ratio, compare against the per-target floor (3:1 large by the spec's stated tiers, 4.5:1 otherwise). Write `aa-report-type-scale.md` in the screenshots dir with element, computed size/weight, tier, floor, measured ratio, PASS/FAIL. Any FAIL on an element whose COLOR this slice did not change is recorded pre-existing; any FAIL this slice caused gets fixed or reverted before PR.

- [ ] **Step 8.5: FOUT line-count check.** Route-block `**/*.woff2`, reload Home/inbox/sheet, count rendered lines of `.line`, `.inbox-pagehead h1`, `.ds-summary` (scrollHeight / lineHeight), then unblock and recount. Wrap-count must match loaded-vs-fallback per surface; record in the report (the known 48px verdict late-swap residual is pre-existing).

- [ ] **Step 8.6: Negative proof for legacy registers.**

```bash
git diff origin/main...HEAD --name-only | grep -E "mercury|landing|onboarding|login|forgot|reset" || echo "LEGACY UNTOUCHED"
```
Expected: `LEGACY UNTOUCHED` (attribution-coverage included in onboarding). Plus the /login and /reports spot shots from 8.3 eyeballed identical.

- [ ] **Step 8.7: Commit evidence.**

```bash
git checkout -- apps/dashboard/next-env.d.ts; git add docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-scale && git commit -m "docs(audits): type-scale live evidence (before/after matrix, aa report, fout check)"
```

---

### Task 9: Full gates, PR

- [ ] **Step 9.1: Kill dev servers, full local gates.**

```bash
kill $(lsof -ti:3000 -ti:3002) 2>/dev/null; sleep 2
rm -rf apps/dashboard/.next
pnpm --filter @switchboard/dashboard test 2>&1 | tail -3
pnpm typecheck 2>&1 | tail -3
pnpm --filter @switchboard/dashboard build 2>&1 | tail -3
pnpm format:check 2>&1 | tail -3
pnpm arch:check 2>&1 | tail -3
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null; git status --short
```
All green; working tree clean.

- [ ] **Step 9.2: Push + PR** (after the session's review gates: /code-review at high effort + a fresh adversarial subagent, findings addressed with receiving-code-review rigor).

```bash
git push -u origin feat/type-scale-display-consolidation
gh pr create --base main --title "style(dashboard): type scale on money surfaces + display-token consolidation (TY3)" --body "<body per session conventions: spec link, decision record incl. gate outcomes, embedded raw.githubusercontent before/afters, test plan, the Claude Code line>"
```

Merge when green; then hygiene per the session checklist (branches, worktree, scoped to this slice's artifacts only).

---

## Self-review (spec coverage)

- Spec 3.1 chain: Task 1. Legacy comment: Task 1 + 4.5.
- Spec 3.2 four headings: Task 4 (drawer, status label, identity, help-overlay class strip + copy) + Task 8.1/8.2 (help h2 display-voice rule, conditional).
- Spec 3.3 three metric rows: Task 3.
- Spec 3.4 numerics + gate + responsive opsz: Tasks 6.3 + 7 (incl. taste gate 7.4).
- Spec 3.5 mono honesty: Task 2; `.section-label` untouched (no task, by design); status label in Task 4.2.
- Spec 3.6 voice hygiene incl. the bullet markup collapse: Task 5 (sheet + help overlay in one corpus step).
- Spec 4 guards 1-7: Tasks 1.1/1.3 (guards 1, 2), 2.1 (guards 3 sweep + 5 mono), 7.1 (guard 4), 1.1 (guard 6 tokens.test), 5.1 (guard 7 corpus).
- Spec 5 matrix + spec 6 AA/FOUT: Task 8.
- Spec 2 goal 3 zero-pixel legacy: Task 8.6 (and the sweep allowlist keeps login/onboarding legacy-legal).
