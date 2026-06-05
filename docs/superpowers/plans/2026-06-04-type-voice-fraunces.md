# Type Voice (Fraunces + no-italics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt Fraunces as the authed app's self-hosted display face by repointing existing font tokens, fix the verdict's em-dash and italics, sweep all 50 italic declarations and ~10 decorative `<em>` sites from governed surfaces, and guard all of it against drift.

**Architecture:** Primitive-under-semantic token repoint (the Wave-1 keystone): `next/font` loads Fraunces into `--font-fraunces`; `--font-home-serif` (globals.css) and the inbox-local `--serif` alias it, so every display consumer upgrades with zero churn. Copy fixes ride the existing AST voice guard (corpus additions); italics die by deletion plus a new token-governance sweep.

**Tech Stack:** Next 16 `next/font/google`, vitest (jsdom, css:false), the `token-governance.test.ts` drift-guard pattern, playwright-core + system Chrome for live proof.

**Spec:** `docs/superpowers/specs/2026-06-04-type-voice-fraunces-design.md`

**Standing gotchas for every task:**
- Before every commit: `git checkout -- apps/dashboard/next-env.d.ts` if a dev server ran (next dev rewrites it to a dev-only path), and `git branch --show-current` to confirm you are on the feature branch.
- lint-staged reformats `.ts/.tsx` on commit; if it rewrites a file, re-`git add` and commit again. NEVER run prettier on a lone CSS file (hand-formatted, massive diff).
- Commitlint: subject starts lowercase. Commits end with the Co-Authored-By line.
- Never run `pnpm build` while `next dev` is up (clobbers `.next`).
- No em-dashes in any copy, comment, commit, or doc you write. Where this plan references existing em-dash code to delete, it cites line numbers instead of pasting the glyph.
- Line numbers cited below are from main at `0198a3a2`; deletions shift them. Re-grep per file before editing and remove ALL matches, using the cited numbers as orientation.

---

### Task 1: Workspace bring-up + BEFORE screenshots

**Files:** none committed except screenshots later (kept locally until Task 11 commits them).

- [ ] **Step 1: Verify ports are free BEFORE worktree:init** (the init script kills dev-port listeners; a parallel session may own them):

```bash
lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:3002 -sTCP:LISTEN || echo "ports free"
```

If any listener exists, STOP and check `git worktree list` + `gh pr list` for a parallel session before killing anything you do not own.

- [ ] **Step 2: Init the worktree** (from the worktree root `/Users/jasonli/switchboard/.claude/worktrees/type-voice`):

```bash
pnpm worktree:init
```

Note: it reports "DB not reachable" even when Postgres is up. Verify yourself:

```bash
psql "postgresql://switchboard:switchboard@localhost:5432/switchboard" -c "select 1"
```

- [ ] **Step 3: Fix the known env corruption** in `apps/dashboard/.env.local`: the init script concatenates two `DATABASE_URL`s onto one line (replace with the single value from `apps/dashboard/.env.local.example`) and leaves `DEV_BYPASS_AUTH=true` commented (uncomment it).

- [ ] **Step 4: Install deps (init skips them), generate Prisma, FULL build** (lower-layer dist must exist; `pnpm reset` skips ad-optimizer/creative-pipeline so use full build):

```bash
pnpm install
pnpm db:generate
pnpm build
```

- [ ] **Step 5: Launch the stack detached** (tracked background tasks get reaped). From a /tmp scratch dir, node-spawn detached per memory `feedback_local_dev_server_launch`: API needs root `.env` loaded via `node --env-file=.env` (it has no dotenv), dashboard via `pnpm --filter @switchboard/dashboard dev`. Pattern:

