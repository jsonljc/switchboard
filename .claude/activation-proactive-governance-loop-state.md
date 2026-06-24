# activation-proactive-governance loop — externalized state (scratch, not committed)

Durable record: memory notes project_north_star_activation_gap + feedback_workflow_intent_deployment_not_found.

Goal: make the platform-initiated proactive/intake intent family actually RUN in prod (resolve + pass the gate)
Authority: SURFACE-before-merge (stop-globs: governance + external-send + db seed) Task-size: standard, likely MULTI → decompose
Base: origin/main @ c2bb05d46 baseline_sha: c2bb05d46
Worktree: .claude/worktrees/activation-carveout (branch fix/proactive-send-deployment-resolution); pnpm install+build = exit 0

STATUS 2026-06-20: STOPPED CLEAN at FRAME — scope grew + product/priority decision needed; awaiting user. Carve-out alone is INSUFFICIENT.

FINDING (code-verified @ c2bb05d46) — the platform-initiated workflow intent family is prod-inert at TWO layers:
L1 resolution: ingress wrapper resolveAuthoritativeDeployment (platform-deployment-resolver.ts:31,43) keys ONLY on
targetHint.skillSlug ?? intent.split(".")[0]; IGNORES targetHint.deploymentId. Slugs conversation/meta/lead unseeded
(only alex/ad-optimizer/creative) → resolveByOrgAndSlug THROWS deployment_not_found. Affects: conversation.reminder.send,
conversation.followup.send, meta.lead.greeting.send, meta.lead.inquiry.record (no deployment) AND lead.intake +
meta.lead.intake (these DO pass targetHint.deploymentId but the wrapper drops it = likely regression; intended fix =
honor it via resolveByDeploymentId, the iface already has the method).
L2 gate default-deny: policy-engine.ts:589 finalDecision = policyResult.policyDecision ?? "deny". The seeded system
"default" IdentitySpec has trustBehaviors:[] (provision-org-with-owner.ts:94) → isTrusted=false. NO seeded allow policy
for any of the 6 intents (allow exists ONLY for recommendation-handoff/creative/riley-pause/riley-budget/robin). So
even past L1 they DENY. The #1167 robin carve-out pattern fixes only L1.
Masking: every test bypasses ingress (handler.execute direct, e.g. followup-fail-closed-integration.test.ts:63) or wires
resolveAuthoritativeDeployment(null)=platform-direct (test-server.ts:470). No live-path test asserts EXECUTE through the
real gate for any of these.

FIX SHAPE (per intent): (a) reach gate — carve-out (isPlatformDirectIntent) for the no-deployment sends; honor
targetHint.deploymentId for lead.intake/meta.lead.intake; + (b) seeded ALLOW-ONLY policy (NOT robin's allow+require_approval:
these are transactional/per-contact, consent+window+template gated in the executor; require_approval would strand them).
Seed in BOTH provision paths (provision-org-agents always-run branch + seed.ts org_dev). Live-path test w/ throwing resolver

- REAL gate + REAL seeded policies asserting EXECUTE (mirror robin-recovery-cron-live-path.test.ts).

DECOMPOSITION (the two natural slices, same root cause):

- S-A inbound funnel: lead.intake, meta.lead.intake, meta.lead.greeting.send, meta.lead.inquiry.record.
- S-B show-rate sends: conversation.reminder.send, conversation.followup.send.
  (greeting.send also has a SEPARATE open consent-bypass note from the Casey review — out of scope for governance-allow.)

USER DECISION 2026-06-20: WHOLE FAMILY, ONE PR. Now in EXECUTE.

