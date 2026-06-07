# README Brand Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the public GitHub README (and the GitHub-facing brand surface around it) to match the revised revenue-loop north star, with every capability claim verified against origin/main.

**Architecture:** Three small PRs to `main`, ordered so no intermediate state has broken links: (A) community-health files (SECURITY.md, CONTRIBUTING.md), (B) full README rewrite plus license posture, (C) package.json descriptions. Repo metadata (description/topics) is set via `gh` directly, no PR. All work happens in a fresh worktree off `origin/main` because the receipts machinery (Receipt model, calendar-receipt minting, Stripe deposit links) exists on origin/main but NOT on older branches.

**Tech Stack:** Markdown, prettier (`pnpm format:check` gates CI), commitlint (lowercase subject), `gh` CLI.

**Inputs:** 9-agent brand audit (2026-06-07, all 4 critical/high accuracy findings adversarially verified). Decisions locked by Jason 2026-06-07: proprietary license (remove MIT claim), name the wedge plainly (SG/MY aesthetic clinics on WhatsApp), scope = README + companion files.

---

## Audit findings this plan implements

| #   | Finding (severity)                                                                                | Resolution                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MIT claimed, no LICENSE file exists (critical)                                                    | Proprietary notice in README + `"license": "UNLICENSED"` in root package.json (Task 3)                                                                              |
| 2   | Shipped receipted-bookings machinery absent from README (critical)                                | "Real today" section cites Receipt model, calendar-receipt minting, Stripe deposit links (Task 3)                                                                   |
| 3   | "Why Switchboard Outperforms Human Operators" uses rejected worker-replacement framing (critical) | Replaced with "What the governance buys the owner" co-pilot section (Task 3)                                                                                        |
| 4   | Revenue loop / wedge / Riley / Mira appear nowhere (critical)                                     | New loop diagram, wedge section, three-operators section (Task 3)                                                                                                   |
| 5   | "Production-grade" ad optimization + "CAPI shipping data" overclaims (high, verified)             | Honest "real / gated off / next" maturity section (Task 3)                                                                                                          |
| 6   | Three contradictory taglines across README/DOCTRINE/ARCHITECTURE (critical)                       | README leads with owner outcome, keeps "governed operating system" as substrate line consistent with DOCTRINE; ARCHITECTURE.md rewrite logged as follow-up (Task 6) |
| 7   | No SECURITY.md / CONTRIBUTING.md on a public PII-handling repo (high)                             | Task 1, Task 2                                                                                                                                                      |
| 8   | All 11 package.json files lack descriptions (high)                                                | Task 4                                                                                                                                                              |
| 9   | Empty GitHub description/topics (high)                                                            | Task 5                                                                                                                                                              |
| 10  | `.audit/` pointer stale, blockers live in `docs/audits/` (medium)                                 | New README points to `docs/audits/` (Task 3)                                                                                                                        |
| 11  | Em-dash AI tell in prose (low, user brand rule)                                                   | New copy contains zero em-dashes; verification step greps for them (Task 3)                                                                                         |
| 12  | Maturity-honesty voice is a strength (low)                                                        | Preserved: "We do not claim a capability is live unless it is" + component citations (Task 3)                                                                       |

**Explicitly NOT in scope** (logged in Task 6): ARCHITECTURE.md stale opening ("AI Agent Marketplace with trust-based pricing"), architecture.svg regeneration, review of already-committed strategy docs (Riley autonomy-moat spec, competitor teardowns), DEPLOYMENT-CHECKLIST gym/commerce skin list.

---

## File structure

```
Create: SECURITY.md                                  (PR-A) disclosure path, scope
Create: CONTRIBUTING.md                              (PR-A) setup/dev/docker/testing moved out of README
Rewrite: README.md                                   (PR-B) ~140 lines, revenue-loop framing
Modify: package.json                                 (PR-B) add "license": "UNLICENSED" + description
Modify: packages/{schemas,sdk,cartridge-sdk,creative-pipeline,ad-optimizer,core,db}/package.json  (PR-C) descriptions
Modify: apps/{api,chat,dashboard}/package.json       (PR-C) descriptions
No file: gh repo edit for description + topics       (Task 5)
```

---

### Task 0: Worktree off origin/main

