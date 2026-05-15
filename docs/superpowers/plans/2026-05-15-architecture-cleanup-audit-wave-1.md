# Architecture Cleanup Audit — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute Wave 1 of the parallel architecture/codebase audit defined in `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`. Dispatch 18 read-only Explore subagents in 3 sequential batches (Batch A: 5 lanes, Batch B: 5 lanes, Batch C: 8 lanes), persist each lane's findings to its own report file, and produce a triaged synthesis doc that user reviews before any Wave 2 cleanup is approved.

**Architecture:** Sequential batches (A → B → C); within each batch, all lanes are dispatched in a single message with multiple `Agent` tool calls so they run in parallel. The orchestrating session re-baselines numeric assertions in a pre-dispatch step, dispatches each batch, persists each subagent's returned findings to a per-lane report file (subagents are read-only; orchestrator does all writes), performs lightweight per-batch synthesis, and at the end produces a final ranked backlog with severity-prioritized HEAD re-verification.

**Tech Stack:** Claude Code CLI with the `Agent` tool (`subagent_type: "Explore"`) for Wave 1 lanes; `Bash`, `Read`, and `Write` for orchestration; `git` + `gh` CLI for branch/PR management. No new dependencies.

**Precondition:** PR #544 (which carries both the spec and this plan) has merged to `main` before execution starts. The plan reads the spec for charter templates and severity ladder — both must be on `main`.

---

## Reference: Fully-Worked Agent Dispatch Example

Every lane is dispatched using the same prompt skeleton. Here is the **literal example** for lane 1 (`doctrine-compliance`). Use this as the template; for other lanes substitute the per-lane fields from the spec.

```ts
Agent({
  description: "Audit lane: doctrine-compliance",
  subagent_type: "Explore",
  prompt: `You are an Explore subagent dispatched as one lane of a parallel
architecture/codebase audit for the Switchboard monorepo at
/Users/jasonli/switchboard.

## Your lane

