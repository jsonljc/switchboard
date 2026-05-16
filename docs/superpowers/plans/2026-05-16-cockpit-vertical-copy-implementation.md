# Cockpit vertical copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap operator-facing "tours / SDR / HotPod" copy in the Alex cockpit, mission API, and cold-state empty state to medspa-vertical wording. Add narrowly-scoped hygiene tests so the strings cannot reappear.

**Architecture:** Pure copy change. Seven production string swaps across four code files, mechanical fixture/assertion updates across nine test files (including a `HotPod Yoga` → `Acme Medspa` test-org rename), nine illustrative-copy edits in the umbrella cockpit spec, and two new hygiene tests. No schema, no types, no `AgentRoster.config` lift, no architectural rename. The architecture stays vertical-agnostic; only operator-visible surfaces use medspa wording.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo). Vitest for tests. Next.js 14 dashboard. Fastify api. Existing hygiene-test pattern lives at `apps/dashboard/src/__tests__/no-bare-query-keys.test.ts`.

**Spec:** `docs/superpowers/specs/2026-05-16-cockpit-vertical-copy-design.md`

---

## File Structure

**Production code modified:**

- `apps/api/src/routes/agent-home/mission.ts` — `ALEX_ROLE` and `ALEX_PIPELINE` constants (lines 67-68).
- `apps/dashboard/src/lib/cockpit/alex-config.ts` — `missionSubtitle` (line 14).
- `apps/dashboard/src/components/cockpit/empty-state.tsx` — `SETUP_LABEL.inbox`, `SETUP_LABEL.cal`, and the second narrator paragraph (lines 12-13, 50-52).
- `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` — ROI bar `rightMeta.suffix` (line 103).

**Test fixtures aligned:**

- `apps/api/src/routes/agent-home/__tests__/mission.test.ts` — three fixture orgs + assertions on role/pipeline/brand.
- `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts` — fixture role/pipeline.
- `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx` — 7 occurrences of subtitle.
- `apps/dashboard/src/components/cockpit/__tests__/types.test.ts` — subtitle + ROLE row.
- `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx` — role/pipeline/brand.
- `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` — role/pipeline/brand.
- `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` — `brand: "HotPod Yoga · —"`.
- `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx` — `suffix: " in tour value"`.

**Spec doc updated:**

- `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` — illustrative copy at L122, L207, L358, L372, L444, L461, L725, L733, L790.

**New test files:**

- `apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts` — file-system scan of cockpit surface for banned phrases.
- `apps/api/src/routes/agent-home/__tests__/mission-copy-hygiene.test.ts` — recursive walk of `buildAlexMissionResponse(...)` payload.

---

## Task 0: Set up worktree and verify baseline

**Files:**

- None modified — environment-only.

- [ ] **Step 1: Create the worktree off origin/main**

```bash
git fetch origin main
git worktree add .worktrees/cockpit-vertical-copy -b fix/cockpit-medspa-vertical-copy origin/main
cd .worktrees/cockpit-vertical-copy
```

- [ ] **Step 2: Initialize the worktree**

```bash
pnpm worktree:init
```

Expected: env file copied, dev ports clear, `pnpm db:migrate` runs if Postgres reachable. If Postgres is not reachable, that is fine — none of the work in this plan requires Postgres.

- [ ] **Step 3: Verify branch context**

```bash
git branch --show-current
git status --short
```

Expected: `fix/cockpit-medspa-vertical-copy` and a clean working tree.

- [ ] **Step 4: Run baseline test for sanity (cockpit dashboard tests)**

```bash
pnpm --filter @switchboard/dashboard test --run src/components/cockpit/__tests__/identity.test.tsx
```

Expected: PASS. This proves the baseline is green before any edits.

---

## Task 1: Update the umbrella cockpit spec

**Files:**

- Modify: `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` at 9 line locations.

This task is a pure-docs commit. No tests, no code. Land it first so reviewers can see the design intent before reading the code change.

- [ ] **Step 1: Edit L122 — `calendar-book` description**

Find: `| `calendar-book`           | Hold/confirm a tour slot                               | Activity row`booked`; powers KPI `bookings`                                                   |`

Replace `Hold/confirm a tour slot` with `Hold/confirm a consultation slot`.

- [ ] **Step 2: Edit L207 — ROI explanation aside**

Find the `tour value` reference in the line beginning `- ROI bar `crm` source for Alex.` Replace `tour value` with `consultation value`.