The current checkout (`docs/production-env-checklist`) is ~88 commits behind origin/main and predates the Receipt model. README claims MUST be authored and verified against origin/main.

- [ ] **Step 1: Create the worktree**

```bash
git -C /Users/jasonli/switchboard fetch origin
git -C /Users/jasonli/switchboard worktree add ../switchboard-readme-revision -b docs/community-health-files origin/main
cd /Users/jasonli/switchboard/../switchboard-readme-revision
pnpm worktree:init
```

If Postgres is down, `pnpm worktree:init` degrades; that is fine for docs-only work, but run `pnpm install` manually so prettier is available.

- [ ] **Step 2: Verify the receipts machinery exists here (sanity gate for README claims)**

```bash
grep -n "model Receipt" packages/db/prisma/schema.prisma
grep -n "buildCalendarReceiptData" packages/core/src/skill-runtime/tools/calendar-book.ts
ls packages/core/src/receipts/ packages/schemas/src/receipt.ts
```

Expected: `model Receipt` found (~line 2081), the import found (~line 14), both paths exist. If any of these fail, STOP: you are not on origin/main and every maturity claim in Task 3 would be wrong.

---

### Task 1: SECURITY.md (PR-A, part 1)

**Files:**

- Create: `SECURITY.md`

- [ ] **Step 1: Write SECURITY.md**

```markdown
# Security Policy

Switchboard handles clinic customer contact data, calendar credentials, and payment references. We take reports seriously and respond fast.

## Reporting a vulnerability

Please do not open a public issue for security reports.

Email **jasonljc@live.com** with:

- A description of the issue and where it lives (file path or endpoint)
- Reproduction steps or a proof of concept
- Impact as you understand it

You will get an acknowledgement within 72 hours. Please give us a reasonable window to remediate before any public disclosure.

## Scope notes

- Connection credentials are encrypted at rest (`packages/db`, credential encryption layer).
- Every mutating action passes a single ingress and governance gate (`packages/core/src/platform/`); bypass paths are architecture violations and in scope.
- The audit trail is hash-chained (`packages/core/src/platform/work-trace-integrity.ts`); anything that lets an actor rewrite history without detection is in scope.

There is no bug bounty program at this time.
```

- [ ] **Step 2: Verify formatting**

```bash
pnpm exec prettier --check SECURITY.md
```

Expected: passes (fix with `pnpm exec prettier --write SECURITY.md` if not).

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add security policy with private disclosure path"
```

---

### Task 2: CONTRIBUTING.md (PR-A, part 2)

**Files:**

- Create: `CONTRIBUTING.md` (content moved from README.md lines 84-218 + 230-244, lightly edited; README itself is trimmed in Task 3, so brief duplication between PR-A and PR-B is expected and harmless)

- [ ] **Step 1: Write CONTRIBUTING.md**

Copy the following sections out of the CURRENT README.md on this branch, preserving their text exactly except where noted:

```markdown
# Contributing to Switchboard

Switchboard is a TypeScript monorepo (pnpm workspaces, Turborepo). The codebase is organized by dependency layer; circular dependencies are forbidden. Architectural rules live in [docs/DOCTRINE.md](docs/DOCTRINE.md).

## Prerequisites

<verbatim: README "Prerequisites" subsection, including the macOS brew/createdb block>

## First-time setup

<verbatim: README "First-time local setup" section (the pnpm local:setup block, the Postgres-down caveat, and the SYNC-FROM-ROOT env note), followed by the manual "Setup" subsection (git clone through pnpm build)>

## Development

<verbatim: README "Development" subsection including the chat channel-token warning and the "Watching dev readiness" pnpm dev:ready subsection>

## Working with the database

<verbatim: README "Working with the database" subsection>

## Docker

<verbatim: README "Docker" subsection>

## Testing

<verbatim: README "Testing" subsection>

## API surface

All business actions enter through `PlatformIngress` and require the `Idempotency-Key` header. Endpoint documentation lives in Swagger UI at `/docs` on a running API (port 3000).

## Conventions