Name: doctrine-compliance
Charter: Audit that PlatformIngress is the sole mutating entry, WorkTrace is canonical persistence, approval is lifecycle state, and there are no bypass paths. Uses the .agent/skills/architecture-audit playbook.
Method hints: Read .agent/skills/architecture-audit/SKILL.md first. Use .agent/tools/check-routes for the route inventory. Grep for direct store writes that bypass PlatformIngress; flag any mutating handler that doesn't go through ingress.submit().
Scope exclusions: see spec §"Exclusion Masks" — paths under packages/core/src/**/riley*, packages/core/src/**/recommendation*, packages/schemas/src/recommendation*, .github/workflows/**, root package.json, turbo.json, .husky/**, apps/dashboard/next.config.mjs, and recent specs/plans in docs/superpowers/. For findings in those paths, tag Collides:yes (per spec's hard collision-tagging rule).
Existing-audit deltas: none (this is the primary doctrine lane).

## What to return

Return ONE markdown block in your reply matching this schema EXACTLY.
Do NOT write any files — you are read-only. The orchestrator will
persist your output.

# doctrine-compliance

**Charter:** <one sentence>
**Method:** <what you actually did — globs, greps, tools used — keep terse>
**Scope exclusions applied:** <list>

## Findings

### [SEV] <short-title>
- **Where:** <file:line>, <file:line>
- **Evidence:** <quote, count, or pattern — verbatim>
- **Why it matters:** <invariant / memory entry / doctrine rule violated>
- **Fix:** <one-liner OR "needs design">
- **Effort:** S / M / L
- **Risk if untouched:** <one line>
- **Collides with active work?:** <yes/no — if yes, name the branch>

(repeat per finding, sorted CRITICAL → HIGH → MED → LOW)

## Out of scope / deferred for this lane
- <notes>

## Token-cap note
If you have more than 150 findings, keep ALL CRITICAL and HIGH in the
main Findings list; move MED and LOW into an "## Overflow (truncated
to file:line)" section, ordered by file path. Never drop CRITICAL or
HIGH.

Severity ladder (also in spec):
- CRITICAL — architectural invariant violation, security issue, data loss risk
- HIGH — correctness bug, launch-blocker debt, broken contract
- MED — significant debt with concrete bite (perf, maintainability, drift)
- LOW — polish, minor consistency, documentation`
})
```

For other lanes, change `description`, the `Name:` line, `Charter:`, `Method hints:`, `Existing-audit deltas:`, and the heading `# <slug>` in the schema. Everything else is identical.

---

## Per-Lane Charter Reference

These are the exact values to substitute for each lane. Full charters in `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md` §"Wave 1 Lanes."

| # | Slug | Existing-audit delta? | Notes |
|---|------|----------------------|-------|
| 1 | `doctrine-compliance` | none | uses `.agent/skills/architecture-audit` |
| 2 | `layer-hygiene` | `docs/superpowers/specs/2026-05-13-circular-import-cleanup-design.md` + plan | report only NEW/REGRESSED circular deps |
| 3 | `route-chain-integrity` | none | uses `.agent/skills/route-chain-audit` + `.agent/tools/check-routes` |
| 4 | `surface-agnostic-backend` | none | core/schemas/db/ad-optimizer free of UI surface refs |
| 5 | `cartridge-sdk-removal-readiness` | none | wind-down inventory for `packages/cartridge-sdk` |
| 6 | `file-size-splits` | none | `.ts` >400/>600, plus `.tsx` and `.css` |
| 7 | `type-safety` | none | `any` / `as` / `@ts-ignore` across `.ts` + `.tsx`; measure fresh |
| 8 | `dead-code` | `.audit/08-launch-blocker-sequence.md` "Orphaned Stores" | sub-audits (a) Store call-sites, (b) general orphans |
| 9 | `lint-debt` | none | `.js` rule per-direction; prettier; console.log; etc. |
| 10 | `coverage-vs-threshold` | none | global 55/50/52/55, core 65/65/70/65 |
| 11 | `missing-co-located-tests` | none | new modules lacking sibling `*.test.ts` |
| 12 | `test-stability-inventory` | none | `.skip`/`.todo` + known flakes from memory |
| 13 | `prisma-hygiene` | `.audit/12-pre-launch-security-audit.md` TI-9 | index-name length + nullable orgId re-verify |
| 14 | `api-consistency` | none | cross-app type duplication shadowing `@switchboard/schemas` |
| 15 | `fixture-schema-alignment` | none | seed file rot + canonical agent names |
| 16 | `security-sweep-delta` | `.audit/12-pre-launch-security-audit.md` | FIXED/STILL-OPEN/REGRESSED/NEW classification |
| 17 | `deploy-infra-parity` | `.audit/08-launch-blocker-sequence.md` #18 | Inngest function bodies across 5 packages |
| 18 | `doctrine-architecture-drift` | none | `docs/DOCTRINE.md` + `docs/ARCHITECTURE.md` vs code |

**Charter text** for each lane: copy verbatim from the spec's numbered lane entry. The spec text IS the charter — do not paraphrase.

---

## Task 1: Set up execution worktree

**Files:**
- Create: a new git worktree at `.claude/worktrees/audit-wave-1-execution` on a new branch `audit/wave-1-execution-2026-05-15` branched from `main`

- [ ] **Step 1: Confirm main has the spec + plan merged**

Run:

```bash
cd /Users/jasonli/switchboard
git fetch origin
git log origin/main --oneline -5 | grep -E "(architecture-cleanup-audit|cleanup audit)" | head -3
```

Expected: at least two lines mentioning `architecture-cleanup-audit` (spec + plan commits from PR #544).

If empty: STOP. Merge PR #544 first.

- [ ] **Step 2: Create the worktree**

Run from the main repo directory:

```bash
cd /Users/jasonli/switchboard
git worktree add -b audit/wave-1-execution-2026-05-15 .claude/worktrees/audit-wave-1-execution main
```

Expected: `Preparing worktree (new branch 'audit/wave-1-execution-2026-05-15')` and `HEAD is now at <sha> <main's tip commit>`.

- [ ] **Step 3: Initialize the worktree**

Run from inside the new worktree:

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/audit-wave-1-execution
pnpm worktree:init
```

Expected: script copies `.env`, kills any stale dev-port listeners, and runs `pnpm db:migrate` only if Postgres is reachable. Non-zero exit is acceptable if Postgres is not running — this is a docs-only audit and migrations are not required.

- [ ] **Step 4: Verify branch context**

Run:

```bash
git branch --show-current
git status --short
```

Expected: branch is `audit/wave-1-execution-2026-05-15`; status is clean.

- [ ] **Step 5: No commit for this task** (worktree setup leaves no diff). Proceed to Task 2.

---

## Task 2: Pre-Dispatch Verification

**Files:**
- Create: `docs/audits/2026-05-15-cleanup/_pre-dispatch.md` (orchestrator-written; no subagent involved)

- [ ] **Step 1: Create the audit output directory**

Run from the worktree root:

```bash
mkdir -p docs/audits/2026-05-15-cleanup
```

Expected: directory exists.

- [ ] **Step 2: Capture the file-size baseline (lane 6)**

Run:

```bash
find packages apps -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.module.css' \) \
  ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.next/*' \
  -exec wc -l {} + 2>/dev/null \
  | awk '$1 > 400 && $2 != "total"' \
  | sort -rn > /tmp/audit-file-sizes.txt
wc -l /tmp/audit-file-sizes.txt
```

Expected: a file count and a non-empty `/tmp/audit-file-sizes.txt`.

- [ ] **Step 3: Capture the type-suppression baseline (lane 7)**

Run:

```bash
rg -c '@ts-ignore|@ts-expect-error|\bas any\b|: any\b' \
  apps/dashboard/src \
  --type ts --type tsx \
  2>/dev/null | sort > /tmp/audit-type-suppressions.txt || true
wc -l /tmp/audit-type-suppressions.txt
```

Expected: a non-empty `/tmp/audit-type-suppressions.txt` listing files with counts. If empty, the suppression scope is wider than expected — note this in the pre-dispatch doc.

- [ ] **Step 4: Capture the nullable orgId baseline (lane 13)**

Run:

```bash
rg 'organizationId\s+String\?' packages/db/prisma/schema.prisma --line-number > /tmp/audit-nullable-orgid.txt
wc -l /tmp/audit-nullable-orgid.txt
```

Expected: a count (likely 8–11) of nullable `organizationId String?` declarations.

- [ ] **Step 5: Capture the Inngest function inventory (lane 17)**

Run:

```bash
rg -l 'createFunction\(' --type ts packages apps > /tmp/audit-inngest-functions.txt
wc -l /tmp/audit-inngest-functions.txt
```

Expected: a list of files (~6–12) that contain `createFunction(` calls.

- [ ] **Step 6: Capture the exclusion-mask file lists per active branch**

Run:

```bash
for b in docs/local-readiness-spec docs/local-readiness-plan; do
  echo "== $b =="
  git diff main...origin/$b --name-only 2>/dev/null || echo "(no diff vs main — branch may be merged)"
done > /tmp/audit-exclusion-mask.txt
cat /tmp/audit-exclusion-mask.txt
```

Expected: per-branch file lists, or `(no diff vs main)` for already-merged branches.

- [ ] **Step 7: Write the consolidated `_pre-dispatch.md`**

Use the `Write` tool to create `docs/audits/2026-05-15-cleanup/_pre-dispatch.md` with this exact structure (substitute the actual counts and file lists from Steps 2–6):

```markdown
# Pre-Dispatch Verification — 2026-05-15

Baseline captured by orchestrator before Wave 1 dispatch. Subagents
measure fresh; this doc is a sanity reference, not gospel.

## Lane 6 — file-size baseline (>400 LOC, excluding node_modules/dist/.next)

<paste contents of /tmp/audit-file-sizes.txt, top 30 lines>

## Lane 7 — type suppressions in apps/dashboard/src

<paste contents of /tmp/audit-type-suppressions.txt>

Total files with at least one suppression: <count>
Total suppressions: <sum from the per-file counts>

## Lane 13 — nullable organizationId in schema.prisma

<paste contents of /tmp/audit-nullable-orgid.txt>

Total nullable organizationId fields: <line count>
(TI-9 in .audit/12-pre-launch-security-audit.md cited 11 — actual: <count>)

## Lane 17 — Inngest function locations

<paste contents of /tmp/audit-inngest-functions.txt>

Bootstrap registration site: apps/api/src/bootstrap/inngest.ts
(Function bodies live in the files above, NOT the bootstrap file.)

## Exclusion mask — file lists per active branch

<paste contents of /tmp/audit-exclusion-mask.txt>
```

- [ ] **Step 8: Commit**

Run:

```bash
git add docs/audits/2026-05-15-cleanup/_pre-dispatch.md
git commit -m "$(cat <<'EOF'
audit(wave-1): pre-dispatch baseline captured

Orchestrator-written baseline before dispatching the 18 read-only
Explore subagents. Subagents measure fresh; this is a sanity ref.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit with one file added.

---

## Task 3: Dispatch Batch A (5 lanes)

**Files:**
- Create: `docs/audits/2026-05-15-cleanup/doctrine-compliance.md`
- Create: `docs/audits/2026-05-15-cleanup/route-chain-integrity.md`
- Create: `docs/audits/2026-05-15-cleanup/layer-hygiene.md`
- Create: `docs/audits/2026-05-15-cleanup/api-consistency.md`
- Create: `docs/audits/2026-05-15-cleanup/security-sweep-delta.md`

- [ ] **Step 1: Read the spec's full lane definitions**

Use the `Read` tool on `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`. You need the charter text (the numbered lane entries 1, 2, 3, 14, 16) and the exclusion-mask section to populate each prompt.

- [ ] **Step 2: Construct 5 Agent dispatch calls in a single message**

Use the prompt skeleton from this plan's "Reference: Fully-Worked Agent Dispatch Example" section. For each of the 5 Batch A lanes, populate:

- `description`: `"Audit lane: <slug>"`
- `subagent_type`: `"Explore"`
- `prompt`: the template, with these per-lane substitutions:

For **lane 1 (`doctrine-compliance`)**: use the example as-is.

For **lane 3 (`route-chain-integrity`)**:
- Name: `route-chain-integrity`
- Charter: copy from spec §"Wave 1 Lanes" → lane 3
- Method hints: "Read `.agent/skills/route-chain-audit/SKILL.md`. Run `.agent/tools/check-routes` (or equivalent: `bash .agent/tools/check-routes`). Trace button → API route → store reachability. Flag broken chains, unimplemented handlers, no-op routes, missing audit-trail."
- Existing-audit deltas: none.

For **lane 2 (`layer-hygiene`)**:
- Name: `layer-hygiene`
- Charter: copy from spec lane 2
- Method hints: "Verify import boundaries between schemas → sdk → core → db → apps. Flag wrong-layer imports and barrel files with >40 exports."
- Existing-audit deltas: `docs/superpowers/specs/2026-05-13-circular-import-cleanup-design.md` and its plan are authoritative for circular deps — report only NEW or REGRESSED ones.

For **lane 14 (`api-consistency`)**:
- Name: `api-consistency`
- Charter: copy from spec lane 14
- Method hints: "Grep `apps/api`, `apps/dashboard`, `apps/chat` for local declarations of `ConversationState`, `ApprovalRecord`, `Handoff`, and any approval/lifecycle DTO that should live in `@switchboard/schemas`. Audit mutating routes for auth guards + idempotency + audit-trail coverage."
- Existing-audit deltas: none.

For **lane 16 (`security-sweep-delta`)**:
- Name: `security-sweep-delta`
- Charter: copy from spec lane 16
- Method hints: "Read `.audit/12-pre-launch-security-audit.md` headings. For each finding, classify FIXED / STILL-OPEN / REGRESSED / NEW with file:line evidence. Run `pnpm audit` for CVE delta. Out of scope: re-running OWASP from scratch."
- Existing-audit deltas: `.audit/12-pre-launch-security-audit.md` is authoritative — this lane reports the delta only.

Send all 5 `Agent` tool calls in **one message** so they run in parallel.

- [ ] **Step 3: Wait for all 5 subagent responses**

Each subagent returns a `# <slug>` markdown block in its reply.

- [ ] **Step 4: Persist each response to its report file**

For each of the 5 returned blocks, use the `Write` tool to create `docs/audits/2026-05-15-cleanup/<slug>.md` with the exact returned markdown as the file contents. **Do not edit the subagent's output** — preserve verbatim.

If any subagent returned malformed output (missing required schema sections), prepend a `<!-- ORCHESTRATOR NOTE: schema deviation, see raw above -->` comment but still persist the block. Do not silently fix it.

- [ ] **Step 5: Lightweight per-batch synthesis**

Run:

```bash
for f in docs/audits/2026-05-15-cleanup/{doctrine-compliance,route-chain-integrity,layer-hygiene,api-consistency,security-sweep-delta}.md; do
  echo "== $f =="
  grep -c '^### \[CRITICAL\]' "$f" 2>/dev/null | head -1 | xargs -I{} echo "  CRITICAL: {}"
  grep -c '^### \[HIGH\]' "$f" 2>/dev/null | head -1 | xargs -I{} echo "  HIGH: {}"
  grep -c '^### \[MED\]' "$f" 2>/dev/null | head -1 | xargs -I{} echo "  MED: {}"
  grep -c '^### \[LOW\]' "$f" 2>/dev/null | head -1 | xargs -I{} echo "  LOW: {}"
  grep -c 'Collides with active work?: yes' "$f" 2>/dev/null | head -1 | xargs -I{} echo "  Collision-tagged: {}"
done
```

Expected: per-file severity tallies. Note any obviously suspicious zero/high counts.

- [ ] **Step 6: Commit Batch A**

Run:

```bash
git add docs/audits/2026-05-15-cleanup/{doctrine-compliance,route-chain-integrity,layer-hygiene,api-consistency,security-sweep-delta}.md
git commit -m "$(cat <<'EOF'
audit(wave-1): Batch A — architecture & contracts (5 lanes)

Reports persisted from doctrine-compliance, route-chain-integrity,
layer-hygiene, api-consistency, security-sweep-delta Explore
subagents. Orchestrator-written; subagents are read-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit with 5 files added.

- [ ] **Step 7: Optional user check-in**

If running the first execution of this plan, pause here. Surface the severity tallies from Step 5 to the user. Ask: "Batch A complete. Continue to Batch B (code health), or pause to review?" If the user says continue, proceed. If they request changes (e.g., re-run a lane with different scope), apply the change before moving on.

For subsequent executions or if running unattended, skip this step.

---

## Task 4: Dispatch Batch B (5 lanes)

**Files:**
- Create: `docs/audits/2026-05-15-cleanup/dead-code.md`
- Create: `docs/audits/2026-05-15-cleanup/cartridge-sdk-removal-readiness.md`
- Create: `docs/audits/2026-05-15-cleanup/file-size-splits.md`
- Create: `docs/audits/2026-05-15-cleanup/type-safety.md`
- Create: `docs/audits/2026-05-15-cleanup/lint-debt.md`

- [ ] **Step 1: Read the spec's lane definitions for 5, 6, 7, 8, 9**

Use the `Read` tool on `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`. Lane numbers in the spec: dead-code is 8, cartridge-sdk is 5, file-size-splits is 6, type-safety is 7, lint-debt is 9.

- [ ] **Step 2: Construct 5 Agent dispatch calls in a single message**

Use the same template. Per-lane substitutions:

For **lane 8 (`dead-code`)**:
- Charter: copy from spec lane 8 (includes sub-audits a + b)
- Method hints: "(a) For each of the 15 Store classes in `packages/db/src/storage/`, grep external callers — zero-caller stores are HIGH. (b) Sweep `packages/` for orphan exports — surface only HIGH or above unless count is small. Use `pnpm depcheck` or `ts-prune` if available."
- Existing-audit deltas: `.audit/08-launch-blocker-sequence.md` "Orphaned Stores in db layer" entry — verify whether each entry there is still orphaned or has been resolved.

For **lane 5 (`cartridge-sdk-removal-readiness`)**:
- Charter: copy from spec lane 5
- Method hints: "Run `rg -l '@switchboard/cartridge-sdk' --type ts packages apps | head -50` to enumerate consumers. Classify each: HARD-BLOCKER (core uses, prod code path), SOFT (test-only, fixture), TRIVIAL (dead export). Propose removal order."
- Existing-audit deltas: none.

For **lane 6 (`file-size-splits`)**:
- Charter: copy from spec lane 6
- Method hints: "Use the pre-dispatch baseline at `docs/audits/2026-05-15-cleanup/_pre-dispatch.md` as your starting list. Verify each file's current LOC. Propose split lines for files >600 (error threshold). `.tsx` and `.css` are in scope (arch-check ignores them — per `feedback_arch_check_ts_only`)."
- Existing-audit deltas: none.

For **lane 7 (`type-safety`)**:
- Charter: copy from spec lane 7
- Method hints: "Measure fresh — do not trust prior estimates. Scan `apps/**/src/**/*.{ts,tsx}` (not `.next/`). Categorize: `: any`, `as any`, `@ts-ignore`, `@ts-expect-error`. Cross-reference `apps/api` and `auth.ts` exceptions from CLAUDE.md."
- Existing-audit deltas: none.

For **lane 9 (`lint-debt`)**:
- Charter: copy from spec lane 9
- Method hints: "Run `pnpm format:check` and capture violations. Grep for `console.log` (not `console.warn`/`console.error`). Verify `.js` extension rule per-direction: dashboard imports must OMIT `.js`; other packages must INCLUDE `.js` (per `feedback_dashboard_no_js_on_any_import`)."
- Existing-audit deltas: none.

Send all 5 `Agent` calls in one message.

- [ ] **Step 3: Wait for all 5 responses**

- [ ] **Step 4: Persist each response to its report file**

For each of the 5 returned blocks, use the `Write` tool to create `docs/audits/2026-05-15-cleanup/<slug>.md` with the exact returned markdown as the file contents. **Do not edit the subagent's output** — preserve verbatim.

If any subagent returned malformed output (missing required schema sections), prepend a `<!-- ORCHESTRATOR NOTE: schema deviation, see raw above -->` comment but still persist the block. Do not silently fix it.

- [ ] **Step 5: Lightweight per-batch synthesis**

Run the severity-tally loop for Batch B slugs:

```bash
for f in docs/audits/2026-05-15-cleanup/{dead-code,cartridge-sdk-removal-readiness,file-size-splits,type-safety,lint-debt}.md; do
  echo "== $f =="
  for sev in CRITICAL HIGH MED LOW; do
    c=$(grep -c "^### \[$sev\]" "$f" 2>/dev/null || echo 0)
    echo "  $sev: $c"
  done
  c=$(grep -c 'Collides with active work?: yes' "$f" 2>/dev/null || echo 0)
  echo "  Collision-tagged: $c"