- [ ] **Step 3: Edit L358 — mission popover example**

Find the mockup line `SDR · Tours pipeline · {org.displayName}   (clickable)`. Replace `Tours pipeline` with `Consultations pipeline`.

- [ ] **Step 4: Edit L372 — `ROLE` row example**

Find the table row `| `ROLE`    |`SDR · qualify inbound leads, book tours`                                      |`. Replace `book tours` with `book consultations`.

- [ ] **Step 5: Edit L444 — cold-state ROI bar example**

Find `[● return on spend] $214 spent · $1,611 in tour value ─────[━━━●━━━━]──── 6× spend`. Replace `in tour value` with `in consultation value`.

- [ ] **Step 6: Edit L461 — `MissionViewModel` comment**

Find `rightMeta: { value: string; suffix: string };  // { value: "$1,611", suffix: " in tour value" }`. Replace `" in tour value"` with `" in consultation value"`.

- [ ] **Step 7: Edit L725 — setup checklist `cal` row label**

Find `2. **Setup checklist** — 4 rows: `meta`(Connect Meta Ads, primary),`inbox`(Connect HotPod inbox),`cal`(Connect tour calendar),`rules` (Review pricing & escalation — pre-checked from onboarding).`

Replace `Connect HotPod inbox` with `Connect your inbox` and `Connect tour calendar` with `Connect consultation calendar`.

- [ ] **Step 8: Edit L733 — cold-state narrator default copy block**

Find the code block with `lines:` containing `book tours under your standing rules`. Replace the second line:

```
"Then I'll qualify, reply, and book tours under your standing rules. I'll only interrupt you for pricing decisions over $89 and refunds."
```

With:

```
"So Alex can qualify inbound leads and book consultations under your standing rules. I'll only interrupt you for pricing decisions over $89 and refunds."
```

- [ ] **Step 9: Edit L790 — `role` field comment**

Find `role: string;                  // "SDR · qualify inbound leads, book tours"`. Replace `book tours` with `book consultations`.

- [ ] **Step 10: Verify prettier is happy with the markdown**

```bash
pnpm format:check docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md
```

If it complains, run `pnpm prettier --write docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`.

- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md
git commit -m "docs(cockpit): update umbrella spec to medspa vertical copy

Aligns the nine illustrative-copy locations with the medspa-vertical
wording locked in the 2026-05-16 cockpit-vertical-copy spec. No
architectural change — these are example strings inside a locked design
doc, not normative contracts."
```

---

## Task 2: Production code changes (api + dashboard)

**Files:**

- Modify: `apps/api/src/routes/agent-home/mission.ts:67-68`
- Modify: `apps/dashboard/src/lib/cockpit/alex-config.ts:14`
- Modify: `apps/dashboard/src/components/cockpit/empty-state.tsx:12-13,50-52`
- Modify: `apps/dashboard/src/lib/cockpit/legacy-shapes.ts:103`

After this task, existing tests **will be red** — they assert on the old strings. Task 3 brings the suite back to green. This is expected.

- [ ] **Step 1: Edit `mission.ts` ALEX_ROLE and ALEX_PIPELINE**

Open `apps/api/src/routes/agent-home/mission.ts` and replace:

```ts
const ALEX_ROLE = "SDR · qualify inbound leads, book tours";
const ALEX_PIPELINE = "Tours pipeline · single funnel";
```

With:

```ts
const ALEX_ROLE = "SDR · qualify inbound leads, book consultations";
const ALEX_PIPELINE = "Consultations pipeline · single funnel";
```

- [ ] **Step 2: Edit `alex-config.ts` missionSubtitle**

Open `apps/dashboard/src/lib/cockpit/alex-config.ts` and replace:

```ts
missionSubtitle: "SDR · Tours pipeline",
```

With:

```ts
missionSubtitle: "SDR · Consultations pipeline",
```

- [ ] **Step 3: Edit `empty-state.tsx` SETUP_LABEL inbox + cal**

Open `apps/dashboard/src/components/cockpit/empty-state.tsx` and replace lines 11-14:

```ts
const SETUP_LABEL: Record<MissionAggregatorResponse["setup"][number]["key"], string> = {
  meta: "Connect Meta Ads",
  inbox: "Connect HotPod inbox",
  cal: "Connect tour calendar",
  rules: "Review pricing & escalation",
};
```

With:

```ts
const SETUP_LABEL: Record<MissionAggregatorResponse["setup"][number]["key"], string> = {
  meta: "Connect Meta Ads",
  inbox: "Connect your inbox",
  cal: "Connect consultation calendar",
  rules: "Review pricing & escalation",
};
```

- [ ] **Step 4: Edit `empty-state.tsx` second narrator paragraph**

Same file, replace lines 49-52:

```tsx
<p className="mt-2 text-base leading-snug" style={{ color: T.ink2 }}>
  Then I'll qualify, reply, and book tours under your standing rules. I'll only interrupt you for
  pricing decisions over ${price} and refunds over ${refund}.