- Conventional Commits, enforced by commitlint (subject must start lowercase)
- Every new module ships with co-located tests (`*.test.ts`)
- Run `pnpm test`, `pnpm typecheck`, and `pnpm format:check` before pushing (CI lint runs prettier; local lint does not)
- Schema changes require a migration in the same commit (`pnpm db:check-drift` to validate)
- No `console.log`, no `any`, ESM only with `.js` extensions in relative imports (except Next.js)
```

Where the markers say `<verbatim: ...>`, paste the referenced README section content unchanged. Do not paraphrase command blocks.

- [ ] **Step 2: Verify formatting and that every command block survived the move**

```bash
pnpm exec prettier --check CONTRIBUTING.md
grep -c "pnpm" CONTRIBUTING.md
```

Expected: prettier passes; pnpm appears 25+ times (the setup/dev/test commands all moved over).

- [ ] **Step 3: Commit and open PR-A**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add contributing guide, moving setup detail out of readme"
git push -u origin docs/community-health-files
gh pr create --base main --title "docs: add SECURITY.md and CONTRIBUTING.md" --body "$(cat <<'EOF'
Community-health files for the public repo, extracted per the 2026-06-07 brand audit:

- SECURITY.md: private disclosure path (no public issues), scope notes on credential encryption / single ingress / hash-chained audit trail
- CONTRIBUTING.md: all setup, development, database, Docker, and testing content moved verbatim from README (README slims down in the follow-up PR)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 3: README rewrite + license posture (PR-B)

**Files:**

- Rewrite: `README.md` (full replacement, target ~140 lines)
- Modify: `package.json` (root: add `description` and `license` fields)

- [ ] **Step 1: Branch off PR-A's head**

```bash
git checkout -b docs/readme-revenue-loop
```

(Stacked on `docs/community-health-files` so the CONTRIBUTING.md link resolves. Per stacked-PR doctrine: no `--delete-branch` on PR-A merge, and if PR-A squash-merges first, `git rebase --onto origin/main docs/community-health-files docs/readme-revenue-loop`.)

- [ ] **Step 2: Replace README.md with the following content, in full**

````markdown
# Switchboard

> Runs the booking and ad work for WhatsApp-first clinics, keeps an honest per-dollar ledger of what that work earned, and shifts budget toward what pays off.

Switchboard is built for aesthetic clinics in Singapore and Malaysia that book on WhatsApp and run without a practice-management system. It does the revenue work itself: an agent answers the lead and books the visit, every booking and payment mints a receipt, and the spend that produced each paid visit is tied back to its campaign so budget can move toward what works.

Under the hood it is a governed operating system for revenue actions: every mutating action enters one ingress, passes one governance gate, and lands in one tamper-evident record. The loop is the product. The governance is what makes the loop trustworthy.

## The revenue loop

​`
  ad spend (Meta, click-to-WhatsApp)
        |
        v
  WhatsApp conversation ............ Alex qualifies the lead, captures consent
        |
        v
  governed booking ................. one ingress, policy check, human approval when required
        |                            calendar receipt minted in the same database transaction
        v
  paid visit ....................... deposit link, payment receipt
        |
        v
  per-dollar ledger ................ which spend produced which paid visit
        |
        v
  reallocation ..................... Riley recommends moving budget; a human approves
        |
        '--> back to ad spend