done
```

- [ ] **Step 6: Commit Batch B**

```bash
git add docs/audits/2026-05-15-cleanup/{dead-code,cartridge-sdk-removal-readiness,file-size-splits,type-safety,lint-debt}.md
git commit -m "$(cat <<'EOF'
audit(wave-1): Batch B — code health & cleanup readiness (5 lanes)

Reports persisted from dead-code, cartridge-sdk-removal-readiness,
file-size-splits, type-safety, lint-debt Explore subagents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Optional user check-in**

If running the first execution of this plan, pause here. Surface the severity tallies from Step 5 to the user. Ask: "Batch B complete. Continue to Batch C (data/infra/tests/docs), or pause to review?" If the user says continue, proceed. If they request changes (e.g., re-run a lane with different scope), apply the change before moving on.

For subsequent executions or if running unattended, skip this step.

---

## Task 5: Dispatch Batch C (8 lanes)

**Files:**
- Create: `docs/audits/2026-05-15-cleanup/prisma-hygiene.md`
- Create: `docs/audits/2026-05-15-cleanup/fixture-schema-alignment.md`
- Create: `docs/audits/2026-05-15-cleanup/deploy-infra-parity.md`
- Create: `docs/audits/2026-05-15-cleanup/coverage-vs-threshold.md`
- Create: `docs/audits/2026-05-15-cleanup/missing-co-located-tests.md`
- Create: `docs/audits/2026-05-15-cleanup/test-stability-inventory.md`
- Create: `docs/audits/2026-05-15-cleanup/surface-agnostic-backend.md`
- Create: `docs/audits/2026-05-15-cleanup/doctrine-architecture-drift.md`