</p>
```

With:

```tsx
<p className="mt-2 text-base leading-snug" style={{ color: T.ink2 }}>
  So Alex can qualify inbound leads and book consultations under your standing rules. I'll only
  interrupt you for pricing decisions over ${price} and refunds over ${refund}.
</p>
```

- [ ] **Step 5: Edit `legacy-shapes.ts` ROI bar suffix**

Open `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` and replace line 103:

```ts
rightMeta: { value: `$${earned.toLocaleString()}`, suffix: " in tour value" },
```

With:

```ts
rightMeta: { value: `$${earned.toLocaleString()}`, suffix: " in consultation value" },
```

- [ ] **Step 6: Run typecheck (sanity — no type errors expected from string-only changes)**

```bash
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS. (Type errors here would mean an unrelated regression — investigate before continuing.)

- [ ] **Step 7: Run tests to confirm they go red (proof the changes took effect)**

```bash
pnpm --filter @switchboard/dashboard test --run src/components/cockpit/__tests__/identity.test.tsx
pnpm --filter @switchboard/api test --run src/routes/agent-home/__tests__/mission.test.ts
```

Expected: **FAIL** with assertion errors mentioning `"SDR · Tours pipeline · HotPod"` and `"SDR · qualify inbound leads, book tours"`. This proves the production change took. Task 3 will fix these.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/agent-home/mission.ts \
        apps/dashboard/src/lib/cockpit/alex-config.ts \
        apps/dashboard/src/components/cockpit/empty-state.tsx \
        apps/dashboard/src/lib/cockpit/legacy-shapes.ts
git commit -m "fix(cockpit): swap tours and tenant copy for medspa equivalents

Operator-facing copy in the Alex cockpit, mission API, and cold-state
empty state now matches the locked medspa vertical:

- ALEX_ROLE      'book tours' → 'book consultations'
- ALEX_PIPELINE  'Tours pipeline' → 'Consultations pipeline'
- missionSubtitle same swap on the dashboard side
- SETUP_LABEL.inbox  'Connect HotPod inbox' → 'Connect your inbox'
                     (removes tenant brand leak from shared copy)
- SETUP_LABEL.cal    'Connect tour calendar' → 'Connect consultation calendar'
- empty-state narrator second paragraph rewritten in agent-third-person
- legacy-shapes ROI bar suffix ' in tour value' → ' in consultation value'

Test fixtures will go red on this commit and be repaired in the
follow-up commit (test-fixture alignment + HotPod Yoga rename).

Refs spec: docs/superpowers/specs/2026-05-16-cockpit-vertical-copy-design.md"
```

---

## Task 3: Align test fixtures + rename `HotPod Yoga` → `Acme Medspa`

**Files:**

- Modify: `apps/api/src/routes/agent-home/__tests__/mission.test.ts` (3 fixture orgs + 3 brand assertions + role/pipeline assertions)
- Modify: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts:33-34`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx` (7 subtitle occurrences)
- Modify: `apps/dashboard/src/components/cockpit/__tests__/types.test.ts:54,57`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx:8-10`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx:83-85`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx:432,492`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx:10`

The string substitutions are all the same pattern. Order: do the replace-all sweep first, then verify with a second sweep, then run tests.

- [ ] **Step 1: Replace-all sweep across api + dashboard test files**

Run a guarded sweep using `sed` per file (do NOT use a global recursive sed — packages/core test fixture is intentionally out of scope per the spec). For each file in the list above, perform these substitutions in order:

```bash
# Substitutions to apply to each file in the fixture-update list:
# 1. "SDR · qualify inbound leads, book tours" → "SDR · qualify inbound leads, book consultations"
# 2. "Tours pipeline · single funnel"          → "Consultations pipeline · single funnel"
# 3. "SDR · Tours pipeline · HotPod"           → "SDR · Consultations pipeline · Acme Medspa"
# 4. "SDR · Tours pipeline"                    → "SDR · Consultations pipeline"
# 5. "HotPod Yoga · —"                         → "Acme Medspa · —"
# 6. "HotPod Yoga"                             → "Acme Medspa"
# 7. " in tour value"                          → " in consultation value"
```

Use the LSP tool or your editor's project-wide find-and-replace, scoped to the 8 listed test files only. If using `sed`, confirm each file's diff before chaining the next file.

- [ ] **Step 2: Verify the sweep — no banned phrases remain in scoped test files**

```bash
grep -rn -e "HotPod" -e "Tours pipeline" -e "book tours" -e " in tour value" -e "tour calendar" \
  apps/api/src/routes/agent-home/__tests__/mission.test.ts \
  apps/dashboard/src/app/api/dashboard/agents/\[agentId\]/mission/__tests__/route.test.ts \
  apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx \
  apps/dashboard/src/components/cockpit/__tests__/types.test.ts \
  apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx \
  apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx \
  apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx \
  apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx
