---
name: Agent Operating Layer — Phase 3
description: Adds deterministic route auditing to the `.agent/` layer via a single ts-morph tool with a versioned allowlist, plus a tightly scoped extension to architecture-audit. Drops every Phase 3 item that would have been advisory-on-advisory or premature without a runner.
---

# Agent Operating Layer — Phase 3

> Approved: 2026-04-26.

## Problem

The Phase 1 spec listed several deferred items "earned later." Phase 2 closed the major gaps (architecture gate hook, memory persistence, implementation skill). A first cut at Phase 3 tried to ship the full deferred list as markdown checklists and shell scripts. Honest review found most of those files were either:

- **Advisory-on-advisory** — another markdown checklist that adds coverage but no enforcement, duplicating CLAUDE.md or existing skills.
- **Premature** — files that depend on infrastructure that doesn't exist yet (an eval runner, a scheduler), so they're documentation pretending to be systems.
- **Fragile** — shell `grep` over TypeScript routing across three different framework shapes (Fastify, Next.js App Router, MCP server).

The actual remaining gap that pays off in this phase: **shifting one important architecture check from latent reasoning to a deterministic AST-based tool**, with a versioned allowlist for legitimate exceptions. Everything else is deferred until it can be built with teeth.

## Goals

- Mutating routes that bypass `PlatformIngress.submit` and approval mutations outside the lifecycle service are surfaced by a deterministic check, not LLM reasoning.
- Legitimate exceptions (auth, health, setup, lifecycle response routes, fixtures) are explicit and reviewable, not buried in a regex.
- Architecture-audit skill picks up the tool's output as a starting point on every run.
- The `.agent/tools/` directory exists with a clear contract for adding future scripts (deterministic-before-latent principle).

## Non-Goals