- [ ] **Step 1: Read the spec's lane definitions for 4, 10, 11, 12, 13, 15, 17, 18**

- [ ] **Step 2: Construct 8 Agent dispatch calls in a single message**

Use the same template. Per-lane substitutions:

For **lane 13 (`prisma-hygiene`)**:
- Charter: copy from spec lane 13 (includes index-name + TI-9 sub-audits)
- Method hints: "List every `@@index` / `@@unique` in `packages/db/prisma/schema.prisma`; flag pre-truncation names >63 chars and propose the Prisma-truncated canonical (per `feedback_prisma_index_name_63_char_limit`). For each nullable `organizationId String?` field, re-verify against TI-9 in `.audit/12-pre-launch-security-audit.md` and classify orphan-row risk vs intentional null. Run `pnpm db:check-drift` if Postgres is reachable."
- Existing-audit deltas: `.audit/12-pre-launch-security-audit.md` TI-9 for nullable orgId.

For **lane 15 (`fixture-schema-alignment`)**:
- Charter: copy from spec lane 15
- Method hints: "Read `packages/db/prisma/seed-marketplace.ts` and `packages/db/prisma/seed.ts`. Verify (a) seed runs against current schema (try `pnpm db:seed` if Postgres reachable), (b) demo agent slugs match Alex/Riley/Mira — no `nova`/`jordan`, (c) no references to removed columns or stale enums."
- Existing-audit deltas: none.

