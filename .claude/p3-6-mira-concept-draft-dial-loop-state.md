# P3-6 mira concept.draft per-org governance dial — loop state (scratch, uncommitted)

Workstream: mira / governance. Gap: 2026-06-22 second-wave gap-eval P3-6.
Durable record → memory `project_second_wave_gap_eval_2026_06_22`.

Goal: make a per-org governance DENY/require_approval consultable for the auto-approved
`creative.concept.draft` draft-writing step, WITHOUT regressing the default-org auto-approve
fast-path and WITHOUT triggering identity resolution (the delegate path's agent actor is unseeded).
Authority: SURFACE-before-merge (touches governance-gate = merge-stop). Task-size: standard.
Base: origin/main @ 035aeaf5a baseline_sha: 035aeaf5a
merge_safety: stop-glob touched = YES (governance/GovernanceGate) -> SURFACE-ONLY.
independent_review: pending.

## Ground truth (tool-verified on origin/main @ 035aeaf5a)

- `creative.concept.draft` registered `approvalMode:"system_auto_approved"` (contained-workflows.ts:598-603).
- GovernanceGate auto-approve short-circuit returns `outcome:"execute"` (governance-gate.ts:186-194)
  BEFORE `loadPolicies(orgId)` (line 211) -> org-scoped deny NEVER consulted. GAP CONFIRMED.
- Sibling `creative.brief.compose` is a real `allow` policy (db creative-governance.ts:109-141) precisely
  so "an org-scoped deny or require_approval policy can throttle Mira" — concept.draft diverged from it.
- WHY naive "mirror compose / drop the mode" is UNSAFE: concept.draft has 3 submitters; Alex's delegate
  tool submits with `actor:{id:ctx.actorId??deploymentId,type:"agent"}` (delegate.ts:77) — an UNSEEDED
  agent actor. Full path calls `loadIdentitySpec` which THROWS on missing spec (app.ts:594-595) -> hard
  -deny every Alex->Mira draft. The short-circuit is load-bearing. Fix must NOT resolve identity.
- `evaluateRule(rule, evalContext)` (rule-evaluator.ts:122) is identity-free; gate already builds the
  context via `toEvaluationContext` (identity-free). Policy effect enum: allow|deny|modify|require_approval.
- Policy-engine org-policy layer (policy-engine.ts:277-337): active policies sorted by priority asc;
  matched `deny` wins regardless of order/priority (break); matched `require_approval`(+requirement) parks.
- GovernanceDecision shapes (governance-types.ts:19-40); decision-adapter uses `approvers:[]` for
  require_approval (decision-adapter.ts:27) -> synthesis is trivial.

## Design (resolved autonomously; alternatives + why-rejected)

CHOSEN: identity-free org-policy consult inside the auto-approve branch, opt-in per registration.

- New `IntentRegistration.consultOrgPolicyOnAutoApprove?:boolean`; set true ONLY on concept.draft.
- Gate: when set & non-financial auto-approve, BEFORE execute: loadPolicies + toEvaluationContext +
  helper `consultAutoApproveOrgPolicy` replicating ONLY the org-policy layer (deny wins; else
  require_approval; else null->execute). No identity/cartridge/risk loads.
- Default org (no matching policy) -> null -> execute: fast-path preserved (one indexed loadPolicies
  ONLY for the opted-in intent; every other auto-approve intent untouched). No new producer/setter
  (operators use the EXISTING Policy mechanism, exactly like compose's dial).
  REJECTED A) mirror compose (drop mode + seed allow): agent-actor delegate path -> loadIdentitySpec
  throws -> hard-deny. Also removes fast-path.
  REJECTED B) governanceSettings deny flag on workUnit.deployment (zero latency): a NEW dial mechanism
  inconsistent with compose's Policy-based dial; needs a new operator setter to be usable
  (producer-population gap + multi-slice scope creep).
  Sub-decisions: scoping = registration flag (not a core gate const, mirrors spendBearing/revenueRecording);
  honor deny AND require_approval (faithful to the policy layer + compose dial; approvers:[]);
  default-allow + ENFORCE (a matching deny actually denies — observe-only would reproduce the gap).

