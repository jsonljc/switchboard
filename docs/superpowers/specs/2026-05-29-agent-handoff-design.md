# Agent→Agent Governed Handoff (Delegation v1) — Design

> Status: design (self-approved under `/goal` autonomy; awaiting user review at merge).
> Date: 2026-05-29. Branch: `feat/agent-handoff` (worktree `.claude/worktrees/agent-handoff`).
> Author: Claude (Opus 4.8), on Jason's directive to "max out" the agent→agent handoff borrow.

## 1. Why

A 5-agent panel ranked four "Claude Managed Agents" borrows for Switchboard. **Agent→agent handoff** was chosen as the highest-value strategic unlock: it's the only true architectural _addition_ (the others enhance existing subsystems), it directly serves the "governed AI workforce" positioning (Alex/Riley/Mira as a team), and the substrate is **already in production** — `submitChildWork` already routes child work through `PlatformIngress.submit()` with `parentWorkUnitId`, `actor:"agent"`, `trigger:"internal"` (`apps/api/src/bootstrap/contained-workflows.ts:93-113`).

The panel docked handoff on three dimensions; this design is built to **max all six**:

| Dimension          | Panel | How this design maxes it                                                                                                                                                                                          |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architectural fit  | 5     | Reuse `submitChildWork`/`PlatformIngress`/`parentWorkUnitId`; **zero invariant changes, no schema change**.                                                                                                       |
| Effort             | 4     | One factory + narrow context plumbing + one draft-only handler. ~7 focused files.                                                                                                                                 |
| Strategic leverage | 4→5   | A **general, reusable** delegation primitive (config-driven target list), not a one-off. Lays groundwork for resume-on-external-event (the shared "non-human-triggered governed continuation" pattern).           |
| Safety             | 3→5   | Target **allowlist** (no arbitrary-intent delegation), **depth guard** (no recursion), draft-only first target (no spend/no external send), and the child still runs full governance at the canonical chokepoint. |
| Readiness          | 3→5   | Works on `main` today. Mira M1 is **now merged** (#747), so the demonstrated target is real, not speculative.                                                                                                     |
| Value              | 3→5   | A genuine, human-visible Alex→Mira handoff: a qualified lead's interest becomes a creative concept draft on `/mira` for the team — the workforce story made concrete.                                             |

## 2. What we're building (scope)

**The deliverable is a primitive, demonstrated with one safe target.**

1. **A `delegate` skill tool** that lets an LLM skill (Alex) submit a _governed child WorkUnit_ through `PlatformIngress`, never bypassing it. Mirrors the existing `escalate` tool's factory/trusted-context pattern.
2. **A narrow `ChildWorkSubmitter` port** in core that the tool depends on; implemented in `apps/api` over the existing `submitChildWork` closure (respects the layering rule — core never imports `PlatformIngress` or `ad-optimizer`).
3. **Lineage + recursion safety**: thread the current `workUnitId` and a `delegationDepth` into the skill request context so the child carries `parentWorkUnitId` and a depth guard prevents infinite delegation.
4. **One demonstrated target**: a new **draft-only** `creative.concept.draft` workflow intent (Alex→Mira) that records a `CreativeJob` draft **without firing the creative pipeline** (no spend), surfacing on the existing `/mira` cockpit. Gated on `OrgAgentEnablement` for Mira.
5. **Alex skill update**: add `delegate` to `skills/alex/SKILL.md` with tight guidance on _when_ to delegate.

### Non-goals (explicit YAGNI)

- **No read "handoff" through ingress.** Reads (e.g. "Alex pulls Riley's ad context") are _not_ governed mutations; routing them through `PlatformIngress`/`WorkTrace` would violate the read-only route class. A read-context provider is a separate, later, non-ingress tool — out of scope here.
- **No cost-bearing target.** `creative.job.submit` (`expensive`, requires `listingId`/`productImages[]`) is deliberately **not** wired — impractical for Alex to populate and unnecessary to prove the primitive. The design leaves it as a trivial future allowlist addition (it would _park for approval_ automatically).
- **No new persistence model / migration.** The target reuses `CreativeJob` + `AgentTask`.
- **No multi-level delegation.** Depth cap = 1 in v1.
- **No agent-to-agent _conversation_.** This is governed work delegation (routing + context-passing), not chat between agents.

## 3. Architecture

### 3.1 Flow

```
Alex skill (SkillExecutor loop, runs inside parent WorkUnit P)
  │  LLM decides: this qualified lead wants a tailored concept
  ▼
delegate tool .execute({ target: "creative_concept", brief })       [effectCategory: "propose"]
  │  • assert target ∈ allowlist            (safety: no arbitrary intent)
  │  • assert ctx.delegationDepth < MAX (=1) (safety: no recursion)
  │  • build deterministic idempotencyKey from (parentWorkUnitId, intent, hash(brief))
  ▼
ChildWorkSubmitter port  (core interface) ── implemented in apps/api ──▶ submitChildWork(...)
  ▼
PlatformIngress.submit({ intent:"creative.concept.draft", actor:{type:"agent"},
                         trigger:"internal", parentWorkUnitId: P.id, idempotencyKey, parameters })
  │  • idempotency → entitlement → validateTrigger → GOVERNANCE GATE → mode dispatch
  ▼
WorkflowMode → creative.concept.draft handler
  │  • gate on OrgAgentEnablement(mira)      (graceful no-op if Mira disabled)
  │  • taskStore.create + jobStore.create    (draft CreativeJob; currentStage default)
  │  • DOES NOT fire inngest creative-pipeline/job.submitted   ← no spend
  ▼
returns { outcome:"completed" } → child WorkTrace (parentWorkUnitId = P.id) → surfaces on /mira
  ▼
delegate tool returns { status, childWorkUnitId } → Alex tells the lead truthfully
```

### 3.2 Components & files

**Core (`packages/core`, Layer 3) — the reusable primitive:**

- `src/skill-runtime/tools/delegate.ts` _(new)_ — `createDelegateToolFactory(deps): SkillToolFactory`, mirroring `escalate.ts`. `deps`: `{ submitter: ChildWorkSubmitter; targets: DelegationTarget[]; maxDepth?: number; clock?; hash? }`. Trusted ids (`orgId`, `workUnitId`, `delegationDepth`, actor identity) come from `ctx` — never from LLM input. `effectCategory: "propose"` (tool-layer governance auto-approves; the _real_ gate is the child's `PlatformIngress.submit`). One operation per allowlisted target for typed, validated briefs.
- `src/skill-runtime/delegation-port.ts` _(new)_ — `ChildWorkSubmitter` interface (`submitChildWork(req: DelegationRequest): Promise<DelegationResult>`) + `DelegationTarget` config type (`{ operation, intent, description, briefSchema, mapBrief }`). Narrow, self-contained — no `platform` import, so no cycle.
- `src/skill-runtime/types.ts` _(edit)_ — add `workUnitId?: string` and `delegationDepth?: number` to `SkillRequestContext`; add same to `SkillExecutionParams`.
- `src/skill-runtime/skill-executor.ts` _(edit)_ — `buildRequestContext` (`:132`) sets `workUnitId`/`delegationDepth` from params.
- `src/platform/modes/skill-mode.ts` _(edit)_ — `execute` (`:73`) passes `workUnitId: workUnit.id` and `delegationDepth: (workUnit.parameters.__delegationDepth as number) ?? 0`.
- Barrel exports (`skill-runtime/index.ts`) for the new factory + port/types.

**apps/api (Layer 5) — wiring + the demonstrated target:**

- `src/services/workflows/creative-concept-draft-workflow.ts` _(new)_ — sibling of `creative-job-submit-workflow.ts`: resolve Mira deployment from `workUnit.deployment` (set by the closure's `resolveDeploymentForIntent`), gate on `OrgAgentEnablement(mira)`, `taskStore.create` + `jobStore.create`, **return without `inngestClient.send`**. Returns `{ outcome:"completed", summary, outputs:{ jobId } }`; if Mira disabled, `{ outcome:"completed", summary:"mira_not_enabled", outputs:{ skipped:true } }` (graceful — Alex won't promise a draft that won't show).
- `src/bootstrap/contained-workflows.ts` _(edit)_ — register `creative.concept.draft` handler + intent (`budgetClass:"cheap"`, `approvalPolicy:"none"`, `allowedTriggers:["internal","api"]`, `mutationClass:"write"`).
- `src/app.ts` _(edit)_ — hoist/share the `submitChildWork` closure so it can be passed to **both** `bootstrapContainedWorkflows` and `bootstrapSkillMode`.
- `src/bootstrap/skill-mode.ts` _(edit)_ — accept a `submitChildWork` port in `SkillModeBootstrapDeps`; construct `delegateFactory = createDelegateToolFactory({ submitter, targets, maxDepth:1 })`; register in `toolFactories` (`:294`) and `toolsMap` (`:308`, via `SCHEMA_ONLY_CTX`).

**Skill:**

- `skills/alex/SKILL.md` _(edit)_ — add `- delegate` to the `tools:` list and a short "When to delegate" section (only for a clearly-interested qualified lead; never as a substitute for `escalate`; one concept per conversation).

### 3.3 The `ChildWorkSubmitter` port (layering)

Core tools must not import `PlatformIngress` (Layer 3 → Layer 5 violation) or `ad-optimizer`. So `delegate.ts` depends only on a narrow port defined in core:

```ts
// packages/core/src/skill-runtime/delegation-port.ts (shape; finalized in plan)
export interface DelegationRequest {
  organizationId: string;
  actor: { id: string; type: "agent" };
  intent: string;
  parameters: Record<string, unknown>;
  parentWorkUnitId: string;
  idempotencyKey: string;
}
export interface DelegationResult {
  ok: boolean;
  outcome?: string; // "completed" | "pending_approval" | "failed" | ...
  childWorkUnitId?: string;
  error?: string;
}
export interface ChildWorkSubmitter {
  submitChildWork(req: DelegationRequest): Promise<DelegationResult>;
}
```

`apps/api` adapts the existing `submitChildWork` (which returns `SubmitWorkResponse`) to this port. Mapping `SubmitWorkResponse` → `DelegationResult` also collapses the `approvalRequired` branch into `outcome:"pending_approval"` so the tool degrades gracefully if a future cost-bearing target parks.

## 4. Safety model (why this can't be abused)

The panel's safety concern was "an LLM electing to spawn cost-bearing jobs." Four independent layers neutralize it:

1. **Target allowlist.** The tool can only submit intents in its bootstrap-configured `targets` list. v1 = `["creative.concept.draft"]` only. Prompt-injection cannot make Alex delegate to `creative.job.submit`, an operator mutation, or anything else — those intents aren't even exposed as operations, and `execute()` re-checks membership (defense in depth).
2. **Draft-only target.** `creative.concept.draft` creates a `CreativeJob` row but **never fires the pipeline** — no generation cost, no ad spend, nothing external. Worst case is a junk draft tile on `/mira`, which a human ignores/deletes. Fully reversible.
3. **The child flows through the one governed front door.** `PlatformIngress` applies the same pipeline to the child as to any submit: idempotency → entitlement → `validateTrigger` → `GovernanceGate` → WorkTrace → audit → dispatch. There is no actor/trigger-based bypass of that pipeline. **Per-intent posture:** the draft-only `creative.concept.draft` carries `approvalMode:"system_auto_approved"`, which auto-approves _only the policy/approval step_ (it does not skip entitlement, idempotency, WorkTrace, audit, or dispatch). This is deliberate and bounded to this target: the action is no-spend, reversible, and emits nothing outbound (so the compliance floor has nothing to catch), and an agent-actor child has no seeded IdentitySpec — without the short-circuit it would simply hard-deny with `GOVERNANCE_ERROR` rather than run "more" governance. It is **not** a general agent bypass — it is set on this one innocuous intent. **A cost-bearing target must never copy it:** e.g. `creative.job.submit` keeps `approvalPolicy:"threshold"` + `budgetClass:"expensive"` and **parks for human approval** regardless of actor (and would also need `"internal"` added to its `allowedTriggers` — a deliberate, reviewable act). Agent proposes; for anything that spends or sends, a human disposes.
4. **Depth guard.** `delegationDepth` threads through `parameters.__delegationDepth`; the tool rejects at `>= maxDepth (1)`. A delegated child cannot delegate again — no recursion, no fan-out storms.

Additional: **Mira enablement gate** (the target no-ops for orgs without `OrgAgentEnablement(mira, enabled)`), and **idempotency** (deterministic key → a retried Alex turn dedupes instead of double-creating).

## 5. Testing strategy (TDD)

Co-located `*.test.ts`, mocked Prisma (CI has no Postgres). Red→green per task.

- **delegate tool** (`delegate.test.ts`): (a) allowlisted target → calls submitter with `parentWorkUnitId=ctx.workUnitId`, `actor.type="agent"`, deterministic idempotencyKey; (b) non-allowlisted target → refuses, never calls submitter; (c) `delegationDepth >= max` → refuses; (d) submitter returns `pending_approval` → tool surfaces it without claiming success; (e) trust-bound ids come from `ctx`, not input.
- **context plumbing** (`skill-executor`/`skill-mode` tests): `buildRequestContext` carries `workUnitId`/`delegationDepth`; `SkillMode.execute` populates them from the work unit (default depth 0).
- **creative.concept.draft handler** (`creative-concept-draft-workflow.test.ts`): creates task+job; **asserts `inngest.send` is NOT called** (no spend); gates on enablement (disabled → skipped, no write); returns the job id.
- **governed lineage (integration-ish)**: a delegate call yields a child submit with `trigger:"internal"`, `parentWorkUnitId` set, and governance evaluated (assert via the submitter spy + a thin ingress fake).
- **regression**: existing `escalate`/skill-executor/skill-mode tests stay green; `pnpm --filter @switchboard/core test`, `--filter @switchboard/api test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.

## 6. Rollout / flagging

- The capability goes live for Alex the moment `delegate` is in `skills/alex/SKILL.md`. Because the only target is draft-only + enablement-gated, **enabling it for an org is itself the flag**: orgs without `OrgAgentEnablement(mira)` get a graceful no-op. No separate feature flag needed for v1; documented so the user decides at merge.
- New env vars: none. New intents must be added to any intent allowlist checks (verify `validateTrigger`/registrars only — no env-allowlist file involved).

## 7. Risks & open implementation questions (resolved in the plan)

- **`listingId`/`deploymentId` for the draft `CreativeJob`.** The child WorkUnit's `deployment` is resolved by `submitChildWork` (`resolveDeploymentForIntent(orgId, "creative.concept.draft")` → Mira's deployment). The handler derives `deploymentId` from `workUnit.deployment`; `listingId` resolution (from the Mira deployment/listing association) is the one open lookup — confirmed in the plan against `DeploymentContext`. If unavailable, fall back to the deployment's listing via store lookup.
- **Type-only import direction.** `delegate.ts` uses a _local_ port (no `platform` import) to avoid even a type-level skill-runtime→platform cycle.
- **`SkillRequestContext` is also built in other call sites** (e.g. batch handler). New fields are optional; existing callers compile unchanged and simply omit delegation capability (the tool refuses with no `workUnitId`).
- **Synchronous child execution** blocks Alex's turn until the child returns. The draft target is two fast DB writes, well within budget; the allowlist guarantees only fast targets. Documented as a target-admission criterion.

## 8. Sequencing (for the plan)

Logical commits on `feat/agent-handoff` (kept separable so the user can split at merge; spec/plan committed first per repo doctrine):

1. spec (this doc) + plan.
2. core: context plumbing (`workUnitId`/`delegationDepth`) + tests.
3. core: `delegate` tool + port + tests.
4. apps/api: `creative.concept.draft` handler + intent registration + tests.
5. apps/api: bootstrap wiring (share `submitChildWork`, register factory).
6. skill: `skills/alex/SKILL.md` delegate guidance.
7. green-gate: typecheck/lint/format/test/build, then code-review.

## 9. Live verification (prerequisite for an end-to-end demo)

**Status at implementation close (2026-05-29):** all 7 tasks landed on `feat/agent-handoff`. Build (10/10), typecheck (19/19), lint (0 errors), and format are clean. The full test suite is green except the pre-existing `apps/chat` `gateway-bridge-attribution` timeout flake (untouched by this work; passes in isolation). New unit tests cover the delegate tool (depth guard, allowlist-by-construction, lineage, deterministic idempotency, pending-approval + failure surfacing), the context composer, the draft handler (creates job, **no** pipeline send, enablement gate, fail-closed), and the target config.

**To actually see a draft land on `/mira`**, the target org needs BOTH:

1. `OrgAgentEnablement(agentKey="mira", status="enabled")` — `seedMiraPilotOrgs` already writes this for pilot orgs; otherwise the handler returns `{ outcome:"completed", outputs:{ skipped:true, reason:"mira_not_enabled" } }` (graceful — Alex says nothing misleading).
2. An **active `AgentDeployment` with `skillSlug="creative"`** for the org, so `submitChildWork` resolves a real deployment and `listingId` resolves from it. If none exists, `resolveDeploymentForIntent` falls back to the literal `"api-direct"` and the handler fails closed with `DEPLOYMENT_NOT_FOUND` (safe — no draft, no spend, no partial write).

**The one live gap:** `seedMiraPilotOrgs` seeds only the enablement row, not a creative deployment/listing. Seeding (or provisioning) a `skillSlug="creative"` deployment for the pilot org is the single prerequisite to a live draft and is intentionally **out of this code-only branch** — it touches provisioning/seed data and the shared DB, and should be done deliberately by the operator. Until then, the primitive is fully exercised and tested (the governed child submit, lineage, governance, and fail-closed paths all work); only the final draft-row persistence waits on that deployment existing.

**Safety recap (holds regardless of the above):** the delegate tool can only submit allowlisted intents (v1 = `creative.concept.draft` only), a delegated child cannot delegate again (depth cap 1), the target fires no pipeline/spend and sends nothing outbound, and the child flows through `PlatformIngress` (entitlement, idempotency, WorkTrace, audit, dispatch). This one draft-only target auto-approves its policy step (`approvalMode:"system_auto_approved"`, justified in §4); any future spend- or send-bearing target keeps full policy governance and parks for human approval.

## 10. Known non-blocking follow-ups (from review)

- **`delegate` was reachable (but inert) in the simulation executor.** Fixed on this branch — `delegate` is now excluded from the simulation executor by design (`bootstrap/skill-mode.ts`), since `SimulationPolicyHook` does not block the `propose` effect category. (It was already inert because `/simulate` supplies no `workUnitId`.)
- **`apps/api/src/routes/ingress.ts` casts the request `trigger` rather than validating it at runtime** (pre-existing, not introduced here): an authenticated operator could POST `trigger:"internal"` and reach any `internal`-only intent, including `creative.concept.draft`. Worst case is a no-spend draft row in the operator's own org (auth + org-scoped), so it is low-impact, but a runtime `trigger` validation on that route is a worthwhile route-governance hardening tracked separately from this feature.
