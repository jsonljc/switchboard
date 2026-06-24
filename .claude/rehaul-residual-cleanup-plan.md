# Aesthetic-Rehaul Residual Cleanup — Implementation Plan

> Light TDD-shaped plan for the CLOSED documented token-convergence residual list. Autonomous /loop, user-delegated incl. design judgment + squash-merge. Scratch only (NOT docs/). Execute via superpowers:subagent-driven-development.

**Goal:** Kill the last register-fracture token leaks named in the aesthetic-rehaul backlog: a raw Tailwind color in the editorial-register activity component, a forked bare-hex `--ink-3` on /activity, and a stale comment cross-ref.

**Architecture:** Three independent one-line source repoints in apps/dashboard, each TDD RED-proven by a co-located source-assertion test. Bundle into ONE focused PR ("converge the last register-fracture token residuals") from ONE worktree, three commits for blame clarity. Item 4 (latent funnel cap) is a documented SKIP.

**Tech Stack:** Next 14 dashboard, vitest, CSS modules, Tailwind, token-governance source guards.

## Global Constraints (verbatim from the QUALITY brief)

- TDD RED proof per change (token-governance.test.ts / CSS-source / component render tests).
- Governed CSS: mono weight 400/500/600 only, NO italic, NO raw hex in governed CSS.
- No em-dashes anywhere (copy, specs, commits). Lowercase commit subjects (commitlint).
- Dashboard coverage floor 40/35/40/40 (NOT CLAUDE.md 55/50/52/55).
- Live pixel-sample for any AA claim (nominal token math overstates contrast on grain+gradient cream).
- Three-dot diffs `git diff origin/main...HEAD`. Rebase onto current origin/main before merge.
- Full VERIFY before merge: `pnpm --filter @switchboard/dashboard exec tsc --noEmit`; dashboard `vitest`; `next build`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm audit --audit-level=high`; token-governance suite.

## Ground-truth (verified on origin/main ea7a30cdd, 2026-06-22)

- Item 1 file `components/activity/activity-item.tsx` is ORPHANED (zero importers; superseded by the mercury v2 `app/(auth)/(mercury)/activity/` surface). No `text-blue-500` twin in the sibling `activity-detail.tsx` (it has no color map). So the fix is pure source/governance hygiene, no rendered change.
- Global `--ink-3: hsl(var(--palette-ink-500))` (= `20 6% 36%`, the PL-2 AA-tuned value) lives at `:root`, BUT globals.css:223 forbids the Mercury/Tools tier from consuming the editorial `--ink-*` _semantic_ aliases. So item 2 converges onto the shared _primitive_ `--palette-ink-500` (the T5 single-source ramp), NOT the editorial alias. Same value, register boundary respected, matches the file's own idiom (`--amber: hsl(var(--action))`).
- No test pins `#6B6052`. Mercury hex sweep only bans an enumerated legacy list (#6B6052 not in it), so the change trips no existing guard.

---

### Task 1: Item 1 — activity-item info icon → neutral semantic ink

**Files:**

- Modify: `apps/dashboard/src/components/activity/activity-item.tsx:20`
- Test (create): `apps/dashboard/src/components/activity/__tests__/activity-item.test.tsx`