For **lane 17 (`deploy-infra-parity`)**:
- Charter: copy from spec lane 17 (includes Inngest sub-audit)
- Method hints: "Use the Inngest function inventory from `_pre-dispatch.md`. For each `createFunction` call found, verify presence of `onFailure` handler and a DLQ path. **Delta against** `.audit/08-launch-blocker-sequence.md` launch-blocker #18 (creative-pipeline `retries: 3` with no DLQ) — confirm whether resolved. Also: diff `.env.example` against deployed Vercel/Render env (best-effort via `infra/` config); check Sentry coverage."
- Existing-audit deltas: `.audit/08-launch-blocker-sequence.md` #18 for DLQ.

For **lane 10 (`coverage-vs-threshold`)**:
- Charter: copy from spec lane 10
- Method hints: "Read each `vitest.config.ts` in `packages/*` and `apps/*`. Compare configured thresholds against actual coverage. Global: 55/50/52/55. Core: 65/65/70/65. Flag packages below threshold (regression) AND packages whose threshold has crept up without explicit update."
- Existing-audit deltas: none.

For **lane 11 (`missing-co-located-tests`)**:
- Charter: copy from spec lane 11
- Method hints: "For each `.ts` file in `packages/**/src/` (excluding `index.ts`, `*.types.ts`, type-only files), verify a sibling `*.test.ts` exists. Recent modules without tests are higher priority than legacy gaps."
- Existing-audit deltas: none.