```bash
mkdir -p /tmp/sbshot && cd /tmp/sbshot && npm init -y >/dev/null 2>&1 && npm i playwright-core >/dev/null 2>&1
node -e "
const {spawn}=require('child_process');
const api=spawn('node',['--env-file=.env','--import','tsx','apps/api/src/server.ts'],{cwd:'/Users/jasonli/switchboard/.claude/worktrees/type-voice',stdio:'ignore',detached:true});api.unref();
const dash=spawn('pnpm',['--filter','@switchboard/dashboard','dev'],{cwd:'/Users/jasonli/switchboard/.claude/worktrees/type-voice',stdio:'ignore',detached:true});dash.unref();
"
```

Wait, then confirm `curl -s localhost:3002 >/dev/null && curl -s localhost:3000/health`.

- [ ] **Step 6: Capture BEFORE screenshots** with playwright-core + system Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `executablePath`, `waitUntil:"domcontentloaded"`, never `networkidle`). Matrix: `/` (verdict + poster + week-note + module headings), `/inbox`, `/results`, agent panel (open from Home poster), at 390px and 1280px. Save to `/tmp/sbshot/before/*.png` and Read each PNG to confirm content (verdict shows the em-dash form if 2+ decisions are seeded; the poster names render Newsreader; inbox h1 renders Iowan italic).

---

### Task 2: Fraunces in, Newsreader out, tokens repointed (TDD)

**Files:**
- Modify: `apps/dashboard/src/app/__tests__/tokens.test.ts:74-76`
- Modify: `apps/dashboard/src/app/layout.tsx` (imports, loaders, html className)
- Modify: `apps/dashboard/src/app/globals.css:115,277`
- Modify: `apps/dashboard/src/components/inbox/inbox-design-base.css:55`

- [ ] **Step 1: Flip the token test first.** In `tokens.test.ts`, the "declares the Home editorial font stacks" block currently asserts `--font-home-serif:\s*var\(--font-newsreader\)`. Replace with:

```ts
  it("declares the Home editorial font stacks", () => {
    expect(css).toMatch(/--font-home-sans:\s*var\(--font-hanken\)/);
    expect(css).toMatch(/--font-home-serif:\s*var\(--font-fraunces\)/);
  });

  it("font tokens never name an unloaded family (token honesty)", () => {
    expect(css).not.toMatch(/Instrument Sans/);
    expect(css).not.toMatch(/Newsreader/);
  });
```

- [ ] **Step 2: Run to verify it fails:**

```bash
pnpm --filter @switchboard/dashboard test -- tokens.test.ts
```

Expected: FAIL (still Newsreader/Instrument Sans).

- [ ] **Step 3: Implement.** In `layout.tsx`: replace `Newsreader` with `Fraunces` in the `next/font/google` import list; replace the newsreader loader block (and its comment) with:

```ts
// Fraunces is the authed app's display face (locked aesthetic direction,
// section 4 TYPE): upright optical only, no italics. next/font self-hosts the
// files at build time, so a font-load failure degrades to the serif fallback
// stack instead of flattening to system sans. Variable font: next/font/google
// forbids a fixed `weight` array alongside `axes`; the variable weight axis
// covers every display weight, and `opsz` carries the optical sizing. SOFT and
// WONK pin at their defaults (0, 0): the sharp, non-wonky cut.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});
```

In the `<html>` className template, replace `${newsreader.variable}` with `${fraunces.variable}`.

In `globals.css:277`:

```css
    --font-home-serif: var(--font-fraunces), "Fraunces", "Iowan Old Style", Georgia, serif;
```

In `globals.css:115` (delete only the unloaded family head; zero pixel change):

```css
    --font-display: ui-sans-serif, system-ui, sans-serif;
```

In `inbox-design-base.css:55` (kills the second token lie; inbox joins the display voice):

```css
  --serif: var(--font-fraunces), "Fraunces", "Iowan Old Style", Georgia, serif;
```

- [ ] **Step 4: Run tests and the build** (the build proves the font compiles and downloads; vitest cannot):

```bash
pnpm --filter @switchboard/dashboard test -- tokens.test.ts
rm -rf apps/dashboard/.next && pnpm --filter @switchboard/dashboard build
```