​`

The weekly metric is paid visits attributed to their cause, reported honestly as a funnel: booked and externally verified, then held, then paid.

## Three operators, one loop

- **Alex** runs the conversation: qualifies the inbound WhatsApp lead, captures consent, and books into the clinic's real calendar through a governed mutation.
- **Riley** keeps the economic truth: ingests ad performance, ties paid visits back to the spend that produced them, and surfaces budget recommendations for human approval.
- **Mira** produces the creative: UGC-style ad content through an async pipeline, with mandatory approval before anything is published.

They are operators of one loop, not three products. None of them can act outside the governance gate.

## What is real today, what is gated off, what is next

Status describes code on `main`, not deployment. We do not claim a capability is live unless it is.

**Real today** (each ties to a component in the codebase):

- A single mutating chokepoint: `PlatformIngress.submit()` enforces idempotency, entitlement, and governance in one place (`packages/core/src/platform/platform-ingress.ts`).
- A hash-chained canonical record: every action becomes a `WorkTrace`, content-hashed and anchored to the audit ledger (`packages/core/src/platform/work-trace-integrity.ts`).
- Receipts as first-class rows: bookings mint a calendar receipt inside the same database transaction as the booking write (`packages/core/src/skill-runtime/tools/calendar-book.ts`), with a tiered evidence model (`packages/core/src/receipts/`).
- Deposit links: Stripe Connect checkout for booking deposits, with payment status retrieved from Stripe as the authority.
- Approval binding: what executes is byte-equivalent to what was approved (`packages/core/src/approval/`).
- Meta click-to-WhatsApp first-touch capture from signed webhooks, persisted at lead intake.
- Alex's WhatsApp-to-booking path wired end to end, in alpha. Launch blockers are tracked in `docs/audits/`.
- Riley's funnel and saturation analysis with daily and weekly audit jobs, producing recommendations for human review.

**Gated off by design** (built, dark until flipped):

- Riley's pause execution on Meta is capability-gated per organization; no production org is enabled.
- Every ad object Mira creates is `PAUSED` by construction; the Meta client refuses to set `ACTIVE`.
- Compliance gates (consent, claim scanning, messaging windows) run in observe mode during the enforcement bake.
- Meta Conversions API echo ships only when the pixel id and access token are configured.

**Next:** close the act-on-proof leg. Held and paid receipt coverage for the full funnel, then Riley's reallocation executing through the same governed ingress as everything else.

## What the governance buys the owner

These are properties of the architecture, not marketing. Each ties to a real component.

- **Nothing slips.** Every action is persisted in `WorkTrace`. No forgotten follow-ups.
- **Consistent judgment.** `GovernanceGate.evaluate()` applies the same identity, policy, and risk evaluation to action #1 and action #10,000.
- **You stay in control.** Approval is lifecycle state, not a side effect. Human escalation is first-class architecture, and the riskiest legs ship dark until you flip them.
- **Books you can trust.** Receipts are minted in the same transaction as the work they evidence, and the ledger is hash-chained. The system that does the work keeps the books.
- **Learning that compounds.** Decisions are outcome-linked, so policy changes are evaluated against history instead of tribal memory.
- **Always on.** Inbound leads get answered in seconds, around the clock, inside the same governed path.

## Under the hood

![Switchboard control plane](docs/assets/architecture.svg)

​`
Channel (WhatsApp / Telegram / Slack / API)
    |
    v
DeploymentResolver        resolve org + skill + trust context
    |
    v
PlatformIngress.submit()  normalize WorkUnit, enforce idempotency
    |
    v
GovernanceGate.evaluate() identity, policy, risk, approval routing
    |
    +--> EXECUTE ------------------+--> REQUIRE APPROVAL
    |                              |       human reviews, then dispatch
    v                              v
ExecutionMode dispatches work (skill tool-calling, async pipelines)
    |
    v
WorkTrace persisted       canonical lifecycle record
​`

For the architectural rules and invariants: [docs/DOCTRINE.md](docs/DOCTRINE.md). For the deep reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repo layout

​```
packages/
├── schemas/ Zod schemas & shared types (no internal deps)
├── sdk/ Agent manifest, handler interface, test harness
├── cartridge-sdk/ Legacy bridge, pending removal
├── creative-pipeline/ Creative content pipeline (async jobs via Inngest)
├── ad-optimizer/ Ad platform integration + optimization
├── core/ Platform ingress, governance, skill runtime
└── db/ Prisma ORM, stores, credential encryption

apps/
├── api/ Fastify REST API (port 3000)
├── chat/ Multi-channel chat ingress (port 3001)
└── dashboard/ Next.js operator console (port 3002)
​```

Organized by dependency layer; circular dependencies are forbidden. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## Getting started

​`bash
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm local:setup
​`

Requires Node 20+, pnpm 9, and PostgreSQL 17/18 with pgvector. Full setup, development, database, and testing docs: [CONTRIBUTING.md](CONTRIBUTING.md).

## Further reading

- [docs/DOCTRINE.md](docs/DOCTRINE.md) architectural rules and invariants
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) deep architectural reference
- [docs/OPERATIONS.md](docs/OPERATIONS.md) operator runbook
- [docs/DEPLOYMENT-CHECKLIST.md](docs/DEPLOYMENT-CHECKLIST.md) production deploy checklist
- [SECURITY.md](SECURITY.md) vulnerability disclosure
- [CONTRIBUTING.md](CONTRIBUTING.md) setup and contribution guide

## License

Copyright (c) 2026. All rights reserved.

The source is visible for evaluation and security review. No license is granted to use, copy, modify, or distribute this software, in whole or in part, without prior written permission.
​```