For **lane 12 (`test-stability-inventory`)**:
- Charter: copy from spec lane 12
- Method hints: "Run `rg '(\\.skip|\\.skipIf|\\.todo|it\\.skip|describe\\.skip|test\\.skip)' --type ts --line-number` across the repo. For each hit, capture file:line + the surrounding test name. Cross-reference auto-memory's known-flake list (`prisma-work-trace-store-integrity`, `prisma-greeting-signal-store`, `prisma-ledger-storage`). Triage each: quarantine OK / needs fix / delete."
- Existing-audit deltas: none.

For **lane 4 (`surface-agnostic-backend`)**:
- Charter: copy from spec lane 4
- Method hints: "Grep `packages/core`, `packages/schemas`, `packages/db`, `packages/ad-optimizer` for references to dashboard surfaces, UI route names, or Mercury/editorial register identifiers. Per `feedback_surface_agnostic_backend`, backend must be surface-free."
- Existing-audit deltas: none.

For **lane 18 (`doctrine-architecture-drift`)**:
- Charter: copy from spec lane 18
- Method hints: "Read `docs/DOCTRINE.md` and `docs/ARCHITECTURE.md`. For each claim in each doc, verify against current code state. Flag claims that no longer hold."
- Existing-audit deltas: none.

Send all 8 `Agent` calls in one message.