Expected: tests PASS, build succeeds. If the dev server was running, restart it after the build (build clobbers `.next`).

- [ ] **Step 5: Commit:**

```bash
git checkout -- apps/dashboard/next-env.d.ts 2>/dev/null
git add apps/dashboard/src/app/layout.tsx apps/dashboard/src/app/globals.css apps/dashboard/src/components/inbox/inbox-design-base.css apps/dashboard/src/app/__tests__/tokens.test.ts
git commit -m "feat(dashboard): load fraunces as the self-hosted display face, repoint home and inbox serif tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verdict + shell copy fixes, guarded by the voice corpus (TDD)

**Files:**
- Modify: `apps/dashboard/src/__tests__/in-app-voice.test.ts:89-105` (CORPUS)
- Modify: `apps/dashboard/src/components/home/compose-verdict.ts:118`
- Modify: `apps/dashboard/src/components/home/__tests__/compose-verdict.test.ts:79-91`
- Modify: `apps/dashboard/src/components/layout/editorial-shell-boundary.tsx:26`
- Modify: `apps/dashboard/src/components/layout/__tests__/editorial-shell-boundary.test.tsx:17`

- [ ] **Step 1: Grow the corpus first (the failing test).** Add to the CORPUS array in `in-app-voice.test.ts`:

```ts
  "components/home/compose-verdict.ts",
  "components/layout/editorial-shell-boundary.tsx",
  "components/layout/inbox-drawer.tsx",
  "components/layout/live-signal-popover.tsx",
```

- [ ] **Step 2: Run to verify it fails on the two real violations** (compose-verdict.ts:118 connector, editorial-shell-boundary.tsx:26 header):

```bash
pnpm --filter @switchboard/dashboard test -- in-app-voice.test.ts
```

Expected: FAIL listing both files. (If it flags anything else, fix that copy too: same rule.)

- [ ] **Step 3: Fix the copy.** In `compose-verdict.ts` (the 2+ decisions `hasName` branch, line 118), the new form mirrors the singular two-sentence pattern:

```ts
        pre = `${word} things need you. Start with `;
        em = topAgentName!;
        post = ".";
```

In `editorial-shell-boundary.tsx:26`:

```tsx
              <span>Switchboard is temporarily unavailable</span>
```

- [ ] **Step 4: Flip the string assertions.** In `compose-verdict.test.ts:79`, retitle and re-assert:

```ts
  it("uses 'N things need you. Start with {name}.' for 2+ decisions", () => {
    const m = composeVerdict({
      ...baseSignals,
      decisionCount: 3,
      topAgentName: "Riley",
      topAgentKey: "riley",
      now: at(9),
    });
    const line = m.line as { pre: string; em: string; post: string };
    expect(line.pre).toMatch(/3 things need you\. Start with $/);
    expect(line.em).toBe("Riley");
    expect(line.post).toBe(".");
  });
```

In `editorial-shell-boundary.test.tsx:17`:

```ts
    expect(screen.getByText(/Switchboard is temporarily unavailable/i)).toBeInTheDocument();
```

- [ ] **Step 5: Run the three suites, verify all pass:**

```bash
pnpm --filter @switchboard/dashboard test -- in-app-voice.test.ts compose-verdict.test.ts editorial-shell-boundary.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit:**