## File map

- M packages/core/src/platform/intent-registration.ts (+ optional flag + doc)
- C packages/core/src/platform/governance/auto-approve-policy-consult.ts (helper)
- C packages/core/src/platform/governance/**tests**/auto-approve-policy-consult.test.ts
- M packages/core/src/platform/governance/governance-gate.ts (wire consult; MERGE-STOP)
- C packages/core/src/platform/governance/**tests**/governance-gate-auto-approve-org-policy.test.ts
- M apps/api/src/bootstrap/contained-workflows.ts (workflowIntents type + map + set flag)
- C apps/api/src/**tests**/concept-draft-org-policy-dial.test.ts (producer + e2e gate proof)
- (export) packages/core/src/platform/index.ts if needed for the new helper test import

## TDD plan (RED before GREEN every behavior step; per-pkg `pnpm --filter <pkg> exec tsc --noEmit`

## before each commit; rebuild core dist before api typecheck/tests)

### Task 1 — helper `consultAutoApproveOrgPolicy` (pure, identity-free) [core]

Files: C auto-approve-policy-consult.ts; C **tests**/auto-approve-policy-consult.test.ts
Signature (Produces):
consultAutoApproveOrgPolicy(policies: Policy[], evalContext: EvaluationContext,
constraints: ExecutionConstraints): GovernanceDecision | null

- matched deny -> { outcome:"deny", reasonCode: <policy.id>, riskScore:0, matchedPolicies:[ids] }
- matched require_approval(+approvalRequirement) and no deny ->
  { outcome:"require_approval", riskScore:0, approvalLevel:<approvalRequirement>, approvers:[],
  constraints, matchedPolicies:[ids] }
- else null (caller short-circuits to execute)
  Mirrors policy-engine.ts:277-337 deny/approval selection (active, sort priority asc, cartridgeId
  filter, deny-wins-break). Cross-reference that file in a comment.
  Steps:

1. RED: test "no policies -> null"; "non-matching policy -> null"; "matching deny -> deny(reasonCode=id)";
   "matching allow only -> null (execute)"; "deny wins over a higher-priority allow"; "matching
   require_approval -> require_approval(approvalLevel,approvers:[])"; "inactive deny ignored";
   "cartridgeId-scoped policy with mismatched cartridge ignored". Run -> FAIL (module missing).
2. GREEN: implement helper. Run -> PASS.
3. `pnpm --filter @switchboard/core exec tsc --noEmit`; commit.

### Task 2 — registration flag [core]

Files: M intent-registration.ts

1. Add `consultOrgPolicyOnAutoApprove?: boolean;` to IntentRegistration with a doc comment (what it
   does, why scoped, why identity-free). No test of its own (type-only); covered by Task 3.
2. tsc --noEmit (core); commit (fold into Task 3 commit if trivial — keep as its own if reviewer-separable).

### Task 3 — wire the consult into the gate [core] (MERGE-STOP)

Files: M governance-gate.ts; C **tests**/governance-gate-auto-approve-org-policy.test.ts
Wire: in the `system_auto_approved` branch, inside `if (!isFinancialIntent(...))`, BEFORE the execute
return: `if (registration.consultOrgPolicyOnAutoApprove) { const policies = await
  this.deps.loadPolicies(workUnit.organizationId); const consulted = consultAutoApproveOrgPolicy(
  policies, toEvaluationContext(workUnit, registration), constraints); if (consulted) return consulted; }`
Tests (mirror governance-gate-auto-approved-financial.test.ts harness; real gate + real evaluate):