- [ ] **Step 3: Wait for all 8 responses**

- [ ] **Step 4: Persist each response to its report file**

For each of the 8 returned blocks, use the `Write` tool to create `docs/audits/2026-05-15-cleanup/<slug>.md` with the exact returned markdown as the file contents. **Do not edit the subagent's output** — preserve verbatim.

If any subagent returned malformed output (missing required schema sections), prepend a `<!-- ORCHESTRATOR NOTE: schema deviation, see raw above -->` comment but still persist the block. Do not silently fix it.

- [ ] **Step 5: Lightweight per-batch synthesis**

```bash
for f in docs/audits/2026-05-15-cleanup/{prisma-hygiene,fixture-schema-alignment,deploy-infra-parity,coverage-vs-threshold,missing-co-located-tests,test-stability-inventory,surface-agnostic-backend,doctrine-architecture-drift}.md; do
  echo "== $f =="
  for sev in CRITICAL HIGH MED LOW; do
    c=$(grep -c "^### \[$sev\]" "$f" 2>/dev/null || echo 0)
    echo "  $sev: $c"
  done
  c=$(grep -c 'Collides with active work?: yes' "$f" 2>/dev/null || echo 0)
  echo "  Collision-tagged: $c"
done
```

- [ ] **Step 6: Commit Batch C**

```bash
git add docs/audits/2026-05-15-cleanup/{prisma-hygiene,fixture-schema-alignment,deploy-infra-parity,coverage-vs-threshold,missing-co-located-tests,test-stability-inventory,surface-agnostic-backend,doctrine-architecture-drift}.md
git commit -m "$(cat <<'EOF'
audit(wave-1): Batch C — data, infra, tests, docs (8 lanes)

Reports persisted from prisma-hygiene, fixture-schema-alignment,
deploy-infra-parity, coverage-vs-threshold, missing-co-located-tests,
test-stability-inventory, surface-agnostic-backend,
doctrine-architecture-drift Explore subagents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Synthesis — produce the ranked backlog

**Files:**
- Create: `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` (the synthesis doc — NOT the design doc, which is `-design.md`)

- [ ] **Step 1: Read all 18 lane reports**

Use the `Read` tool on each of the 18 files under `docs/audits/2026-05-15-cleanup/` (skip `_pre-dispatch.md`).

- [ ] **Step 2: Dedupe overlapping findings**

Maintain an in-memory list of `(severity, where, evidence-hash)` tuples. For each finding, if the same `(where, evidence-hash)` appears in multiple lane reports, keep the higher-severity record and note both source lanes. Specific known overlaps to watch for:

- `cartridge-sdk-removal-readiness` ∩ `dead-code` — cartridge-sdk dead exports
- `file-size-splits` ∩ `layer-hygiene` — barrel-file flags
- `security-sweep-delta` ∩ `api-consistency` — auth-related findings
- `prisma-hygiene` ∩ `security-sweep-delta` — TI-9 nullable orgId

- [ ] **Step 3: Re-verify evidence against HEAD with severity-prioritized depth**

For every CRITICAL and HIGH finding: open the cited file, confirm the line still matches the cited evidence (file moved? line shifted? pattern still present?). For each:
- If still matches: keep as-is.
- If file/line shifted but pattern still present: update the `Where:` reference.
- If pattern no longer present: tag the finding `STALE — re-snapshot before action` and keep in the backlog (do not silently drop).

For MED and LOW: do NOT re-verify at this stage. They will be re-verified at Wave 2 fix-PR creation time.

- [ ] **Step 4: Identify mechanical-sweep candidates**

Tag findings that meet ALL of these criteria as "mechanical-sweep eligible":
- Severity MED or LOW
- Fix one-liner is mechanical (prettier, import cleanup, console.log → console.warn, `.js` extension fix)
- Not collision-tagged
- Effort = S

These will be the suggested Track A bundle for Wave 2.

- [ ] **Step 5: Write the synthesis doc**

Use the `Write` tool to create `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` with this structure:

```markdown
# Architecture & Codebase Cleanup Audit — Synthesis