```bash
git add -A apps/dashboard/src/__tests__/in-app-voice.test.ts apps/dashboard/src/components/home apps/dashboard/src/components/layout
git commit -m "fix(dashboard): de-em-dash the verdict and shell header, corpus-guard the shell copy surfaces

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verdict and module-heading CSS go upright (spec weights)

**Files:**
- Modify: `apps/dashboard/src/components/home/home.module.css:85-115,173-184`

- [ ] **Step 1: Verdict line.** In `.line` (home.module.css:85), change `font-weight: 500;` to `font-weight: 600;` and `letter-spacing: -0.022em;` to `letter-spacing: -0.02em;` (spec scale: verdict hero 600, tracking -0.02em). Keep sizes and opsz values.

- [ ] **Step 2: Delete the dead italic rule** at lines 104-107 entirely (no markup renders an `em` inside `.line`; `.lineEm` has zero TSX consumers):

```css
.line em,
.lineEm {
  font-style: italic;
}
```

- [ ] **Step 3: Upright accent.** Replace the `.accent` rule and its comment (lines 108-115) with:

```css
/* Agent-colored accent inside the verdict line: identity only, upright
   (no italics, locked direction). Emphasis = identity ink + weight step.
   Default is neutral ink; ACTIVE shape overrides via inline style={{ color: hsl(var(--agent-X)) }}.
   CALM verdict (accentAgent: undefined) renders no inline style, so falls through to ink. */
.accent {
  color: var(--ink);
  font-weight: 700;
}
```

- [ ] **Step 4: Module heading upright.** In `.moduleH h2` (line 173): delete `font-style: italic;`, change `font-weight: 500;` to `font-weight: 600;`, change `letter-spacing: -0.008em;` to `letter-spacing: -0.018em;` (spec 22px display row). Keep `text-transform: lowercase;`. Update the section banner comment above `.module` from "lowercase serif italic h2" to "lowercase serif h2, upright".

- [ ] **Step 5: Verify zero italics remain in the file and tests still pass:**

```bash
grep -c "font-style: italic" apps/dashboard/src/components/home/home.module.css || echo 0
pnpm --filter @switchboard/dashboard test -- verdict home-page
```

Expected: 0 matches; suites PASS (jsdom is css:false, so this is a regression check, not a style check).

- [ ] **Step 6: Commit:**

```bash
git add apps/dashboard/src/components/home/home.module.css
git commit -m "style(home): upright verdict accent and module headings at spec weights

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Week-note goes upright

**Files:**
- Modify: `apps/dashboard/src/components/home/this-week.module.css:43,80-84,99,117,125,142`
- Modify: `apps/dashboard/src/components/home/this-week.tsx:59`

- [ ] **Step 1: Strip the six italic declarations**: `.weeknoteFromAv` (43), `.weeknoteBody em` (delete the whole 3-line rule at 81-84; keep nothing, the skeleton em becomes a span in Step 2), `.weeknoteBody.dropcap::first-letter` (99), `.weeknoteSignoff` (117), `.weeknoteSignoffMark` (125), `.weeknotePs` (142). Delete only the `font-style: italic;` lines (and the whole `.weeknoteBody em` rule); faces, sizes, colors stay.

- [ ] **Step 2: Swap the skeleton em** in `this-week.tsx:59`:

```tsx
          Your week&rsquo;s still being tallied. Check back soon.
```

(Drop the `<em>` wrapper entirely; the `.weeknoteBody` styling carries the voice.)

- [ ] **Step 3: Verify and test:**

```bash
grep -c "font-style: italic" apps/dashboard/src/components/home/this-week.module.css || echo 0
pnpm --filter @switchboard/dashboard test -- this-week
```

Expected: 0; PASS (this-week.tsx is already voice-corpus-guarded; the test at this-week.test.tsx:94 checks no literal tags leak and still passes).

- [ ] **Step 4: Commit:**