PLAN (locked 2026-06-20; non-uniform per code-grounded analysis):
ATTRIBUTION FINDING: lead.intake persists deploymentId from PARAMETERS (lead-intake-handler.ts:68,83), NOT resolved
context → carve-out attribution-safe. meta.lead.intake threads workUnit.deployment.deploymentId (CONTEXT, line 128)
into the ingested lead → carve-out would attribute Meta leads to "platform-direct". So it must resolve a REAL deployment.
General honor-targetHint.deploymentId REJECTED: resolveByDeploymentId is NOT org-scoped (IDOR via ingress body) + broad
blast radius (execute.ts/actions.ts pass skillSlug; only lead-intake passes deploymentId-only).
Step 1 [carve-out]: extend app.ts isPlatformDirectIntent to also match conversation.reminder.send,
conversation.followup.send, meta.lead.greeting.send, meta.lead.inquiry.record, lead.intake. Use a named Set of intent
consts (kill the growing OR-chain smell; include ROBIN). Test platform-deployment-resolver.test.ts: each → platform-direct;
a skill intent ("alex") still strict-resolves/throws.
Step 2 [meta.lead.intake attribution]: ad-optimizer.ts:122 targetHint skillSlug "meta-lead" → "alex" (resolve real Alex
deployment; org-scoped; correct lead attribution). VERIFY "meta-lead" not seeded/used elsewhere. Route test asserts "alex".
Step 3 [allow policy]: NEW packages/db/src/seed/proactive-intake-governance.ts — ONE allow-only family policy, rule
actionType matches ^(conversation\.reminder\.send|conversation\.followup\.send|meta\.lead\.greeting\.send|
meta\.lead\.inquiry\.record|lead\.intake|meta\.lead\.intake)$ (mirror robin-recovery-governance.ts but allow-ONLY, no
require_approval — transactional, consent/window/template-gated downstream). Seed in provision-org-agents.ts always-run
branch + seed.ts org_dev. Seed test mirrors provision-org-agents.test.ts (effect+rule asserted vs what the gate matches).
Step 4 [live-path test]: apps/api **tests** mirror robin-recovery-cron-live-path.test.ts — throwing resolver + REAL gate +
REAL seeded family allow policy. Assert: each of the 6 submits EXECUTE (not deny, not deployment_not_found); carveOut=false
→ deployment_not_found; policy absent → deny. (the assertion the whole family LACKS today.)
Step 5 VERIFY: typecheck; test; --filter @switchboard/api test; --filter @switchboard/db test; lint; format:check; arch:check;
CI=1 local-verify-fast; build; eval:governance (gate seed change). Then independent fresh-context review (not self-graded).
Step 6 SURFACE: open PR w/ evidence; STOP for human merge (governance + external-send + seed stop-globs).
EXECUTE COMPLETE 2026-06-20. Commit 1a5a1986a (11 files, 603+/18-) on fix/proactive-send-deployment-resolution,
REBASED onto origin/main 112a5adee (clean; the landed delta was all apps/dashboard Money slice, zero overlap).
TDD green per step: predicate resolver test 20/20; ad-optimizer route test 4/4 (RED proved meta-lead->alex);
db proactive-intake-governance 3/3 + provision-org-agents 20/20 unbroken; live-path 10/10 (all 6 EXECUTE through
real ingress+gate+seeded allow policy; carve-out AND policy each proven load-bearing; meta.lead.intake->dep-alex).
gate_results (full VERIFY subagent, ALL GREEN 2026-06-20): build=pass typecheck=pass(21/21) api-test=pass(2258)
db-test=pass(1158) lint=pass format=pass arch=pass verify-fast=pass eval:governance=pass(26/26) — no flakes.
review=SHIP (indep adversarial: all 7 safety claims verified; 1 warn = org_dev dev-seed comment overstated, FIXED).
NOW: VERIFY (full gates) + independent REVIEW (three-dot diff, adversarial) dispatched as BACKGROUND subagents.
RESUME POINT: await VERIFY + REVIEW verdicts -> triage findings -> (rebase re-check) -> SURFACE PR (stop for human
merge: governance + external-send + db-seed stop-globs). Do NOT auto-merge. commitlint footer-leading-blank
warning (non-blocking) can be fixed on the surface amend if desired.

SURFACED 2026-06-20: PR #1185 (https://github.com/jsonljc/switchboard/pull/1185), head 49505ef29 (was a4f493063), base main. 11 files.
STOP for human merge (governance + external-send + db-seed stop-globs). Do NOT auto-merge.
CI on a4f493063 = ALL REQUIRED GREEN (test 10m25s, typecheck, lint, architecture, security, CodeQL, evals incl governance).
TWO reviews: (1) adversarial safety = 7/7 claims verified, SHIP (1 warn dev-seed comment FIXED); (2) /requesting-code-review
architecture+real-path correctness = no Critical, traced all 6 intents to real producers (crons/child-work/InstantForm/
CTWA-internal-hop/webhook) all resolve+clear gate, Ready-with-fixes (1 Important = live-path test loosened trigger gating).
Important FIXED: live-path test now uses per-intent REAL allowedTriggers + real submit trigger + real actor type
(INTENT_META); amended a4f->49505ef29, force-pushed. CI on 49505ef29 = ALL REQUIRED GREEN (GH_EXIT=0: test 10m48s,
typecheck, lint, architecture, security, CodeQL, analyze, docker, secrets, 4 evals). Skipped the organizations.ts:94
fail-soft Minor (pre-existing Riley pattern, out-of-diff).
STATUS: ✅ MERGED #1185 (squash 9e611ccd7) 2026-06-20 + cleaned up (worktree removed, branch deleted, main ff-synced).
SLICE CLOSED. Memory project_north_star_activation_gap updated (P0.1 DONE, NEXT=P0.3 payment→receipt). This ledger is
spent scratch; a fresh P0.3 session starts its own. (Audit doc docs/audits/2026-06-20-north-star-activation-gap/ is
untracked-local; the memory note carries the findings — land it on main with a docs PR if a durable on-main copy is wanted.)

## Log

- 2026-06-20: ORIENT+FRAME+PLAN done; user chose whole-family one-PR. EXECUTE steps 1-4 TDD-green. Committed
  1a5a1986a, rebased onto origin/main 112a5adee. VERIFY = ALL GREEN. REVIEW = SHIP (1 warn fixed: dev-seed comment).
  Amended -> a4f493063, pushed, opened PR #1185 (SURFACE). Awaiting CI green + human merge.