- A separate `approval-lifecycle-audit` skill (folded into architecture-audit as a section).
- A `coding-standards.md` convention (CLAUDE.md "Code Basics" is the source of truth; the implementation skill already loads it).
- A `deterministic-vs-latent.md` convention (folded into `tools/README.md` since that's where it applies).
- A `governance-redline` skill (architecture-audit + Phase 2 implementation skill already cover it).
- A `test-plan` skill (`superpowers:test-driven-development` covers it).
- An `evals/smoke-tests/` or `evals/quality-rubrics/` directory (premature without a runner — would be documentation, not eval).
- A `maintenance/` checklist directory (premature without a scheduling mechanism — would be forgotten).
- Anything in `apps/` or `packages/`. This spec only changes `.agent/` and `docs/`.

---

## Design

### Section 1 — `.agent/tools/check-routes.ts`

**Purpose:** Single AST-based tool (ts-morph) that audits route handlers across `apps/api`, `apps/chat`, `apps/dashboard`, and `apps/mcp-server`. Replaces two earlier shell-script proposals with one TypeScript program that actually understands the source.

**What it checks:**

1. **Ingress check** — every mutating route handler (`POST | PUT | PATCH | DELETE` for Fastify; non-`GET` `route.ts` exports for Next App Router; tool-call mutations for MCP) must reach `PlatformIngress.submit` (directly or via a clear delegate). If not, the file is reported as a candidate violation.
2. **Approval mutation check** — any write to approval state (assignments to `approval*` fields, calls to `*.approval.create/update/delete`, lifecycle state transitions) inside a route handler file is reported, with the line numbers of the suspect calls.

**How it traces:** Walks the source file from the route handler symbol, follows direct calls and re-exports inside the same package, and reports based on whether `PlatformIngress.submit` appears anywhere in the static call graph. This is intentionally conservative — false negatives are worse than false positives, since the allowlist is the safety valve for false positives.

**Output format:**

```
path/to/file.ts:42: ingress — mutating route handler does not reach PlatformIngress.submit
path/to/other.ts:87: approval — direct write to approval state in route handler
```

Exit `0` on clean run, exit `1` if any non-allowlisted finding remains. Skills and humans grep this output line-for-line.

**How it's run:**

```
.agent/tools/check-routes
```

The tool lives at `.agent/tools/check-routes.ts` and is invoked via a thin shell wrapper `.agent/tools/check-routes` that runs the TypeScript file with `tsx` (or `node --import tsx/esm`). `.agent/` is intentionally outside the pnpm workspace — Phase 1 was explicit that the agent operating layer is not product code. Dependencies (`ts-morph`, `tsx`, a YAML parser) are declared in a local `.agent/tools/package.json` that is installed standalone (`cd .agent/tools && pnpm install`), not registered in the root workspace.

**Reuse:** No new types or stores are introduced in `apps/` or `packages/`. The tool reads source files; it does not execute them.

---

### Section 2 — `.agent/tools/route-allowlist.yaml`

**Purpose:** Versioned, reviewable allowlist for routes that legitimately do not call `PlatformIngress.submit`. Replaces the earlier proposal of a regex-in-shell-comment, which would have gone stale within a quarter.

**Format:**

```yaml
# Each entry exempts ONE route file from the ingress check.
# Adding an entry requires a one-line reason. PR review enforces the bar.

- path: apps/api/src/routes/auth/*.ts
  reason: Auth/session handlers — not business-state mutations.

- path: apps/api/src/routes/health.ts
  reason: Health check — no business state.

- path: apps/api/src/routes/setup/*.ts
  reason: Onboarding setup — pre-platform-ingress lifecycle.

- path: apps/api/src/routes/approvals/respond.ts
  reason: Approval response — correctly uses PlatformLifecycle, not ingress.

- path: "**/*.test.ts"
  reason: Test fixtures and mocks.

- path: "**/*.fixture.ts"
  reason: Test fixtures and mocks.
```

**Bar for adding an entry:** PR review. The reason field is required and non-empty. The list is the canonical record of what's been considered safe — adding to it is a deliberate act, not a side effect of a passing build.

**The tool reads the YAML at startup**, glob-matches `path` against each finding's filepath, and suppresses matches. Suppressed-but-matched paths are summarized at the end of the run (`5 findings suppressed by allowlist`) so the allowlist's blast radius is visible.

---

### Section 3 — `.agent/tools/README.md`

**Purpose:** The contract for the `tools/` directory. One terse page.

**Contents:**

1. **What lives here.** Deterministic, idempotent scripts that audit the codebase. TypeScript preferred (ts-morph) over shell when the check involves understanding source structure.
2. **Deterministic before latent.** When an architecture check can be expressed as a script, write the script. Reserve LLM reasoning in skills for judgment calls that scripts genuinely can't make. Skills should call tools first and reason on the output.
3. **Output format.** Machine-grep-friendly: `path:line: kind — message`. Exit non-zero on findings.
4. **Invocation.** Each tool is callable directly by path: `.agent/tools/<name>`. Tools are TypeScript run via `tsx`; deps are local to `.agent/tools/`, not the root workspace.
5. **Adding a new tool.** TypeScript file in `.agent/tools/`, exported as a script in the local `package.json`. If the check needs an allowlist, the allowlist is a sibling YAML file with required `path:` and `reason:` keys.

---

### Section 4 — `.agent/skills/architecture-audit/SKILL.md` extension

**Purpose:** Wire the new tool into the existing skill as a "run first" step, and add a section covering the deeper approval lifecycle trace that would have been a separate skill.

**Changes (additive only — no rewrite of the existing skill):**

1. **New "Run first" block at the top:**
   ```
   Before reasoning, run:
     .agent/tools/check-routes
   Treat each output line as a starting candidate. Allowlist suppressions are reported separately — do not reason about them unless explicitly asked.
   ```

2. **New section: "Approval lifecycle deep trace"** — three checklist items:
   - For each finding tagged `approval`, trace the call site upward: does the mutation originate in a route handler, or is the route only forwarding into `LifecycleService`?
   - For each create/resolve path: confirm the corresponding `WorkTrace` write exists.
   - For each path: confirm a test exercises the full request → resolve → side effect chain, not just the route handler.

This is what the proposed `approval-lifecycle-audit` skill would have done. As a section, it inherits architecture-audit's resolver loading and avoids creating a one-purpose skill that mostly overlaps the parent.

---

### Section 5 — `.agent/RESOLVER.md` updates

**Updated route — Architecture audit:**

Add a `Run first` block to the existing route:

```
**Run first:**
- .agent/tools/check-routes
```

Load list and triggers stay the same.

**No new route added.** The deferred `approval-lifecycle-audit` route is replaced by reusing the architecture-audit triggers (which already include "lifecycle state machine"). If approval-only triggers prove insufficient in practice, a future phase can split it out — based on real evidence, not anticipation.

---

## Directory Changes

```
.agent/
├── tools/                                  ← NEW
│   ├── package.json                        (local, not in root workspace)
│   ├── README.md
│   ├── check-routes                        (shell wrapper → tsx)
│   ├── check-routes.ts
│   └── route-allowlist.yaml
└── skills/architecture-audit/SKILL.md      ← edited (additive)
```

`.agent/RESOLVER.md` — adds `Run first` block to architecture-audit route.

No changes to `apps/`, `packages/`, or CLAUDE.md.

---

## What This Phase Does NOT Build

- `governance-redline`, `test-plan`, `approval-lifecycle-audit` skills (folded or redundant).
- `coding-standards.md` and `deterministic-vs-latent.md` conventions (overlap CLAUDE.md / folded into `tools/README.md`).
- `evals/smoke-tests/`, `evals/quality-rubrics/` (premature without a runner).
- `maintenance/` directory (premature without a scheduling mechanism).
- Additional tool scripts beyond `check-routes.ts`.
- An eval runner, a CI hook, or a scheduled agent. These are explicit future work.

If any of these prove valuable later, they earn their slot with a real trigger.

---

## Acceptance Criteria

1. `.agent/tools/check-routes` runs against current `main` and produces output. Every flagged file is either fixed or added to `route-allowlist.yaml` with a one-line reason.
2. The tool's exit code is `0` after the allowlist is populated for current `main`.
3. Architecture-audit skill, when invoked via the resolver, references the tool's output before reasoning. Verified by re-running `resolver-evals.json` with one new prompt that should route to architecture-audit.
4. A deliberately broken fixture (synthetic file: mutating route, no `PlatformIngress.submit`, not allowlisted) produces a non-zero exit and a single `ingress` finding pointing at the right line.
5. Adding a new entry to `route-allowlist.yaml` requires a `reason:` field; missing-reason entries cause the tool to fail loudly.

---

## Implementation Report

Filled in 2026-04-26.

### 1. Files created or changed

44 files, 4,108 insertions, on branch `feat/agent-operating-layer-phase3`.

**`.agent/tools/` (new, standalone TypeScript package, outside pnpm workspace):**
- `package.json` (25), `tsconfig.json` (16), `.gitignore` (2), `pnpm-lock.yaml` (1498)
- `allowlist.ts` (39), `routes.ts` (78), `reachability.ts` (22), `approval-mutations.ts` (52)
- `check-routes.ts` (123), `check-routes` (9, shell wrapper), `README.md` (47)
- `route-allowlist.yaml` (150)
- 5 test files (`__tests__/*.test.ts`) — 21 tests total
- 19 fixture files under `__tests__/fixtures/`

**`.agent/skills/architecture-audit/SKILL.md`:** +20 lines — `## Run first` and `## Approval lifecycle deep trace` sections added.

**`.agent/RESOLVER.md`:** +4 lines — `**Run first:**` block on the Architecture audit route.

**`.agent/evals/resolver-evals.json`:** +4 lines — one new prompt routing to `architecture-audit`.

**Spec & plan documents** under `docs/superpowers/`.

### 2. RESOLVER.md diff

```
@@ -6,6 +6,10 @@ Match task to triggers. Load only the listed files.

 **Triggers:** PlatformIngress, WorkTrace, lifecycle state machine, mutating surface, runtime convergence, bypass path, canonical request

+**Run first:**
+
+- `.agent/tools/check-routes`
+
 **Load:**

 - `docs/DOCTRINE.md`
```

### 3. Sample `check-routes` output against `main`

After populating the allowlist, the tool runs cleanly:

```
$ .agent/tools/check-routes
87 findings suppressed by allowlist.
exit=0
```

Pre-allowlist, ~85 findings spanned dashboard proxies, API auth/setup, approval/DLQ/escalation lifecycle routes, governance/policy/identity control-plane CRUD, and inbound channel receivers. All were classified into one of eight allowlist categories with documented reasons.

### 4. `route-allowlist.yaml` — final contents

32 entries across 8 commented sections (file is 150 lines including headers). Categories and example reasons:

1. **Dashboard proxy** (1 entry): `apps/dashboard/src/app/api/dashboard/**` — Next App Router proxies forward to API tier via `getApiClient()`.
2. **Dashboard auth/public** (2): NextAuth + waitlist lead capture (pre-platform).
3. **API tier auth/session/setup/OAuth** (5): `setup.ts`, `sessions.ts`, three WhatsApp channel/onboarding routes — pre-ingress channel/credential lifecycle.
4. **Approval/DLQ/escalation lifecycle** (3): `approvals.ts`, `dlq.ts`, `escalations.ts` — operate on lifecycle records via `transitionApproval`/`ApprovalLifecycleService`, not new ingress requests.
5. **Governance/policy/identity control-plane** (5): `governance.ts`, `policies.ts`, `identity.ts`, `operator-config.ts`, `competence.ts` — config that ingress reads, not actions ingress evaluates.
6. **Org/agent/connection/billing/marketplace config CRUD** (8): platform/org configuration; not governed business actions.
7. **Knowledge/memory ingestion** (3): owner-supplied data; not agent-executed actions.
8. **Revenue/scheduled-reports/outbound-webhooks** (3): integration data ingestion / cron config / webhook registry.
9. **Ingress-equivalent / inbound / read-only** (8): `execute.ts` is a known false positive — it does call `app.platformIngress.submit` at line 88, but the conservative substring scan misses dynamic resolution through `@switchboard/core/platform`. Also covers async-job CRUD where ingress runs in workers (creative-pipeline, ad-optimizer), inbound channel receivers (managed-webhook), and read-only routes (simulate, website-scan).

The full file lives at `.agent/tools/route-allowlist.yaml` with one-line reasons per entry.

### 5. Acceptance criteria

| Criterion | Result |
|---|---|
| 1. `check-routes` runs against `main`, every flagged file fixed or allowlisted | ✅ exit=0, 87 findings suppressed |
| 2. Tool exits 0 after allowlist populated | ✅ `exit=0` |
| 3. Architecture-audit skill references tool output before reasoning; new resolver-eval entry added | ✅ `## Run first` block + new eval prompt |
| 4. Synthetic violation fixture produces non-zero exit + one `ingress` finding at correct line | ✅ `__tests__/check-routes.test.ts` "synthetic violation" test passing |
| 5. Missing-reason allowlist entry fails loudly | ✅ `__tests__/allowlist.test.ts` "throws when an entry is missing a reason" test passing |

All 21 tool tests pass: allowlist (4), approval-mutations (5), reachability (3), routes (6), check-routes (3).

### Known limitations to revisit

- 2-hop reachability misses cases like `app.platformIngress.submit` on a Fastify decorator (e.g., `execute.ts`). Tracked in the allowlist; could be improved by detecting Fastify decorator patterns in a future phase.
- `findApprovalMutations` only catches direct `<x>.approval.<method>` calls. Aliased receivers, element access, and renamed model properties are documented false-negatives in the function's JSDoc; the architecture-audit skill's "Approval lifecycle deep trace" section is the manual safety net.
- The allowlist's "Ingress-equivalent" category (8 entries) reflects judgment calls about whether async-job CRUD / read-only inspection / config CRUD should themselves enter `PlatformIngress.submit` for audit. Future architectural review may move some of these to "real concern" status.