```bash
git add apps/dashboard/src/components/home/this-week.module.css apps/dashboard/src/components/home/this-week.tsx
git commit -m "style(home): upright week-note (drop cap, signoff, ps, skeleton)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Agent panel goes upright

**Files:**
- Modify: `apps/dashboard/src/components/agent-panel/agent-panel.module.css:186,211,231,381,412,449-455,624,766` (+ two comments)
- Modify: `apps/dashboard/src/components/agent-panel/identity-status.tsx:76-86`
- Modify: `apps/dashboard/src/components/agent-panel/key-result.tsx:124-130`
- Modify: `apps/dashboard/src/components/agent-panel/__tests__/identity-status.test.tsx:133` (and its querySelector)

- [ ] **Step 1: Strip the eight italics**: `.verdictEmpty` (186), the avatar letter rule (211), `.notsetHeading` (231), the 381 rule, `.heroErrorMsg` (412), the whole `.heroActivationLine em` rule (453, delete all 3 lines), `.decisionEmptyLine` (624), `.logEmptyLine` (766). Update the two comments that say "italic serif line" to "serif line". Also strip `font-style: italic` wherever `.verdictAccent` is defined (grep for it; it is among these rules).

- [ ] **Step 2: Swap the markup ems.** In `identity-status.tsx:82`, `<em key={i} className={styles.verdictAccent}>` becomes `<span key={i} className={styles.verdictAccent}>` (closing tag too; update the comment on line 76 from "accent → <em>" to "accent span"). In `key-result.tsx:125`, drop the bare `<em>` wrapper inside `.heroActivationLine` (keep the text and the ternary exactly as is).

- [ ] **Step 3: Flip the structural test.** In `identity-status.test.tsx:133` area, the assertion selects an `em` with the verdictAccent class; change the selector/comment to `span` + verdictAccent.

- [ ] **Step 4: Verify and test:**

```bash
grep -c "font-style: italic" apps/dashboard/src/components/agent-panel/agent-panel.module.css || echo 0
grep -rn "<em" apps/dashboard/src/components/agent-panel --include="*.tsx" | grep -v __tests__ || echo "no em"
pnpm --filter @switchboard/dashboard test -- agent-panel identity-status key-result
```

Expected: 0; "no em"; PASS.

- [ ] **Step 5: Commit:**

```bash
git add apps/dashboard/src/components/agent-panel
git commit -m "style(agent-panel): upright verdict accent, headings, and empty states

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Inbox + shell go upright

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox.css` (15 declarations: 33,251,300,395,430,591,647,660,764,802,949,1067,1114,1160,1404)
- Modify: `apps/dashboard/src/components/inbox/inbox-design-base.css:246`
- Modify: `apps/dashboard/src/app/globals.css:890,1227,1275,1282` (legacy editorial block: `.dc-resolved-line`, `.tile-ctx`, `.empty-state`, `.freshness-note`)
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx:137,142,146-150`
- Modify: `apps/dashboard/src/components/layout/live-signal-popover.tsx:115,120,125`
- Modify: `apps/dashboard/src/components/layout/editorial-shell-boundary.tsx:31`

- [ ] **Step 1: Strip every `font-style: italic;` line** in the four CSS locations above. Re-grep each file first; the two one-line rules (`.decision-sla[data-due="overdue"]` at 300 and `.ds-sla[data-due="overdue"]` at 647) keep their `font-weight: 700` and color, just lose the italic token. Where a comment beside a rule says "italic", reword it.

- [ ] **Step 2: Unwrap the seven decorative `<em>`s** in the three layout components (inbox-drawer x3, live-signal-popover x3, editorial-shell-boundary x1): drop the `<em>`/`</em>` wrappers, keep the text and surrounding `<p className=...>` exactly as is. These files joined the voice corpus in Task 3, so their copy is guarded.

- [ ] **Step 3: Verify and test:**

```bash
grep -c "font-style: italic" apps/dashboard/src/components/inbox/inbox.css || echo 0
grep -c "font-style: italic" apps/dashboard/src/components/inbox/inbox-design-base.css || echo 0
grep -c "font-style: italic" apps/dashboard/src/app/globals.css || echo 0
grep -rn "<em" apps/dashboard/src/components/layout --include="*.tsx" | grep -v __tests__ || echo "no em"
pnpm --filter @switchboard/dashboard test -- inbox tokens.test.ts in-app-voice
```

Expected: 0/0/0; "no em"; PASS.

- [ ] **Step 4: Commit:**