**Decision (brainstorm):** `info: "text-muted-foreground"` (neutral editorial ink). NOT a new `--info` token (would add a cool hue to a deliberately warm palette for a dead consumer — anti-thesis, premature abstraction). `text-muted-foreground` is the secondary-text token already used in this file; ~4.6:1 as a graphical object (clears the 3:1 non-text floor, improves on `text-blue-500`'s ~3.6).

- [ ] **Step 1: Write the failing test** — `__tests__/activity-item.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The activity-item icon-color map must speak the editorial register's
// semantic tokens (text-positive / text-caution / text-destructive /
// text-muted-foreground), never a raw Tailwind palette color. A raw
// text-blue-500 (info) was the last register-fracture leak in this map.
const source = readFileSync(
  path.resolve(process.cwd(), "src/components/activity/activity-item.tsx"),
  "utf8",
);
const mapMatch = source.match(/const iconColorMap = \{([\s\S]*?)\};/);

describe("activity-item icon colors — editorial register tokens only", () => {
  it("defines the iconColorMap literal", () => {
    expect(mapMatch, "iconColorMap literal must exist").not.toBeNull();
  });

  it("uses no raw Tailwind palette color in the icon-color map", () => {
    const RAW_TW_COLOR =
      /text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/;
    expect(
      RAW_TW_COLOR.test(mapMatch![1]),
      `raw Tailwind color in iconColorMap: ${mapMatch![1]}`,
    ).toBe(false);
  });

  it("maps the info severity to a neutral semantic ink (not a hue)", () => {
    expect(mapMatch![1]).toMatch(/info:\s*"text-muted-foreground"/);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** — `pnpm --filter @switchboard/dashboard test activity-item` → tests 2 and 3 FAIL (text-blue-500 matches RAW_TW_COLOR; info not muted-foreground).
- [ ] **Step 3: Implement** — `activity-item.tsx:20`: `  info: "text-blue-500",` → `  info: "text-muted-foreground",`
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `fix(dashboard): repoint activity info icon to a neutral editorial ink token`

---

### Task 2: Item 2 — /activity --ink-3 sourced from the canonical ink ramp

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css:44`
- Test (create): `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-tokens.test.ts`

- [ ] **Step 1: Write the failing test** — `__tests__/activity-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// /activity (Mercury Tools tier) must source --ink-3 from the canonical neutral
// ink-ramp primitive (--palette-ink-500, the AA-tuned 36% L), not a forked bare
// hex. globals.css forbids the Mercury tier from consuming the editorial --ink-*
// *semantic* aliases, so we reference the shared *primitive* directly.
const css = readFileSync(
  path.resolve(process.cwd(), "src/app/(auth)/(mercury)/activity/activity.module.css"),
  "utf8",
);
const decl = css.match(/\.activityPage\b[\s\S]*?--ink-3:\s*([^;]+);/);

describe("/activity ink-3 — canonical ramp primitive, no bare hex", () => {
  it("declares --ink-3 in the .activityPage scope", () => {
    expect(decl, "--ink-3 must be declared on .activityPage").not.toBeNull();
  });

  it("references the --palette-ink-500 primitive, not a bare hex", () => {
    const value = decl![1].trim();
    expect(value).toBe("hsl(var(--palette-ink-500))");
    expect(value, "no bare hex").not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** — value is `#6B6052`.
- [ ] **Step 3: Implement** — `activity.module.css:44`: `  --ink-3:        #6B6052;` → `  --ink-3:        hsl(var(--palette-ink-500));` (preserve column alignment).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: LIVE AA sample** — render /activity (`next dev` + DEV_BYPASS_AUTH, mercury fixtures), screenshot, PIL-sample an `--ink-3` text run (e.g. `.pagInfo` / `.funnelStage` / `.emptySub`) against its ground; require >= 4.5:1. Expectation: ~6:1 (flat opaque `--paper`, no grain). Record the number in the loop-state + PR body.
- [ ] **Step 6: Commit** — `fix(dashboard): source /activity ink-3 from the canonical ink ramp primitive`

---

### Task 3: Item 3 — drop the stale notice-bar cross-ref comment

**Files:** Modify `apps/dashboard/src/components/ui/notice-bar.tsx:10-12`

No RED proof: comment-only change has no testable behavior. The existing `notice-bar.test.tsx` already pins the AA pairing the comment documents (`bg-caution-subtle` + `text-foreground` + not-amber) and stays green. Verification = existing test green + format/lint.

- [ ] **Step 1: Implement** — drop ` See Badge #4b note.` from the end of the comment block (keep the AA rationale):

```
        // Light caution tint ground carries the tone; dark --foreground ink
        // carries the text (~15:1). The mid-tone text-caution on this tint is
        // only ~4.4:1 (fails AA), so we never pair them.
```

- [ ] **Step 2: Run notice-bar test, verify still PASS.**
- [ ] **Step 3: Commit** — `chore(dashboard): drop stale cross-ref in notice-bar comment`

---

### Item 4: funnel `.funnelSection` width cap — DOCUMENTED SKIP

Decision: **SKIP**, leave the documented note. Rationale:

- Provably INERT: the funnel's ancestor sections already carry `max-width: var(--max-w)` (74rem) on both routes (`reports.module.css`, `.mercuryVoice`), and the app-shell content cell is already narrower than 74rem (user-stated). A cap on the child `.funnelSection` changes zero rendered pixels.
- The established inert-measure-cap lesson (Home bento, 2026-06-22): reviewers REMOVE inert caps as noise.
- It touches the SHARED widget feeding /reports, the literal style-guide surface; both-routes visual risk for zero benefit. User instruction: "Do not take both-routes visual risk for a latent fix."
- /results historically not screenshot-capturable in a worktree (env+API/seed gated), so both-routes neutrality cannot be proven anyway — which under the user's conditional ("do it ONLY if a before/after screenshot of BOTH routes shows neutral") means skip.

No code, no PR. Documented in loop-state + final report.

---

## PR / merge / verify / teardown

1. ONE worktree `.claude/worktrees/rehaul-residual-cleanup` off fresh origin/main; `pnpm install --frozen-lockfile` + `pnpm db:generate` + `pnpm --filter "./packages/*" build`.
2. Execute Tasks 1-3 via subagent-driven-development (RED proof + per-task fresh-context review).
3. Bundle into ONE PR (three commits). If item 2 AA unexpectedly fails, split it out and ship 1+3.
4. Full VERIFY suite (Global Constraints) green.
5. Final INDEPENDENT fresh-context review (/code-review or requesting-code-review); fix Critical/Important, push back with evidence on wrong findings.
6. Re-fetch origin/main, re-check no concurrent overlap on activity/notice-bar/reports-shared (`gh pr list` + `git worktree list`); rebase onto current origin/main so three-dot == two-dot == only-my-files.
7. Wait for CI required checks green; `gh pr merge --squash --admin` (NO --delete-branch from a worktree).
8. Teardown: `git worktree remove --force` + `prune` + `branch -D` + `fetch --prune` + ff-sync main if clean.
9. Update memory (project_aesthetic_rehaul + session_resume).

## Status log / progress ledger

- 2026-06-22: ground truth established, all 4 residuals re-verified on origin/main; item 1 brainstorm locked (muted-foreground); plan written; worktree `.claude/worktrees/rehaul-residual-cleanup` off d5dcbaa5e (#1246), packages built.
- Task 1 (item 1, info icon): COMPLETE — commit 6f3e3d631, RED→GREEN proven (3 passed), review clean (spec PASS / quality APPROVED). 2 Minor non-blocking notes: process.cwd() path (kept — matches token-governance.lib.ts convention) + non-null assertion (guarded). BASE d5dcbaa5e.
- Task 2 (item 2, /activity --ink-3): COMPLETE — commit 463a03c8a, RED→GREEN proven, token-governance 49/49 green, review clean (spec PASS / quality APPROVED, no findings). LIVE AA sample on rendered /activity (port 3099, mercury fixtures): nominal ink-3 vs opaque paper (rgb 251,251,249 / lum 0.96, no grain bleed) = 6.53:1; local-bg sampling over 49,420 glyph pixels = median 6.53 / p2 5.53 / worst 5.24 -> AA PASS with margin. Converge-to-canonical-ramp confirmed. BASE 6f3e3d631.
- Task 3 (item 3, notice-bar comment): COMPLETE — commit 649882bd5, notice-bar test 3/3 green (comment-only, no RED applicable). BASE 463a03c8a.
- Item 4 (funnel .funnelSection cap): SKIPPED with documented reason (provably inert: ancestor sections already cap at var(--max-w) 74rem on both routes + app-shell narrower; inert-cap lesson; both-routes style-guide risk; user-sanctioned). No code/PR.
- VERIFY (all green, worktree d5dcbaa5e..649882bd5): format:check OK; arch:check no-error; tsc OK; vitest 397 files/2581 tests pass (incl 2 new + token-governance); local-verify-fast 7 guards OK; next build OK; lint 0 errors (60 pre-existing api warnings); pnpm audit --audit-level=high exit 0.
- Final independent review (opus, fresh context): SHIP, no Critical/Important. 1 Minor (em-dashes in 2 new test labels) FIXED (commit pre-rebase 859196f88); confirmed no em-dash in any added line; pre-existing mercury-comment em-dashes left (out of scope, retiring register).
- Rebased onto origin/main 665cc1cd7 (#1248, core, no overlap); restored next-env.d.ts build-artifact flip first. two-dot==three-dot==only my 5 files (60+/3-). New HEAD 60797052a (2d4a360bd/42a8515e9/17e78a12c/60797052a). Pushed.
- PR #1249 MERGED (squash 2205fcccf) 2026-06-22. All CI required green (typecheck/lint/test/security + architecture/docker/secrets/CodeQL/5 evals). Worktree+branch torn down, local main ff-synced to 2205fcccf. Memory updated (project_aesthetic_rehaul + session_resume).
- ✅ LOOP COMPLETE: items 1/2/3 merged (#1249), item 4 skipped-with-reason. The documented token-convergence residual list is fully exhausted. STOP.