NOTE for the executor: the ​``` fences above shown with a zero-width marker are literal code fences in the final file; remove the marker. The final README contains exactly five fenced blocks (loop diagram, control-plane diagram, repo layout, getting-started bash, and none in License: the License section is plain prose, the last fence marker above closes the README content block).

- [ ] **Step 3: Verify every cited path in the new README exists on this branch**

```bash
for p in packages/core/src/platform/platform-ingress.ts \
         packages/core/src/platform/work-trace-integrity.ts \
         packages/core/src/skill-runtime/tools/calendar-book.ts \
         packages/core/src/receipts \
         packages/core/src/approval \
         docs/DOCTRINE.md docs/ARCHITECTURE.md docs/OPERATIONS.md \
         docs/DEPLOYMENT-CHECKLIST.md docs/assets/architecture.svg \
         CONTRIBUTING.md SECURITY.md; do
  [ -e "$p" ] && echo "OK  $p" || echo "MISSING  $p"
done
```
````

Expected: 12 lines of `OK`, zero `MISSING`.

- [ ] **Step 4: Verify zero em-dashes and the banned framings are gone**

```bash
grep -c "—" README.md
grep -ciE "outperforms|three revenue wedges|production-grade|MIT" README.md
```

Expected: `0` for both (grep -c returns 0 / exits 1 when no matches; that is the pass condition).

- [ ] **Step 5: Add root package.json description + license**

In `package.json` (root), add these two fields after `"name": "switchboard"`:

```json
  "description": "Governed revenue loop for WhatsApp-first clinics: booking and ad operations, receipts, and budget reallocation under one governance gate",
  "license": "UNLICENSED",
```

- [ ] **Step 6: Format check and commit**

```bash
pnpm exec prettier --check README.md package.json
git add README.md package.json
git commit -m "docs: rewrite readme around the revenue loop, fix license posture"
```

- [ ] **Step 7: Open PR-B (stacked on PR-A)**

```bash
git push -u origin docs/readme-revenue-loop
gh pr create --base docs/community-health-files --title "docs: rewrite readme around the revenue loop" --body "$(cat <<'EOF'
Full README revision per the 2026-06-07 nine-agent brand audit. Decisions locked with Jason: proprietary license, wedge named plainly, honest maturity register.

- Headline: owner-legible revenue loop (runs the work, keeps honest books, shifts budget), with "governed operating system" demoted to the substrate line
- New: revenue-loop diagram, SG/MY WhatsApp wedge, Alex/Riley/Mira as operators of one loop
- New: "real today / gated off / next" maturity section reflecting shipped Spec-1A receipts machinery; removes "Production-grade" and "CAPI shipping data" overclaims (audit-verified)
- Removed: "Why Switchboard Outperforms Human Operators" (rejected worker-replacement framing), Three Revenue Wedges table, API catalog (Swagger covers it), unbacked MIT claim
- Setup/dev/docker/testing detail moved to CONTRIBUTING.md (previous PR)
- Zero em-dashes in prose; component-citation voice preserved

DO NOT enable auto-merge: stacked on docs/community-health-files; retarget to main after PR-A merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Per stacked-PR doctrine: never `--auto` on a PR whose base is an unprotected branch.

---

### Task 4: Package descriptions (PR-C)

**Files:**

- Modify: `packages/schemas/package.json`, `packages/sdk/package.json`, `packages/cartridge-sdk/package.json`, `packages/creative-pipeline/package.json`, `packages/ad-optimizer/package.json`, `packages/core/package.json`, `packages/db/package.json`, `apps/api/package.json`, `apps/chat/package.json`, `apps/dashboard/package.json`

- [ ] **Step 1: Branch**

```bash
git checkout -b docs/package-descriptions docs/readme-revenue-loop
```

- [ ] **Step 2: Add a `"description"` field to each package.json, after its `"name"` field**