```bash
git add apps/dashboard/src/components/inbox apps/dashboard/src/app/globals.css apps/dashboard/src/components/layout
git commit -m "style(inbox,shell): strip italics from inbox surfaces and shell fallbacks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Decisions + Results go upright

**Files:**
- Modify: `apps/dashboard/src/components/decisions/swipe-decision-card.module.css:133` (`.fromName`)
- Modify: `apps/dashboard/src/components/decisions/decision-card.css:154` (`.dc-resolved-line`)
- Modify: `apps/dashboard/src/components/results/results.module.css` (11 declarations: 177,228,311,320,465,482,819,921,1040,1114,1185)

- [ ] **Step 1: Strip every `font-style: italic;` line** in the three files (re-grep first). Faces, weights, colors stay.

- [ ] **Step 2: Verify and test:**

```bash
grep -rn "font-style: italic" apps/dashboard/src/components/decisions apps/dashboard/src/components/results || echo 0
pnpm --filter @switchboard/dashboard test -- decisions results
```

Expected: 0; PASS.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/src/components/decisions apps/dashboard/src/components/results
git commit -m "style(decisions,results): strip remaining italics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: TY2 drift guards (proven to bite)

**Files:**
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (append after the last describe, ~line 574)

- [ ] **Step 1: Append the guard block** (reuses `collectGovernedFiles()`; the exclusion pattern mirrors the EL1 grandfather style):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// TY2: the type voice. The authed app speaks Fraunces upright; italics are
// banned from governed surfaces (locked direction, section 3 non-negotiables).
// Mercury and the marketing landing keep their own registers until retired.
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_VOICE_EXEMPT = ["(mercury)/", "components/landing/"];
const typeVoiceGoverned = (p: string): boolean =>
  !TYPE_VOICE_EXEMPT.some((ex) => p.includes(ex));

describe("token governance: type voice (TY2)", () => {
  const files = collectGovernedFiles().filter((f) => typeVoiceGoverned(f.path));

  it("no font-style italic in governed CSS", () => {
    const offenders = files
      .filter((f) => f.path.endsWith(".css"))
      .filter((f) => /font-style:\s*italic/.test(f.content))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no <em> or <i> elements in governed TSX (decorative italics are banned; use ink or weight)", () => {
    const offenders = files
      .filter((f) => f.path.endsWith(".tsx"))
      .filter((f) => /<(em|i)[\s>]/.test(f.content))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the display voice aliases the loaded Fraunces primitive", () => {
    const globals = files.find((f) => f.path.endsWith("app/globals.css"));
    expect(globals).toBeDefined();
    expect(globals!.content).toMatch(/--font-home-serif:\s*var\(--font-fraunces\)/);
    const inboxBase = files.find((f) => f.path.endsWith("inbox-design-base.css"));
    expect(inboxBase).toBeDefined();
    expect(inboxBase!.content).toMatch(/--serif:\s*var\(--font-fraunces\)/);
  });

  it("layout.tsx loads Fraunces upright only (no italic style requested)", () => {
    const layout = readFileSync(
      path.resolve(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    expect(layout).toMatch(/Fraunces\(/);
    const frauncesBlock = layout.slice(layout.indexOf("Fraunces("));
    expect(frauncesBlock.slice(0, frauncesBlock.indexOf("})"))).toMatch(
      /style:\s*\["normal"\]/,
    );
  });
});
```

Note: the em/i regex catches Mercury's `<em className=...>` usage if the exemption breaks, so keep the path filter aligned with the actual `(mercury)` route-group directory name. `readFileSync` and `path` are already imported at the top of the file; verify before adding imports.

- [ ] **Step 2: Run, expect PASS** (the sweep landed at zero in Tasks 4-8):

```bash
pnpm --filter @switchboard/dashboard test -- token-governance
```

- [ ] **Step 3: Prove each guard bites.** Temporarily add `font-style: italic;` to any rule in `home.module.css`, run, expect FAIL on the CSS guard; revert. Temporarily add `<em>x</em>` to `verdict.tsx`, run, expect FAIL on the TSX guard; revert. Confirm `git status --short` is clean of the probes afterward.