**Date:** <today, ISO-8601>
**Source:** Wave 1 of the audit plan at `docs/superpowers/plans/2026-05-15-architecture-cleanup-audit-wave-1.md`, dispatched against the design at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`.
**Lanes run:** 18 of 20 (`ci-gate-gaps` and `spec-plan-rot` deferred per design).
**Coverage:** <CRITICAL count> CRITICAL, <HIGH count> HIGH, <MED count> MED, <LOW count> LOW findings after dedupe.

## Top 10 by impact

<numbered list of CRITICAL → HIGH findings, with file:line, evidence, fix, effort, and lane source>

## Full ranked backlog

### CRITICAL
<list, with lane sources>

### HIGH
<list>

### MED
<list, possibly truncated to file:line if >150>

### LOW
<list, possibly truncated to file:line if >150>

## Mechanical-only sweep candidates (Track A pre-bundle)

<list of mechanical-sweep eligible findings — these can be bundled into a single Wave 2 Track A PR with user pre-authorization>

## Deferred-collision list

<findings whose `Where:` is in the exclusion mask; release-to-Wave-2 condition per item>

## Deferred lanes

- **ci-gate-gaps:** re-run after local-readiness PR-1 merges OR by 2026-05-29.
- **spec-plan-rot:** re-run after named workstreams merge OR by 2026-05-29 with narrower scope.

## Source reports

All raw findings live under `docs/audits/2026-05-15-cleanup/`:

- `_pre-dispatch.md` (orchestrator baseline)
- 18 per-lane reports (one per slug)

## Next step

User triages. For each approved item, follow Wave 2 procedure in the design doc:
- Track A (mechanical sweep) — single PR, optional pre-authorization.
- Track B (structural fix) — worktree per item at `.claude/worktrees/<slug>`, brainstorm → spec → plan if effort = L.
```

- [ ] **Step 6: Commit synthesis**

```bash
git add docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md
git commit -m "$(cat <<'EOF'
audit(wave-1): synthesis doc — ranked backlog

Top 10 + full backlog + mechanical-sweep candidates + deferred-
collision list, with severity-prioritized HEAD re-verification:
CRITICAL/HIGH fully re-verified; MED/LOW deferred to Wave 2.

Hard gate: Wave 2 is user-approved only. No autonomous cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Push and open PR for the audit artifact

**Files:**
- None new — PR over Tasks 2/3/4/5/6 commits.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin audit/wave-1-execution-2026-05-15
```

Expected: branch pushed; gh-cli URL printed.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "audit(wave-1): cleanup audit — pre-dispatch + 18 lane reports + synthesis" --body "$(cat <<'EOF'
## Summary

Wave 1 of the architecture/codebase cleanup audit defined in `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`. 18 read-only Explore subagents dispatched in 3 sequential batches (A: 5 lanes, B: 5 lanes, C: 8 lanes), each producing a structured findings report. Final synthesis doc produces a ranked backlog for user triage. Wave 2 (cleanup) is hard-gated on this PR being reviewed.

## What's in this PR

- `docs/audits/2026-05-15-cleanup/_pre-dispatch.md` — orchestrator baseline
- `docs/audits/2026-05-15-cleanup/<lane-slug>.md` × 18 — per-lane findings
- `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md` — synthesis + ranked backlog

## What's NOT in this PR

- No code changes. Wave 1 is discovery-only.
- 2 lanes deferred by design (`ci-gate-gaps`, `spec-plan-rot`) — re-run after 2026-05-29.

## Test plan

- [ ] Spot-check 3 random per-lane reports against the schema in the spec
- [ ] Verify CRITICAL/HIGH findings' file:line refs still match HEAD
- [ ] Confirm collision tags applied for any finding under the exclusion mask
- [ ] Read the synthesis doc top-10 — does the ranking match priorities?
- [ ] Approve or request lane re-runs before triaging Wave 2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Return the PR URL to the user**

The PR is the Wave 1 deliverable. The user reviews it, triages the synthesis-doc backlog, and decides what (if anything) advances to Wave 2.

---

## Done criteria for this plan

Wave 1 is complete when:

1. PR for the audit artifact is open against `main`.
2. 18 lane reports exist under `docs/audits/2026-05-15-cleanup/`.
3. Synthesis doc exists at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md`.
4. The 2 deferred lanes are recorded in the synthesis doc with their re-run conditions.
5. Severity-prioritized re-verification (CRITICAL/HIGH full, MED/LOW deferred) has been applied.

Wave 2 execution is a separate planning + implementation cycle, gated on user triage of this PR.