| File                                    | description value                                                |
| --------------------------------------- | ---------------------------------------------------------------- |
| packages/schemas/package.json           | `Zod schemas and shared types for the Switchboard platform`      |
| packages/sdk/package.json               | `Agent manifest, handler interface, and test harness`            |
| packages/cartridge-sdk/package.json     | `Legacy cartridge interface (bridge only, pending removal)`      |
| packages/creative-pipeline/package.json | `Creative content pipeline with async jobs via Inngest`          |
| packages/ad-optimizer/package.json      | `Ad platform integration and budget optimization`                |
| packages/core/package.json              | `Platform ingress, governance, skill runtime, and orchestration` |
| packages/db/package.json                | `Prisma ORM, store implementations, and credential encryption`   |
| apps/api/package.json                   | `Fastify REST API: platform ingress and governance surface`      |
| apps/chat/package.json                  | `Multi-channel chat ingress: Telegram, WhatsApp, Slack`          |
| apps/dashboard/package.json             | `Next.js operator console and deployment controls`               |

- [ ] **Step 3: Verify all 11 (10 + root from Task 3) now have descriptions, and nothing broke**

```bash
for f in package.json packages/*/package.json apps/*/package.json; do
  node -e "const p=require('./$f'); console.log(p.description ? 'OK  $f' : 'MISSING  $f')"
done
pnpm exec prettier --check packages/*/package.json apps/*/package.json
```

Expected: 11 `OK`, zero `MISSING`, prettier passes. (Descriptions do not affect builds; no build run needed.)

- [ ] **Step 4: Commit and open PR-C**

```bash
git add packages/*/package.json apps/*/package.json
git commit -m "chore: add descriptions to all workspace package.json files"
git push -u origin docs/package-descriptions
gh pr create --base docs/readme-revenue-loop --title "chore: add workspace package descriptions" --body "$(cat <<'EOF'
Adds one-line descriptions to all 10 workspace package.json files (root landed with the README PR), matching the codebase-map roles. Part of the 2026-06-07 brand-surface cleanup.

DO NOT enable auto-merge: stacked; retarget after parents merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 5: GitHub repo metadata (no PR)

- [ ] **Step 1: Set description and topics**

```bash
gh repo edit jsonljc/switchboard \
  --description "Governed AI operations for WhatsApp-first clinics: runs the booking and ad work, keeps an honest per-dollar ledger of what it earned, and shifts budget toward what pays." \
  --add-topic typescript --add-topic monorepo --add-topic ai-agents \
  --add-topic whatsapp --add-topic governance --add-topic revenue-operations
```

- [ ] **Step 2: Verify**

```bash
gh repo view jsonljc/switchboard --json description,repositoryTopics
```

Expected: description set, 6 topics listed.

---

### Task 6: Log follow-ups (do not implement here)

- [ ] **Step 1: Append to the post-launch backlog** (per memory, audit index is primary; this is non-audit so extract): add these four items wherever the backlog lives, each one line:

1. Rewrite `docs/ARCHITECTURE.md:7-9` opening: "AI Agent Marketplace with trust-based pricing" + autonomy/pricing tiers is stale and contradicts the north star (and the trust ramp it describes is computed-then-discarded per the governance trust-path map).
2. Disclosure review of committed strategy docs: Riley autonomy-moat spec, competitor teardowns, and the Mira audit (creative-QA candor) are public; decide archive/redact/accept. Keep the north-star architecture map untracked or private.
3. `docs/assets/architecture.svg`: demote the Cartridge lane, consider showing the loop closing back (WorkTrace outcomes to Riley reallocation); reconcile "Cartridge · Workflow" vs README mode names.
4. `docs/DEPLOYMENT-CHECKLIST.md:84-85` gym/commerce/generic skin list implies a horizontal product; prune if those verticals are dead.

---

## Self-review (completed at planning time)

- **Coverage:** all 12 implemented findings map to tasks (table above); the 4 out-of-scope items are logged in Task 6.
- **Placeholders:** the only intentional indirection is `<verbatim: ...>` markers in Task 2, which name exact source sections of the current README to copy unchanged; all new copy is written out in full.
- **Consistency:** branch names referenced in Tasks 0/3/4 match (`docs/community-health-files` → `docs/readme-revenue-loop` → `docs/package-descriptions`); the README's CONTRIBUTING/SECURITY links depend on PR-A, which is why the stack is ordered A → B → C.
- **Hazards encoded:** stacked-squash rebase instruction, no auto-merge on unprotected bases, commitlint lowercase subjects, prettier-in-CI check, worktree-off-origin/main gate (Task 0 Step 2 hard-stops if the receipts machinery is absent).