- [ ] **Step 4: Commit:**

```bash
git add apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "test(dashboard): TY2 drift guards for the no-italics register and fraunces token honesty

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full local gates

- [ ] **Step 1: Full dashboard suite + repo gates:**

```bash
pnpm --filter @switchboard/dashboard test
rm -rf apps/dashboard/.next && pnpm typecheck
pnpm --filter @switchboard/dashboard build
pnpm format:check
pnpm arch:check
```

Expected: all green. Gotchas: typecheck falsely fails on routes if a stale `.next` exists (hence the rm); `format:check` is prettier on `*.ts` only; `arch:check` counts raw .ts lines (token-governance.test.ts grows, confirm it stays under the 600 error line or note the test-file exemption; check with `wc -l`).

- [ ] **Step 2: Restart the dev stack** (the build clobbered `.next`), re-confirm :3000/:3002 respond.

- [ ] **Step 3: Commit anything the gates changed** (lint-staged reformats), else proceed.

---

### Task 11: Live verification (AFTER shots, AA, FOUT) + tuning

**Files:**
- Create: `docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-voice/*.png` (before + after, mobile + desktop)

- [ ] **Step 1: AFTER screenshots**, same matrix as Task 1 Step 6: Home verdict (ACTIVE and CALM if seedable), poster names, week-note, module headings, masthead, `/inbox` pagehead + cards, `/results`, agent panel, approval sheet (negative check: face unchanged), at 390px and 1280px. Read every PNG; confirm Fraunces renders (denser, higher-contrast serif), zero italics visible, verdict copy reads "N things need you. Start with {name}."

- [ ] **Step 2: AA pixel-sampling on the real grounds** (token gates are necessary, not sufficient): for the poster names (the known-risk labels on the grain wash) and the verdict accent in each agent ink, use the established probe: scroll element into view, `el.style.visibility="hidden"`, `page.screenshot({clip: boundingBox})`, pngjs-average the ground, WCAG-compare vs `getComputedStyle(el).color`. Every label must be 4.5:1 or better. If a deep ink falls short under Fraunces' thinner hairlines, bump the consuming weight one step (never the primitive without re-running the poster gate).

- [ ] **Step 3: FOUT/CLS check on the verdict**: load `/` with `page.route` aborting `**/*.woff2`, screenshot (fallback serif renders); reload unblocked, screenshot; compare the verdict block's bounding box across both (y-delta of the needs-you stack should be ~0; `next/font` fallback adjustment is the mechanism). Record the two shots.

- [ ] **Step 4: Tuning pass (only if the shots demand)**: per-surface `font-variation-settings: "opsz"` nudges or size steps on display surfaces. Document any change in the commit body. Re-shoot after tuning.

- [ ] **Step 5: Commit the screenshot set** (before/, after/, fout/ subfolders):

```bash
git add docs/audits/2026-06-02-ui-ux-feel-audit/screenshots/type-voice
git commit -m "docs(audit): type-voice before/after screenshots, AA samples, fout proof

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Reviews, PR, merge, hygiene

- [ ] **Step 1:** `/code-review` skill at high effort on the branch diff; address findings with receiving-code-review rigor (verify before implementing).
- [ ] **Step 2:** Adversarial review by a fresh skeptical subagent (NOT Codex; the plugin is uninstalled, see memory feedback_no_codex). Prompt it to refute: token-resolution correctness (var indirection through next/font hashed names), the guard's exemption paths, copy regressions, test fidelity.
- [ ] **Step 3:** superpowers:finishing-a-development-branch: focused impl PR to main (base off main, no stacking), body embeds the after screenshots via raw.githubusercontent URLs (repo is public, they render inline), PR body ends with the Claude Code generated-with line. Merge when green.
- [ ] **Step 4:** Hygiene scoped to THIS session's artifacts only: re-check `gh pr list` and `git worktree list` first (parallel sessions are usually active); delete merged branches local+remote, fast-forward local main, remove the worktree.
