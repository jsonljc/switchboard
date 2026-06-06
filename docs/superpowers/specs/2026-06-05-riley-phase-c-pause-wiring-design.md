# Riley Phase-C Wiring: Governed Pause Self-Execution (design)

**Date:** 2026-06-05 (rev 2, 2026-06-06: execution-truth hardening from design review)
**Status:** Design for implementation (rides in PR-1, like slices 3-5)
**Parent spec:** `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (sections 2.4, 5, risk 8)
**Seam consumed:** `docs/superpowers/specs/2026-06-05-riley-v3-slice5-phase-c-seam-design.md` (PR #927)

## Goal

Flip the slice-5 seam live in its safest form: Riley submits its arbitration-primary pause
recommendation through the governed path, the submit parks for mandatory human approval, and
operator approval is the dispatch trigger that actually pauses the campaign on Meta. Per-org
flag, default OFF everywhere. No autonomy: every pause has a human approval between intent and
execution.

## The earned-execution judgment

The parent spec gates Phase-C on Riley earning execution. Approval-parked execution is the
defensible v1, not premature, because it changes WHERE the hands are, not WHO decides:

- Today: Riley emits a pause recommendation; the operator reads it and pauses manually in Ads
  Manager. One human decision, human hands.
- After: Riley submits; governance parks it; the operator approves in the existing Inbox/Slack
  approval surfaces (#872-#879, #918-#922); the system pauses via the Meta API. One human
  decision, system hands, full WorkTrace/audit/idempotency/recovery guarantees the manual path
  never had.

The human-decision count is identical. The new failure surface (executor bugs, stale approvals)
is covered by binding-hash freeze, the lifecycle's 24h park expiry, idempotency claim-first,
recovery_required on dispatch failure, the executor's own staleness/org/status guards (below),
and an idempotent Meta call. Riley's earning loop (slice-3 trustDelta on pause outcomes,
rendered on the agent activity feed) stays the human-read evidence for widening later. Gates
stacked on top: class eligibility (seam predicate), raised execution evidence floor,
primary-only, per-org flag default OFF, env kill switch, mandatory approval that survives the
autonomous trust override.

## Decision record

1. **Intent name:** keep `adoptimizer.campaign.pause` (the placeholder chose well: domain.object.verb,
   matching `creative.concept.draft` / `meta.lead.greeting.send`). Symbol renames
   `UNWIRED_RILEY_PAUSE_INTENT` to `RILEY_PAUSE_INTENT`; the PHASE-C unresolved-note comment is
   replaced by wiring-session pointers.
2. **Riley-self deployment resolution:** verbatim the handoff pattern. The weekly-audit cron
   already iterates Riley's active `ad-optimizer` deployments (`listActiveDeployments`,
   `apps/api/src/bootstrap/inngest.ts:355`); the sink threads `emissionContext.deploymentId`
   into the candidate; the apps/api closure submits with
   `{deploymentId: candidate.deploymentId, skillSlug: "ad-optimizer"}` as targetHint. Never
   Mira's creative deployment; never the intent-prefix fallback. Verified: the top-level
   resolver re-resolves org-scoped by `(request.organizationId, skillSlug)`
   (`apps/api/src/bootstrap/platform-deployment-resolver.ts:22`); the targetHint deploymentId
   is provenance, so a forged cross-org deployment id cannot bind at submit time.
3. **Executor:** a `WorkflowHandler` registered for the intent in
   `apps/api/src/bootstrap/contained-workflows.ts` (mode "workflow", internal-trigger-only,
   like the handoff). On approval, `respondToParkedLifecycle` -> `runDispatch` ->
   `executeApproved` -> `WorkflowMode` -> handler. The handler hardening sequence (execution
   truth, rev 2):
   1. Zod parse (`RileyPauseExecutionInput`): fail closed `INVALID_PAUSE_INPUT`.
   2. Class eligibility + raised execution floor re-check (defense in depth): abstain as a
      deliberate completed no-op, never a phantom pause.
   3. **Stale-approval cap:** abstain (`stale_approval`) when execution runs more than
      `RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS = 48` after `workUnit.requestedAt`. This is the
      outer backstop behind the platform's own 24h lifecycle expiry
      (`platform-ingress.ts:284`); the loop test pins whichever the respond path actually
      enforces. `requestedAt` + `ageHours` always recorded in outputs.
   4. **Org isolation:** credentials resolve via
      `getDeploymentCredentials(organizationId, deploymentId)`; the closure verifies the
      deployment row's `organizationId` equals the work unit's before decrypting. Mismatch =
      LOUD failure `DEPLOYMENT_ORG_MISMATCH` (a security signal, not a quiet skip). Verified
      defense-in-depth: the resolver is org-scoped by construction, this guards future
      resolver changes and hand-edited traces.
   5. **Campaign-status pre-read** (`MetaAdsClient.getCampaignStatus`, new read-only method):
      already `PAUSED` -> abstain `campaign_already_paused` (recorded `previousStatus`);
      `DELETED`/`ARCHIVED` -> abstain `campaign_not_pausable`; read failure -> proceed with
      `previousStatus: "unknown"` (the write is the honest test). The pre-read and the write
      use two fresh client instances: the client's 60s in-instance rate limiter would
      otherwise hold the approval route open for a minute; two Graph calls per human approval
      is well under any real limit.
   6. The pause write via the EXISTING `MetaAdsClient.updateCampaignStatus(campaignId,
      "PAUSED")` (`packages/ad-optimizer/src/meta-ads-client.ts:355`). Throw = fail
      `META_PAUSE_FAILED` -> lifecycle dispatch maps to `recovery_required` + operator Retry
      card: approve always ends in dispatch-or-recovery.
   7. Success outputs record execution truth: `paused`, `previousStatus`, `newStatus`,
      `metaWriteAccepted: true` (request accepted; observed-paused readback deferred),
      `requestedAt`, `ageHours`, plus the seam's `rollbackPlan` / `successMetric` /
      `guardrailMetrics` strings verbatim (recorded, not auto-monitored; the slice-3
      outcome-attribution cron is the monitoring loop).
4. **Rollback = resume stays human.** `updateCampaignStatus` throws on "ACTIVE" by design
   ("Agent cannot activate campaigns"). v1 keeps that invariant: the rollback plan is recorded,
   not executed. No auto-rollback machinery, no resume intent.
5. **Primary-only:** only the arbitration primary may self-submit. The dispatch decision is pure
   ad-optimizer code (sibling of `buildHandoffCandidate`) gated on the primary identity from
   Step 8d arbitration; non-primary mutating candidates never reach the submitter. Pause is not
   a creative action, so the handoff and pause paths cannot double-dispatch one recommendation.
6. **Execution evidence floor RAISED:** `{clicks: 100, conversions: 10, days: 7}` (2x the
   destructive recommendation floor on volume axes). `days` stays 7 because the weekly audit
   window IS 7 days (`audit-runner.ts:311`, inclusive); a higher days floor would make the
   feature permanently inert (the safety-gate-producer-population trap). The floor lives in
   `packages/ad-optimizer/src/riley-pause-execution-floor.ts` as ONE exported constant (the
   seam doc explicitly blesses raising it without touching `evidence-floor.ts`); the family
   floor (`meetsEvidenceFloor`) stays as the inner belt.
7. **Flag:** two altitudes, both default OFF. (a) Env kill switch
   `RILEY_PAUSE_SELF_EXECUTION_ENABLED` gates the whole submitter wiring in
   `apps/api/src/bootstrap/inngest.ts` (absent = the sink never receives a pause submitter;
   matches the deploy-dark convention; new env-allowlist entry). (b) Per-org
   `AgentDeployment.governanceSettings.pauseSelfExecutionEnabled === true` on Riley's
   ad-optimizer deployment (JSON column, no migration; same home as `trustLevelOverride` /
   `spendAutonomy`), read where the cron builds per-deployment deps and enforced by
   capability-passing (the runner receives the submitter only for flag-on deployments).
   **The flag is capability assignment, so flipping it is auditable:** a dedicated admin
   script (`scripts/riley-pause-flag.ts`) flips it per org, prints old -> new, and writes an
   AuditLedger row (org, actor, timestamp, both values). No silent DB mutation path is
   documented anywhere. Producer population ships in the same PR (tests exercise the ON path;
   no production org is flipped). **Rollout rule: no production org is flipped ON until PR-3
   is merged and verified.**
8. **Ownership widening (`riley_self`): STRICT TRUTH (rev 2).** Ships as its own PR.
   `riley_self` is emitted only for a recommendation whose pause submit ACTUALLY PARKED
   (submitter returns park truth; the sink result carries `pauseParkedIndex`; the runner
   computes ownership annotations after the sink from that fact). Flag off, env switch off,
   submit denied, entitlement-skipped, builder-abstained, or park failed: the report says
   `operator_approval`, never a Riley claim that is not true. This deliberately diverges from
   `mira_handoff`'s gate-based semantics: for a revenue-control plane, the report must not
   claim Riley ownership of an action Riley did not take. (The 8e ownership annotation moves
   below the Step 9 sink to read the park outcome; the report is assembled at Step 10, so no
   consumer sees a difference.)

## Governance chain (verified against origin/main)

- The engine default-denies the unregistered/unseeded intent; PR-1 seeds, in
  `seedRileyAdOptimizerDeployment` (the recipe: seed policies in the function that seeds the
  deployment), two org-scoped policies mirroring `recommendation-handoff-governance.ts`:
  anchored allow (`^adoptimizer\.campaign\.pause$`, priority 50) + require_approval with
  `approvalRequirement: "mandatory"` (priority 40).
- "mandatory" survives Riley's seeded `trustLevelOverride: "autonomous"`: the spend-approval
  autonomy lever relaxes only `approvalLevel === "standard"` decisions
  (`spend-approval-threshold.ts`), and a pause submit carries no spend amount anyway (double
  no-op). Verified in code, and pinned by a real-gate test.
- **Policy-ordering proof (rev 2):** the gate test additionally pins the decomposition: allow
  alone = execute (documents that the approval policy is load-bearing, never seed one without
  the other), approval alone = default-deny (the allow is what un-denies), both = mandatory
  park. Future engine changes cannot silently turn allow+approval into allow-wins.
- `parameterSchema` on the registration stays `{}` WITH a comment: verified decorative (zero
  non-test consumers in `packages/core/src`); a hand-written JSON schema would be dead config
  drifting from the Zod source. Real containment: the only initiator builds parameters from a
  typed builder, the trigger allowlist is internal-only, and the executor fails closed
  (`INVALID_PAUSE_INPUT` -> visible recovery, not silence). Platform-wide ingress schema
  enforcement is a separate hardening item, out of scope here.
- Entitlement gate runs on every submit (`platform-ingress.ts:175`); the cron closure maps
  `entitlement_required` to a named skip (the `org_not_entitled` convention) so unentitled orgs
  are an honest skip, not a silent no-op.
- The submit call site branches on `"approvalRequired" in response` before reading the result,
  treats `ok: true` + `result.outcome === "failed"` (governance deny) as a logged non-success,
  and treats an unexpected auto-execute as a loud error (the mandatory policy makes it
  impossible; reaching that branch means seeding broke). Idempotency key
  `mutate:riley:<recommendationId>:pause` (seam shape); an Inngest step retry that re-emits
  recommendations creates new rec ids, which can park a duplicate approval; the operator
  approves one, and a double-approved pause is a Meta no-op plus an already-paused abstain
  (same accepted noise class as the live handoff, now visible in outputs).

## What ships (three PRs, sequential)

**PR-1, dark spine (intent + governance + executor; no initiator).**
- `packages/ad-optimizer`: execution-floor module; `MetaAdsClient.getCampaignStatus` (read-only).
- `packages/schemas`: `RileyPauseExecutionInput` (+ `RileyPauseEvidence` alias seam).
- `apps/api`: builder rename + floor gate; the hardened executor workflow; bootstrap
  registration (workflow mode, internal trigger, org-aware creds resolution); approval-card
  copy for the parked pause.
- `packages/db`: the two policy seeds wired into `seedRileyAdOptimizerDeployment`.
- Tests: floor boundaries; schema; seed; real-engine gate test (mandatory park,
  autonomous-immune, default-deny, ordering decomposition, anchored no-bleed); executor unit
  suite (success, stale, org-mismatch, already-paused, not-pausable, read-degraded, no
  connection, Meta failure, invalid input, floor abstain); approve-to-dispatch loop (park,
  named never-auto-executes proof, approve -> Meta paused, reject -> untouched, failure ->
  recovery_required -> retry recovers, idempotent re-submit).
- Nothing can reach the intent: internal-trigger-only and zero callers. Grep-proof in PR body.

**PR-2, initiator (flag-gated submit-and-park from the weekly audit).**
- `packages/ad-optimizer`: pure primary-only candidate builder + `RileyPauseSubmitter`
  (returns park truth); sink threads dispatch + returns `pauseParkedIndex`; runner threads
  submitter/flag (capability-passing) + the `handoffContextByCampaign` local renames to
  `campaignEvidenceByCampaign` (it now feeds handoff + pause + ownership; type name unchanged).
- `apps/api`: submitter closure (approvalRequired branch, deny logging, entitlement named
  skip, park-truth return), env kill switch, `listActiveDeployments` flag mapping.
- `scripts/riley-pause-flag.ts`: the auditable per-org toggle.
- `scripts/env-allowlist.local-readiness.json` + `.env.example`: the env switch.
- Tests: candidate-builder table (primary-only, dropped, no-context, wrong-campaign context,
  floor, empty deploymentId); sink dispatch (primary index only, submitter-throw safe, park
  index recorded); cron loop (flag-off default = zero submits; flag-on end-to-end park ->
  approve -> Meta paused; primary-only; entitlement skip; no persisted id = no dispatch).
  Eval suites byte-identical.

**PR-3, ownership honesty (`riley_self`, strict truth).**
- `packages/schemas`: report wire accepts `riley_self` (enums collapse to one set; widening
  documented at the #923 options-equality pin).
- `packages/ad-optimizer`: ownership annotation moves post-sink and reads `pauseParkedIndex`;
  `riley_self` iff this rec's submit parked. Flag-off reports byte-identical (pinned).
- Dashboard parity tripwire untouched (riley_self does not alter risk contracts); if it reds,
  that is a finding, not a test to patch.

## Out of scope (deliberate)

- Auto-rollback, resume intent, guardrail auto-monitoring (declarations recorded only).
- Post-write observed-paused readback (request-accepted truth recorded; readback noted as the
  next execution-truth increment).
- Any second action class (each earns its own seam entry + review).
- Approval-card rich rendering beyond the humanized summary.
- CBO/shared-budget special-casing (recorded guardrail concern; operator judgment at approval).
- Platform-wide ingress parameter-schema enforcement (decorative field today; separate item).
- `HandoffCampaignContext` type rename (variable rename ships in PR-2; the type still honestly
  describes the handoff-gate context shape).
- 4d corroborated / 4e late-interval arms; trust-threshold auto-widening.

## Risks

- **Inert-feature trap:** floor `days` pinned to the real 7-day window; flag-ON path tested
  end-to-end from real producer defaults in the same PR.
- **Phantom success:** call site branches on `approvalRequired` membership AND on
  `result.outcome === "failed"` (deny) explicitly; tests pin both plus the named
  never-auto-executes proof.
- **Stale execution:** platform 24h park expiry + executor 48h `requestedAt` cap + campaign
  pre-read; `ageHours`/`previousStatus` recorded so the trace shows what was known at write
  time.
- **Cross-org execution:** resolver org-scoped by construction (verified) + executor
  `DEPLOYMENT_ORG_MISMATCH` hard failure as defense in depth.
- **Report overclaiming:** strict-truth `riley_self` (park-fact-based); no org flips until
  PR-3 verified.
- **Wrong-deployment bite:** targetHint always threaded from the cron's resolved Riley
  deployment; the gate test pins the seeded-system-principal requirement.
- **Duplicate parks on cron retry:** accepted operator noise (handoff precedent); executor and
  Meta are idempotent for double-approval and the second execution abstains
  `campaign_already_paused`.