1. RED:
   a. flagged intent + NO policies -> execute (fast-path preserved).
   b. flagged intent + seeded org-scoped DENY policy -> deny (THE GAP FIX).
   c. flagged intent + seeded require_approval policy -> require_approval.
   d. NON-flagged auto-approve intent + seeded DENY policy -> STILL execute (scoping: untouched).
   e. IDENTITY-FREE PROOF: flagged intent, `loadIdentitySpec` throws, agent-type actor:
   - with DENY policy -> deny (no throw); - with NO policy -> execute (no throw).
     (If the consult resolved identity, loadIdentitySpec would throw and these would reject.)
     f. financial guard unaffected: a flagged-but-financial intent (spendAmount) still does NOT execute.
     Run -> FAIL (flag not consulted: b/c/e currently execute).
2. GREEN: wire the consult. Run -> PASS. Re-run financial test (no regression).
3. tsc --noEmit (core); rebuild core dist (`pnpm --filter @switchboard/core build`); commit.

### Task 4 — producer: set the flag on concept.draft + prove it [apps/api]

Files: M contained-workflows.ts (workflowIntents element type +
`consultOrgPolicyOnAutoApprove?: boolean`; register() map `consultOrgPolicyOnAutoApprove:
  reg.consultOrgPolicyOnAutoApprove`; set `consultOrgPolicyOnAutoApprove: true` on the concept.draft
entry + update its comment); C **tests**/concept-draft-org-policy-dial.test.ts
Producer test: bootstrap `bootstrapContainedWorkflows` with stub deps + a capturing IntentRegistry,
then `registry.lookup("creative.concept.draft")` asserts approvalMode==="system_auto_approved" AND
consultOrgPolicyOnAutoApprove===true. (If full bootstrap proves un-stubbable in RED, fall back: use a
real IntentRegistry, capture, minimal stubs — resolve in step.) PLUS an e2e proof mirroring
mira-brief-compose-gate.test.ts: drive that captured registration through a REAL gate with a seeded
DENY policy -> deny; with none -> execute.

1. RED: write producer + e2e tests -> FAIL (flag absent / executes under deny).
2. GREEN: set the flag in contained-workflows. Run -> PASS.
3. `pnpm --filter @switchboard/api exec tsc --noEmit` (after core dist rebuilt); commit.

### Task 5 — VERIFY + SURFACE

Gates: typecheck; `pnpm --filter @switchboard/core test` + `--filter @switchboard/api test`; full
`pnpm test`; lint; format:check; arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts`;
`pnpm audit --audit-level=high`; build (api changed). Independent fresh-context review (2 Explore
reviewers: correctness + adversarial "can an org-scoped DENY still be bypassed / did the default
auto-approve regress / any added spend?"). Rebase on origin/main; `gh pr checks` all green.
SURFACE-ONLY (governance merge-stop): open PR + evidence + human-verify note. STOP.

gate_results: typecheck=PASS test=PASS(flake-in-untouched-chat-under-load; 4/4 in isolation) lint=PASS
format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS eval-governance=PASS eval-mira=PASS
review=2/2 SOUND zero-findings (correctness + adversarial; A-D all NO)
OUTCOME: MERGED. PR #1370 squash-merged 2026-06-27 (squash 7b27ad351 on origin/main).
Human (user) gave the merge call for the governance stop-glob; CI all-green, 2 reviews SOUND.
Worktree removed, local branch deleted, local main synced. SLICE CLOSED.
whatRemains: nothing — slice complete.

## Log

- 2026-06-27: ORIENT done (gap real, design resolved, plan written). -> EXECUTE Task 1.
- 2026-06-27: Tasks 1-4 GREEN (RED-first each). 17 new tests. core platform 465 pass.
- 2026-06-27: VERIFY all gates green (test red = load-flake in untouched apps/chat, 4/4 isolation).
  2 independent Explore reviews SOUND/zero. Rebased clean. Pushed. SURFACED PR #1370. STOP.
