# F-16: A fresh pilot org has no `require_approval` policy and no operator-reachable parking path — the approval lifecycle never fires

- **Severity:** blocks-pilot (the entire human-in-the-loop approval spine is inert for a self-serve pilot org)
- **Journey/step:** J4-S1, J4-S2
- **Verdict:** DORMANT (config/producer prevents parking at prod defaults)
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - `packages/db/src/seed/creative-governance.ts:21` — TODO, verbatim: the require*approval policy *"seed runs it for `org_dev`; wiring it into the per-org pilot-enablement path"\_ (i.e. not wired). Org-parameterized builders exist (`buildCreativePublishApprovalPolicyInput(organizationId)` `:94`, `creativePublishApprovalPolicyId` `:81`) but nothing calls them for a newly-provisioned org.
  - `apps/api/src/bootstrap/operator-intents.ts:110-123` — `registerOperatorIntent()` registers EVERY dashboard-reachable operator intent with `approvalPolicy:"none"` + `system_auto_approved`.
  - `packages/core/src/platform/governance/governance-gate.ts:100-108` — `system_auto_approved` short-circuits to `outcome:"execute"` before any policy/identity step; such intents cannot park.
  - `apps/api/src/bootstrap/contained-workflows.ts:347-481` — the gated workflow intents (`adoptimizer.recommendation.handoff` `:416`, riley pause `:433`) are `allowedTriggers:["internal"]` (not dashboard-reachable); `creative.job.publish` `:384` is `api`-trigger but its require_approval policy is seeded only on `org_dev` and it needs a creative deployment + a `CreativeJob` row the fresh org lacks.
  - `apps/api/src/routes/agent-home/mira-decision.ts:1-13,59-65` — the one session-auth creative operator action ("Keep/Pass") is explicitly DRAFT-ONLY / NO-PUBLISH: it writes only `CreativeJob.reviewDecision`, never submits through ingress.
- **Evidence:**
  - `evidence/j4-db-state.txt` — live read-only psql for `org_4f796695-7022-4718-838f-71c50b879ad2`: `ApprovalLifecycle` 0 rows; `Policy` 0 rows (only `org_dev` has any policy — 10 rows); `AgentDeployment` = one `alex` (conversation) deployment, `governanceSettings={}`; `WorkTrace` 0 rows.
  - Live decisions feed over the authed session cookie (the exact API the Inbox reads): `GET /api/dashboard/decisions -> 200 {"decisions":[],"counts":{"total":0,"approval":0,"handoff":0}}`. `/inbox` redirects to `/onboarding`. Screenshot `evidence/j4-inbox-parked.png`.
  - `evidence/j4-approve-dispatch.txt`, `evidence/j4-reject.txt` — full reasoning + the two escape hatches considered (credential decrypt — denied by safety classifier; ingress harness — out of scope).

## What was exercised

- Traced the producer leg end to end: who can submit an intent that returns `require_approval` for this org. Confirmed by code that (1) no per-org `require_approval` policy is provisioned at signup, (2) every dashboard-reachable operator intent is `system_auto_approved`, (3) the gated workflow intents are internal-trigger-only or need deployments the org lacks, (4) the Mira decision route never submits through ingress.
- Confirmed live (read-only DB): 0 `Policy`, 0 `ApprovalLifecycle`, 0 `WorkTrace` for the org.
- Confirmed live (Playwright, session-cookie path): the Inbox's decisions feed returns empty; `/inbox` redirects to onboarding.

## What happened vs expected

- **Expected:** an operator can trigger a governed action that parks for approval, see it in the Inbox, and Approve (→ dispatch-or-recovery) or Reject (→ no side effect).
- **Observed:** a fresh self-serve pilot org has nothing that can park. The respond/dispatch machinery (`respondToParkedLifecycle`, `respond-to-parked-lifecycle.ts:147-205`, with the `recovery_required` failure transition) is correctly written, but the PRODUCER leg never fires, so the human-in-the-loop surface is permanently empty for a fresh pilot org.
- This CORRECTS the J3-S5 handoff note (`evidence/j3-parked-approval.txt`), which assumed the require_approval policies were "confirmed seeded for Alex." They are seeded for `org_dev` only; the audit org has 0 `Policy` rows. Even fixing F-15 (chat→API auth) would not make anything park, because there is no policy to match.

## Two-sided impact: parked-approval AND agent-initiated governed actions

The missing per-org Policy seeding has TWO observable sides:

1. **Side A (Inbox empty):** No `require_approval` policies exist; operator intents cannot park. The approval Inbox is decorative.
2. **Side B (Default-deny):** With 0 `Policy` rows in the org, agent-initiated governed actions (skill-triggered intents submitted through `PlatformIngress.submit()`) hit the default-deny floor. Specifically:
   - `packages/core/src/platform/governance/governance-gate.ts:589` — when `policies.length === 0`, the gate applies an empty-policy "default deny" floor (`outcome:"deny"`, `reason:"no matching policy"`).
   - `apps/api/src/app.ts:516-518` — `loadIdentitySpec()` throws (hard-deny) for any actor (including skill-bound agents) without a matching `IdentitySpec` row in the org.
   - Result: a fresh org's agents cannot take ANY governed actions (create, modify, or publish creatives; propose ad campaigns; execute optimizations) until the per-org Policy AND agent IdentitySpec rows are seeded.

**Positive safety property:** This is the SAFE default direction. Fresh customers have NO default-allow / unapproved-financial-execution exposure (the gate fails closed). F-16 is a functionality/provisioning gap, not a governance-bypass security hole.

## No phantom-success found

The approve path ends in dispatch-or-recovery by code read (no phantom-success): `runDispatch` returns the execution result and, on throw/`success:false`, the lifecycle transitions to `recovery_required` (operator Retry card). This is consistent with the seam-list S-07 "OK" verdict. F-16 is a PRODUCER/provisioning gap, not a respond-path defect. The S-08/S-17 latent phantom-success structures (operator submits that don't branch on `approvalRequired`) remain unreachable because those intents are `system_auto_approved` (recorded as latent in the seam-list; unchanged here).

## Suggested fix scope

Wire the per-org governance provisioning the seed TODO names: on org provisioning (`seedOrgDayOneAgents` / the pilot-enablement path in `apps/api/src/routes/organizations.ts` and `packages/db/src/seed/creative-governance.ts`), seed:

1. The org-scoped `require_approval(mandatory)` policies (reuse `buildCreativePublishApprovalPolicyInput(orgId)` and the handoff/pause builders) for the agents the org enables, so the approval lifecycle can actually fire for pilot orgs — not just `org_dev`.
2. Agent `IdentitySpec` rows (`buildCreative*PolicyInput` + handoff/pause policy-builder `actorIdentity` chains) scoped to the org's enabled agents (Alex, Mira, Riley), so that agent-initiated governed actions can pass the identity gate and be governed by the policies seeded in step 1.

Until both are seeded, the approval Inbox is decorative and agents cannot take governed actions (both gate fail-closed). The fix resolves both sides of F-16 in a single provisioning pass.

## Validation / test

- Add a provisioning test asserting that a newly-provisioned org has the expected `require_approval` `Policy` rows (mirror the org_dev seed assertions) for each enabled agent.
- After wiring, a live re-run of J4-S1/S2 should: submit a gated intent → `PENDING_APPROVAL` with a real `bindingHash` → appear in `GET /api/dashboard/decisions` → Approve → `WorkTrace.approvalOutcome=approved` + terminal `outcome` (e.g. `queued` for `creative.job.publish`); Reject → `approvalOutcome=rejected`, no side effect.