```

Expected: **no output** (empty result = no matches).

- [ ] **Step 3: Run the full dashboard cockpit test suite**

```bash
pnpm --filter @switchboard/dashboard test --run src/components/cockpit/__tests__/
```

Expected: PASS for all cockpit tests. If anything is red, the failure message points at the file/line that still has a stale string — go fix it.

- [ ] **Step 4: Run the full api agent-home test suite**

```bash
pnpm --filter @switchboard/api test --run src/routes/agent-home/__tests__/
```

Expected: PASS.

- [ ] **Step 5: Run the dashboard route mission proxy test**

```bash
pnpm --filter @switchboard/dashboard test --run "src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/agent-home/__tests__/mission.test.ts \
        apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts \
        apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/types.test.ts \
        apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx
git commit -m "test(cockpit): align fixtures with new medspa copy + rename HotPod org fixture

Restores green after the production string changes in the previous
commit. Each fixture file moves in lock-step:

- assertions on mission.role/pipeline/brand updated
- subtitle/role/pipeline/brand component-test fixtures updated
- 'HotPod Yoga' fixture org renamed to 'Acme Medspa' across all sites
  (the source of the tenant brand leak)

packages/core/src/agent-home/__tests__/metrics-types.test.ts:28
intentionally retains ' in tour value' — engineer-only string in a
vertical-agnostic layer; out of scope per the spec."
```

---

## Task 4: Add the two copy-hygiene regression tests

**Files:**

- Create: `apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts`
- Create: `apps/api/src/routes/agent-home/__tests__/mission-copy-hygiene.test.ts`

Pattern reference: `apps/dashboard/src/__tests__/no-bare-query-keys.test.ts` (existing in-tree CI guard).

- [ ] **Step 1: Write the dashboard hygiene test**

Create `apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts` with the following content:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI guard: no operator-facing string in the cockpit surface may use the
 * legacy "tours pipeline" framing or the leaked tenant brand "HotPod".
 *
 * Scans BOTH production code and __tests__/ subdirs because synthetic test
 * fixtures that mirror production strings have leaked the brand name in the
 * past (see the 2026-05-16 cockpit-vertical-copy spec). The hygiene test
 * file itself is excluded by name — its inline `BANNED` array would
 * otherwise self-trip.
 *
 * If a future medspa operator does want "tour" wording back, change it
 * intentionally in `cockpit-vertical-copy-design.md`, narrow the BANNED
 * list, and update this test in the same PR.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN_ROOTS = [join(HERE, "..", "components", "cockpit"), join(HERE, "..", "lib", "cockpit")];

const BANNED: ReadonlyArray<{ phrase: string; caseInsensitive?: boolean }> = [
  { phrase: "HotPod", caseInsensitive: true },
  { phrase: "Tours pipeline" },
  { phrase: "book tours" },
  { phrase: " in tour value" },
  { phrase: "tour calendar" },
];

const SELF_BASENAME = "cockpit-copy-hygiene.test.ts";

interface Offense {
  file: string;
  line: number;
  phrase: string;
  context: string;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (st.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
  return files;
}

function scan(): Offense[] {
  const offenses: Offense[] = [];
  const files: string[] = [];
  for (const root of SCAN_ROOTS) files.push(...walk(root));

  for (const file of files) {
    if (file.endsWith(SELF_BASENAME)) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const { phrase, caseInsensitive } of BANNED) {
      const needle = caseInsensitive ? phrase.toLowerCase() : phrase;
      lines.forEach((line, idx) => {
        const haystack = caseInsensitive ? line.toLowerCase() : line;
        if (haystack.includes(needle)) {
          offenses.push({
            file: relative(join(HERE, ".."), file),
            line: idx + 1,
            phrase,
            context: line.trim(),
          });
        }
      });
    }
  }
  return offenses;
}

describe("cockpit copy hygiene", () => {
  it("no banned legacy or tenant-brand phrase appears in the cockpit surface", () => {
    const offenses = scan();
    if (offenses.length > 0) {
      const formatted = offenses
        .map((o) => `  ${o.file}:${o.line}  →  "${o.phrase}"\n      ${o.context}`)
        .join("\n");
      throw new Error(
        `Found ${offenses.length} banned phrase(s) in the cockpit surface. ` +
          `These strings must not reappear (see docs/superpowers/specs/2026-05-16-cockpit-vertical-copy-design.md). ` +
          `Offenders:\n${formatted}`,
      );
    }
    expect(offenses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the dashboard hygiene test**

```bash
pnpm --filter @switchboard/dashboard test --run src/__tests__/cockpit-copy-hygiene.test.ts
```

Expected: PASS. If it fails, the failure message names the offending file:line — fix that file, re-run.

- [ ] **Step 3: Write the api hygiene test**

Create `apps/api/src/routes/agent-home/__tests__/mission-copy-hygiene.test.ts` with the following content:

```ts
import { describe, it, expect } from "vitest";
import { buildAlexMissionResponse } from "../mission.js";

/**
 * CI guard: the rendered mission response for an Alex roster must not
 * contain any of the legacy "tours pipeline" framings or the leaked
 * tenant brand "HotPod". Asserting against the rendered response (not
 * the raw constants) catches future drift if ALEX_ROLE / ALEX_PIPELINE
 * are ever moved to config or templated.
 *
 * Companion test: apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts.
 */

const BANNED = ["HotPod", "Tours pipeline", "book tours", "tour value", "tour calendar"] as const;

function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      collectStrings((value as Record<string, unknown>)[key], acc);
    }
  }
  return acc;
}

describe("mission copy hygiene", () => {
  it("buildAlexMissionResponse output contains no banned legacy/tenant phrases", () => {
    const out = buildAlexMissionResponse({
      roster: {
        id: "ros-1",
        organizationId: "org-1",
        agentRole: "responder",
        displayName: "Alex",
        description: "",
        status: "active",
        tier: "starter",
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      org: { id: "org-1", name: "Acme Medspa" },
      connections: [],
      managedChannels: [],
    });

    const allStrings = collectStrings(out);
    const offenders: Array<{ phrase: string; value: string }> = [];
    for (const phrase of BANNED) {
      const lc = phrase.toLowerCase();
      for (const s of allStrings) {
        if (s.toLowerCase().includes(lc)) {
          offenders.push({ phrase, value: s });
        }
      }
    }

    if (offenders.length > 0) {
      const formatted = offenders.map((o) => `  "${o.phrase}" in: ${o.value}`).join("\n");
      throw new Error(
        `Found ${offenders.length} banned phrase(s) in buildAlexMissionResponse output. ` +
          `Offenders:\n${formatted}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the api hygiene test**

```bash
pnpm --filter @switchboard/api test --run src/routes/agent-home/__tests__/mission-copy-hygiene.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts \
        apps/api/src/routes/agent-home/__tests__/mission-copy-hygiene.test.ts
git commit -m "test(cockpit): add copy-hygiene regression coverage

Two sibling CI guards prevent re-introduction of the legacy 'tours
pipeline' framing or the tenant brand 'HotPod' in the cockpit surface.

The dashboard test scans apps/dashboard/src/components/cockpit/** and
apps/dashboard/src/lib/cockpit/** including __tests__/ subdirs (so
synthetic fixtures stay clean). The api test recursively walks the
buildAlexMissionResponse(...) output and asserts no banned phrase
appears in any string field."
```

---

## Task 5: Pre-merge verification + push + open PR

**Files:**

- None modified.

- [ ] **Step 1: Reset the workspace and rebuild the lower layers**

```bash
pnpm reset
```

Expected: clears `dist/` artifacts, regenerates Prisma client, rebuilds schemas → core → db. Should complete without error. (Why this matters: stale lower-layer artifacts cause false-alarm typecheck failures per CLAUDE.md.)

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS across all packages.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: 0 errors. Pre-existing warnings are acceptable.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: PASS. Two known flakes that reproduce on baseline are documented in MEMORY (`feedback_db_integrity_tests_pg_advisory_lock` + an mcp-server parallel-load timeout). If those fail, re-run them in isolation:

```bash
pnpm --filter @switchboard/db test --run
pnpm --filter @switchboard/mcp-server test --run src/__tests__/production-mutation-guard.test.ts
```

Both should pass when run alone.

- [ ] **Step 5: Run the dashboard production build (CI does NOT run this — `feedback_dashboard_build_not_in_ci`)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: exit 0. This catches `.js`-extension regressions in dashboard imports that typecheck would miss.

- [ ] **Step 6: Run prettier check (CI runs prettier; local lint does not — `feedback_ci_prettier_not_in_local_lint`)**

```bash
pnpm format:check
```

Expected: clean. If anything is dirty, run `pnpm prettier --write <file>` on the offenders and amend Step 7's stage list to include them.

- [ ] **Step 7: Push the branch and open the PR (no `--auto` per `feedback_auto_merge_captures_head_early`)**

```bash
git push -u origin fix/cockpit-medspa-vertical-copy

gh pr create --title "fix(cockpit): medspa vertical copy + tenant-string removal" --body "$(cat <<'EOF'
## Summary

- Swaps operator-facing "tours / SDR / HotPod" copy in the Alex cockpit, mission API, and cold-state empty state for medspa-vertical wording. Architecture stays vertical-agnostic; only operator-visible surfaces change.
- Renames the `HotPod Yoga` test-fixture org to `Acme Medspa` across 7 sites (the source of the leaked tenant brand).
- Adds two copy-hygiene CI guards (dashboard scan + api rendered-response walk) that prevent reintroduction.

## Spec

- `docs/superpowers/specs/2026-05-16-cockpit-vertical-copy-design.md`

## Commits

1. `docs(cockpit): update umbrella spec to medspa vertical copy` (9 illustrative-copy edits)
2. `fix(cockpit): swap tours and tenant copy for medspa equivalents` (7 production string changes)
3. `test(cockpit): align fixtures with new medspa copy + rename HotPod org fixture` (8 test files updated)
4. `test(cockpit): add copy-hygiene regression coverage` (2 new tests)

## Out of scope

- `Service.bookingBehavior` and `consultationRequired` (already medspa-aware)
- `avgValueCents` field name (engineer-only)
- Activity-row "Tell Alex about X" (separate agent-name hardcoding concern)
- Riley copy (separate vertical mapping if/when needed)
- Lifting `ALEX_ROLE` / `ALEX_PIPELINE` into `AgentRoster.config` (premature without a 2nd vertical)
- `packages/core/src/agent-home/__tests__/metrics-types.test.ts:28` (engineer-only by the principle)

## Test plan

- [x] `pnpm reset && pnpm typecheck && pnpm lint && pnpm test` — all green locally
- [x] `pnpm --filter @switchboard/dashboard build` — exit 0
- [x] `pnpm format:check` — clean
- [x] New hygiene tests pass on first run after the cleanup

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Capture the PR URL and report back**

Confirm the PR opened. Note the PR number and URL. Confirm CI is running (do not wait for it to complete — review the PR list of changed files and confirm it matches the spec's expected file list).

---

## Self-review notes

- All 7 production string changes covered (Task 2, Steps 1-5).
- All 9 spec doc edits covered (Task 1, Steps 1-9).
- All 8 test fixture files covered (Task 3, Step 1 — substitution list applied to each).
- Both new hygiene tests covered (Task 4, Steps 1-5).
- Pre-merge gates from spec covered (Task 5, Steps 1-6).
- Push + PR open with no-`--auto` covered (Task 5, Step 7).
- The `HotPod Yoga` → `Acme Medspa` rename is captured in Task 3, Step 1 substitution list (entries 5 and 6).
- The hygiene-test self-exclusion (the `SELF_BASENAME` filter) is captured in Task 4, Step 1.
- The 5-phrase ban list in both tests matches the spec.

If the engineer hits a snag not covered above (e.g. a stale snapshot file, an unexpected import error after a string change), they should treat it as a normal debugging task — read the failure, fix the root cause, do not skip pre-merge gates.
