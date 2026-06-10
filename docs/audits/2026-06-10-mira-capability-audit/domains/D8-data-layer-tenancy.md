# D8. Data layer and tenancy

Domain auditor: d8. Date: 2026-06-10. Worktree branch `docs/mira-capability-audit`, baseline `origin/main` at 84083f0c.

Verification pass (2026-06-10): every finding independently re-checked against live code at 84083f0c, adversarially. All nine findings confirmed at their stated severities; zero refuted. Two citations qualified with full paths in place (the decision workflow lives under `apps/api/src/services/workflows/`, the creative descriptor under `packages/creative-pipeline/src/`).

Independent verifier-corrector pass (2026-06-10, second agent): all nine findings re-verified from scratch against live code at 84083f0c, attempting refutation of each. Zero refuted; severities stand. One citation corrected in D8-F7 (`Receipt.amount` is `Int?`, optional, not `Int`; the integer-cents contrast still holds). D8-F3 counter-evidence hunted and excluded: the production provisioning runbook (commit 9f213538, branch `docs/provisioning-runbook`) is not an ancestor of this baseline, and the Mira pilot runbook (28 lines total) never mentions `seedMiraCreativeDeployment`.

## Scope and method

Every Prisma model Mira touches, read from live source in this worktree: `CreativeJob`, the computed Mira creative read model, `DeploymentMemory` (+ evidence), `ConsentRecord`, `CreatorIdentity`, `AssetRecord`, `PcdIdentitySnapshot`, `ProductIdentity`, `AgentDeployment` (skillSlug "creative"), `AgentTask`, `Connection` / `DeploymentConnection`, and `ConversionRecord` where the creative attribution sweep reads it. For each: field semantics, org scoping of every query and mutation, unique constraints and dedup axes, migration coverage. Plus the six seeds (`seed-mira-creative-deployment`, `seed-mira-pilot-orgs`, `seed-mira-demo-creatives`, `seed-org-day-one-agents`, `creative-governance`, `recommendation-handoff-governance`), credential encryption and redaction, the durable asset storage path against the 2026-06-03 spec, PII/likeness data at rest, and money-as-float checks. Method: read stores, then chase every consumer outward (routes, workflows, Inngest crons, bootstrap wiring); grep for fixes before asserting any prior-session hypothesis. No servers run, no DB mutated.

## Capability map

| Capability                                                                                                          | State on main                                                                                                                                                                 | Evidence                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CreativeJob persistence (brief, dual lifecycle polished/ugc, publish checkpoints, review decision, taste watermark) | Working. Every post-create mutation is org-scoped `updateMany` with a `count===0` throw                                                                                       | `packages/db/src/stores/prisma-creative-job-store.ts:116-433`; columns + indexes `packages/db/prisma/schema.prisma:1366-1440`                                                                                               |
| Mira creative read model                                                                                            | Working at M1 scale: computed in memory from an org-scoped fetch (cap 200), `readOne` escape hatch is org-scoped findFirst                                                    | `packages/db/src/stores/prisma-mira-creative-read-model-reader.ts:27-31,49-66`                                                                                                                                              |
| Review decision write (Keep/Pass)                                                                                   | Working: org-scoped `updateMany` + count guard, enablement-gated, reversible null                                                                                             | `apps/api/src/routes/agent-home/mira-decision.ts:59-63`                                                                                                                                                                     |
| Taste memory substrate (DeploymentMemory)                                                                           | Working: content-deterministic buckets, canonicalKey dedup axis, P2002 race catch, cap eviction, org-scoped writes; read side org+deployment scoped with surfacing thresholds | `apps/api/src/services/cron/creative-taste-sweep.ts:32-44,160-189`; `packages/db/src/stores/prisma-deployment-memory-store.ts:32-48`; `apps/api/src/services/creative-taste-context.ts:49-69`                               |
| Creative attribution persistence (pastPerformance)                                                                  | Working: typed snapshot, cents kept integer in `booked.valueCents`, no-downgrade rule, org-scoped write treats count 0 as vanished-skip                                       | `apps/api/src/services/cron/creative-attribution.ts:162-206,296-308`; `packages/db/src/stores/prisma-conversion-record-store.ts:264-297`                                                                                    |
| Durable asset storage (S3/R2)                                                                                       | Working as spec'd: public-read bucket, deterministic per-job cuid key, env-gated, fails loud at publish when unset; UGC final assets included                                 | `apps/api/src/lib/creative-asset-storage.ts:39-90`; `packages/creative-pipeline/src/stages/video-producer.ts:259-277`; `packages/creative-pipeline/src/ugc/phases/production.ts:311-348`                                    |
| Provider credentials (HeyGen, Kling, ElevenLabs)                                                                    | Platform-global env keys only; no per-org rows, nothing at rest in DB                                                                                                         | `apps/api/src/bootstrap/inngest.ts:234-240`; `packages/creative-pipeline/src/stages/run-stage.ts:144,155`                                                                                                                   |
| Meta credentials for publish/attribution                                                                            | Working: org-scoped `Connection` (serviceId "meta-ads"), AES-256-GCM at rest, RMW merge preserves sibling keys, GET routes redact to "\*\*\*"                                 | `packages/db/src/crypto/credentials.ts:23-78`; `packages/db/src/storage/prisma-connection-store.ts:99-152`; `apps/api/src/routes/connections.ts:11-16,116,160`                                                              |
| PCD identity registry (CreatorIdentity, ConsentRecord, AssetRecord, snapshots)                                      | Schema and stores present; mutations unscoped by tenant (deferred to #643); consent state never enforced in any code path                                                     | `packages/db/src/stores/prisma-consent-record-store.ts:42-48`; `prisma-creator-identity-store.ts:50-91`; `prisma-asset-record-store.ts:100-121`                                                                             |
| Seeds as a governed default org                                                                                     | Coherent for `org_dev` only (enablement + deployment + 5 policies + house creator + demo drafts); production orgs get day-one agents only                                     | `packages/db/prisma/seed.ts:95,611,642`; `apps/api/src/routes/organizations.ts:88`; `packages/db/src/seed/creative-governance.ts:20-24`                                                                                     |
| Demo/live partitioning                                                                                              | Partial: demo creatives gated by NODE*ENV and `dev*` id prefix only; no origin column on CreativeJob (ConversionRecord has one and attribution filters on it)                 | `packages/db/src/seed/seed-mira-demo-creatives.ts:19-31`; `packages/db/src/stores/prisma-conversion-record-store.ts:275`                                                                                                    |
| Migration coverage for creative columns                                                                             | Working: review decision, taste watermark, meta publish set, PCD registry all have matching migrations; hand-written index name matches Prisma generation                     | `packages/db/prisma/migrations/20260530130000_creative_job_review_decision/migration.sql:7`; `20260603000000_creative_job_meta_publish`; `20260604150000_creative_job_taste_captured_at`; `20260428065707_pcd_registry_sp1` |

## Findings

### D8-F1 (P1, verified) ConsentRecord revoke and read are still tenant-unscoped

Claim: `PrismaConsentRecordStore.revoke(id)` mutates any organization's consent record by bare id, and `getById(id)` reads cross-tenant; the 2026-06-05 hypothesis is confirmed unfixed on main.

Evidence: `packages/db/src/stores/prisma-consent-record-store.ts:42-48`: "route-governance: store-mutation-deferred ... tracked for Round-3 tenant-isolation sweep in #643" directly above `this.prisma.consentRecord.update({ where: { id }, data: { revoked: true, revokedAt: new Date() } })`. `getById` at :36-40 is `findUnique({ where: { id } })`. The model has an `orgId` column (`schema.prisma:2230`), so scoping needs no migration. Mitigation: grep shows no consumer outside `packages/db` (only the index export and the store test), so the defect is latent, not reachable from a route today. Last touched by #645 per `git log`.

Impact: ConsentRecord is the likeness kill-switch for real-person creators in medspa UGC. The day a consent route ships, the unscoped revoke is a cross-tenant mutation primitive on exactly the record class regulators care about, and the unscoped read returns `personName` and `recordingUri` (PII) across tenants.

Recommendation: scope both now: `getById(orgId, id)` via findFirst, `revoke(orgId, id)` via `updateMany` + `count===0` throw, matching the sibling stores. Do not wait for the #643 sweep since this one needs no schema change.

Tag: extends (#643 tenant-isolation sweep). Effort: S.

### D8-F2 (P1, verified) Likeness consent is stored but never enforced anywhere

Claim: no code path in `creative-pipeline`, `apps/api`, or `core` reads `ConsentRecord.revoked`, `expiresAt`, or even `CreatorIdentity.consentRecordId` before generating or publishing with a creator identity; the consent substrate is storage-only.

Evidence: `grep -rn "consentRecord|revoked" packages/creative-pipeline/src` returns zero hits; the same grep over `apps/api/src` and `packages/core/src` (excluding the unrelated contact-messaging consent stores) returns zero hits. The schema wires it (`schema.prisma:1465-1466` `consentRecordId String?` with relation; `2228-2248` revoked/expiresAt/scopeOfUse/territory/mediaTypes), `PcdIdentitySnapshot` even snapshots `consentRecordId` per asset (`prisma-pcd-identity-snapshot-store.ts:15`), and the production phase casts creators with no consent check (`packages/creative-pipeline/src/ugc/phases/production.ts`). Today the only seeded creator is synthetic ("Not a real person; no likeness rights involved", `seed-mira-creative-deployment.ts:168-170`), which is why nothing has burned.

Impact: the north star is SG/MY aesthetic clinics; real clinician/patient likeness in UGC is the first thing a pilot will ask for, and PDPA-adjacent likeness consent is the compliance surface. First real creator onboarded renders and can be human-approved for publish with revoked or expired consent and no system objection.

Recommendation: a consent gate where creators are cast (deny creators whose `consentRecordId` is null unless `qualityTier === "stock"`/synthetic, deny revoked or expired) plus a publish precondition in `assertPublishable` for the creator behind the kept job. Both are reads on existing columns.

Tag: new. Effort: M.

### D8-F3 (P1, verified) Pilot provisioning is split-brain: enablement seed flips the UI, governance seed never runs for real orgs

Claim: `seedMiraPilotOrgs` flips only `OrgAgentEnablement`, while the deployment, all five policies, the spend threshold, and the house creator ride `seedMiraCreativeDeployment`, which is invoked exactly once, for `org_dev`, in the dev seed; a real pilot org enabled by the documented path gets a visible /mira whose every intent default-denies.

Evidence: `packages/db/src/seed/seed-mira-pilot-orgs.ts:12-20` (enablement upsert only). `packages/db/prisma/seed.ts:611` is the sole non-test caller of `seedMiraCreativeDeployment`. The signup path seeds day-one agents only (`apps/api/src/routes/organizations.ts:88`; Mira is day-thirty by design, `seed-org-day-one-agents.ts:6-7`). The governance file itself documents the hole: "a pilot org needs seedMiraCreativeDeployment(org) run explicitly or creative.job.\* default-denies" (`packages/db/src/seed/creative-governance.ts:23-24`). Verification corroboration: the documented pilot path (`docs/runbooks/2026-05-29-mira-pilot-enablement.md:9-16`) runs only `seedMiraPilotOrgs` against the deployed DB. Without the governance seed: `creative.job.submit/continue/stop/publish`, `creative.brief.compose` (the self-brief cron), and both `adoptimizer.recommendation.handoff` policies (seeded at `seed-mira-creative-deployment.ts:107-121`) all default-deny, and the Alex to Mira draft resolver fails closed `DEPLOYMENT_NOT_FOUND`.

Impact: fails closed, so it is not a safety break, but it inertly blocks the entire Mira leg of the revenue loop for any org provisioned outside the dev seed: no drafts, no renders, no Riley handoff, no self-brief.

Recommendation: make the pilot-enablement path call `seedMiraCreativeDeployment(orgId)` (idempotent by construction) or fold both into one provisioning entry point in the provisioning runbook; add a smoke assertion that an enabled org has the creative deployment and the five policy rows.

Tag: planned (creative-governance.ts names it the pending pilot-enablement workstream; the provisioning runbook is the active branch context). Effort: M.

### D8-F4 (P2, verified) CreatorIdentity and AssetRecord have no organizationId, so their mutations cannot be tenant-scoped without a migration

Claim: `CreatorIdentity` (org reachable only via `deploymentId` string, no Prisma relation) and `AssetRecord` (via `jobId` join) carry no org column, and all their update methods mutate by bare id.

Evidence: `schema.prisma:1442-1479` and `1481-1519` (no organizationId, no relation to AgentDeployment). `prisma-creator-identity-store.ts:54` annotates each of `update/approve/deactivate/setQualityTier/attachConsentRecord`: "org reachable only via an FK with no Prisma @relation; tenant-scoping needs a schema migration. Tracked in #643." Same for `prisma-asset-record-store.ts:100-121` (`updateApprovalState`, `updateQaMetrics`). Mitigation verified: the only constructors are in `apps/api/src/bootstrap/inngest.ts:232-233`, feeding pipeline internals whose ids come from org-validated jobs; nothing routes user-supplied ids into these stores today. The `AssetRecord` dedup axis is safe cross-org because `specId = createId()` (`packages/creative-pipeline/src/ugc/phases/scripting.ts:162`), refuting the collision hypothesis.

Impact: every future consumer (an approval UI for assets, a creator management screen, both plausible Mira surfaces) inherits an unscopable mutation by construction.

Recommendation: in the #643 sweep, add `organizationId` to both models, backfill via the job/deployment join in the migration, then convert mutations to org-scoped `updateMany` + count guard. Until then keep these stores out of route reach.

Tag: extends (#643). Effort: M.

### D8-F5 (P2, verified) Demo creatives are partitioned by naming convention only, and one fixture leaks into the taste memory

Claim: demo CreativeJobs are distinguishable from live data only by the `dev_mira_demo_` id prefix plus a NODE_ENV guard; the platform's existing `origin` partitioning axis (on ConversionRecord) is not applied, and the seeded kept demo row is a live taste-sweep candidate.

Evidence: `seed-mira-demo-creatives.ts:19-22` (NODE_ENV=production skip), `:57-73` (`dev_mira_demo_kept` with `reviewDecision: "kept"`). `listTasteCandidates` selects on `reviewDecision != null` with no origin/prefix filter (`prisma-creative-job-store.ts:283-295`), so the dev sweep writes a fixture-derived bucket `taste:kept_polished_none` (demo stageOutputs has no hooks, so descriptor falls back to "none", `packages/creative-pipeline/src/creative-descriptor.ts:61-64`). Bounded today: surfacing needs sourceCount >= 3 (`creative-taste-context.ts:52-54`) and the fixture contributes 1, but a dev operator re-deciding demo cards re-stamps `reviewDecidedAt` to now() and grows sourceCount past the threshold. Attribution is clean (`listPublished` requires `metaCampaignId`, demo rows have none; ConversionRecord queries pin `origin: "live"`, `prisma-conversion-record-store.ts:275`). Also the seed attaches drafts to `findFirst` of ANY org deployment (`seed-mira-demo-creatives.ts:23`), so demo rows and their taste buckets can land on a non-creative deployment.

Impact: dev/staging only by the env gate, but Mira's learned taste is the compounding asset; the protection against fixture taste is an accident of thresholds, not a partition. The fixtures-as-product-copy failure class is known in this repo.

Recommendation: smallest fix: exclude `id startsWith "dev_"` in `listTasteCandidates`, and pin the demo seed to the creative deployment (`skillSlug: "creative"`). Better: add `origin` to CreativeJob mirroring ConversionRecord and filter sweeps on it.

Tag: new. Effort: S.

### D8-F6 (P2, verified) assertPublishable ignores Connection.status, so a dead Meta connection burns a human approval

Claim: the publish pre-flight accepts a meta-ads Connection in any status, unlike the spend provider which requires `status: "connected"`; a revoked/errored connection passes pre-flight, parks the mandatory approval, then fails post-approval at the Meta call.

Evidence: `apps/api/src/services/creative-publish-preconditions.ts:80-83` `findFirst({ where: { serviceId: META_ADS_SERVICE_ID, organizationId }, ... })` with no status condition; contrast `apps/api/src/lib/meta-spend-provider.ts:52` `where: { organizationId: orgId, serviceId: "meta-ads", status: "connected" }`. The attribution resolver (`creative-attribution.ts:378-381`) also omits status but degrades to a graceful no-op, which is acceptable there. Publish instead consumes the operator's approval and dead-letters (`creative-publish-function.ts:91-95`).

Impact: the human-approval loop is the product's trust surface; approvals that predictably fail downstream erode it and waste the (rate-limited) Meta window.

Recommendation: add `status: "connected"` to the pre-flight where clause, or check status and return a typed `META_CONNECTION_NOT_FOUND` variant naming the status.

Tag: new. Effort: S.

### D8-F7 (P2, verified) Money fields around the creative loop are Float dollars or cents-by-convention, with no integer guard at the write

Claim: `AssetRecord.costEstimate` (Float, dollars), `AgentDeployment.spendApprovalThreshold` (Float, dollars, default 50), and `ConversionRecord.value` (Float documented as cents) carry money in floats; the creative attribution sum stays exact only while every writer happens to write integer cents.

Evidence: `schema.prisma:1504` `costEstimate Float?`; `:1138` `spendApprovalThreshold Float @default(50)`; `:2057` `value Float @default(0)` with `packages/schemas/src/conversion.ts:44` "Economic value in MINOR currency units (cents)". The attribution sweep aggregates `_sum: { value: true }` into `valueCents` (`prisma-conversion-record-store.ts:280,292`) and normalizes only inside `trueRoasFromCents` (`creative-attribution.ts:203`). Mitigating contrast: `Receipt.amount Int?` (`schema.prisma:2093`) and the publish budget is integer minor units (`creative-publish-function.ts:15`). For the spend gate the values are estimates compared to a tunable threshold, so float precision is not a correctness break.

Impact: low for gating, but a single writer recording dollars (the CUX spec already got dollars vs cents wrong once, per project history) silently corrupts `trueRoas`, the exact number the Mira/Riley loop reallocates budget on.

Recommendation: short term, `Number.isFinite` + `Number.isInteger` guard at the ConversionRecord write path; long term migrate `value` to Int cents alongside the platform-wide float-cents cleanup.

Tag: extends (known platform-wide precision smell). Effort: S for the guard, M for the migration.

### D8-F8 (P2, verified) Durable assets are public, permanent, and have no deletion lifecycle; consent revocation cannot purge bytes

Claim: assembled creatives live forever at a public URL whose only secret is the cuid jobId, the storage client has no delete operation, and nothing removes objects on job deletion or consent revocation; the UGC path also carries a dead `"unknown"` key fallback that would cross-org-share a namespace if ever reached.

Evidence: public-read + deterministic key is the locked spec decision ("public-read object + stable URL ... The unguessable key is the disclosure mitigation", `docs/superpowers/specs/2026-06-03-creative-durable-asset-storage-design.md` section 3.2), implemented at `apps/api/src/lib/creative-asset-storage.ts:14-18,53-54` and `video-producer.ts:264`. `S3CreativeAssetStorage` exposes only `upload` (`creative-asset-storage.ts:39-55`). UGC fallback: `` `creative-assets/${spec.jobId ?? "unknown"}/ugc-${spec.specId}.mp4` `` (`production.ts:335`); live-dead because the runner stamps `jobId: ctx.job.id` on every spec (`ugc-job-runner.ts:177-180`), and the paired `upsertByKey({ jobId: "unknown" })` would FK-throw anyway (AssetRecord.jobId references CreativeJob).

Impact: combined with D8-F2, a likeness-consent revocation cannot actually take a rendered face off the public internet; the URL is permanent by design. For paused Meta drafts this is tolerable, for real-person UGC it is not.

Recommendation: add `delete(key)` to the storage interface and call it from a consent-revocation/job-deletion lifecycle (the keys are deterministic from jobId, so deletion needs no new bookkeeping); drop the `?? "unknown"` fallback in favor of a loud throw.

Tag: extends (the spec consciously deferred private access; deletion lifecycle is the missing follow-up). Effort: M.

### D8-F9 (P2, verified) Unscoped point reads compensated per-consumer, and one decrypt-before-tenant-check

Claim: `PrismaCreativeJobStore.findById/findByTaskId` and `assertMode` are tenant-unscoped, with every current consumer compensating by a post-fetch org check; `ConnectionStore.getById` additionally decrypts credentials before the route's org check runs.

Evidence: `prisma-creative-job-store.ts:91-101` (bare findUnique), `:61` (assertMode findUnique). Compensations verified at `apps/api/src/routes/creative-pipeline.ts:148,192,247` (`!job || job.organizationId !== orgId`), `apps/api/src/services/workflows/creative-job-decision-workflow.ts:19-20`, `creative-publish-preconditions.ts:54`, and the publish function re-validates via assertPublishable on every (re)entry before its unscoped checkpoint reads (`creative-publish-function.ts:104-106`). Connections: `prisma-connection-store.ts:56-60` getById decrypts via `toConnectionRecord`, and the route checks org only afterwards (`apps/api/src/routes/connections.ts:144-156`), inverting the check-then-decrypt discipline that `mergeCredentialsById` documents (`prisma-connection-store.ts:119-127`).

Impact: no live leak found, but the pattern means every new consumer of a point read must remember the org check; the readOne reader (`prisma-mira-creative-read-model-reader.ts:54-56`) already shows the safer shape.

Recommendation: add org-scoped variants (`findByIdForOrg(orgId, id)` findFirst) and migrate route/workflow consumers; make ConnectionStore.getById take the org and filter in the where clause so cross-org secrets never decrypt in memory.

Tag: new. Effort: S.

## What is sound

The CreativeJob write surface is the repo's reference implementation of tenancy discipline: ten mutation methods, all org-scoped `updateMany` with `count===0` throwing `StaleVersionError`, callers distinguishing benign vanish (attribution sweep `creative-attribution.ts:303-307`) from hard failure. The taste sweep matches the DeploymentMemory dedup recipe exactly: content is a pure function of the bucket so the content unique constraint (`schema.prisma:783`) backs the canonicalKey dedup, P2002 races re-find and increment (`creative-taste-sweep.ts:174-187`), cap admission evicts strictly weaker rows, and the watermark stores the observed decision time, never wall clock. `listTasteCandidates` explicitly engineers around the SQL take-before-filter starvation class with two bounded legs (`prisma-creative-job-store.ts:252-307`). Credential handling is solid where Mira actually touches it: AES-256-GCM with per-record scrypt salt (`credentials.ts:35-46`), org-scoped read-modify-write merge preserving sibling keys (`prisma-connection-store.ts:128-152`), full redaction on every GET (`connections.ts:11-16`), and decrypted Meta tokens deliberately kept out of Inngest step state (`creative-publish-function.ts:104-107`, `creative-attribution.ts:236-238`). Migrations exist and match for every creative column including the hand-written index name (`20260530130000` comment notes the Prisma-generated name requirement). Both creative crons carry the doctrine-7 onFailure dead-letter contract (`creative-taste-sweep.ts:266-287`, `creative-attribution.ts:329-354`). The dev seed produces a genuinely coherent governed org for `org_dev`: enablement, active deployment, spend threshold sized so the gate is demonstrably live ($15 against a $1 to $21 cost model), allow + mandatory-approval policy pairs for publish and handoff, and a synthetic house creator that cannot be picked up by avatar routing.

## Open questions

1. `PrismaConnectionStore.save` upserts global connections with `organizationId: connection.organizationId ?? ""` in the compound-unique where (`prisma-connection-store.ts:25-31`); a stored global row has NULL org, "" never matches it, and Postgres treats NULLs as distinct in unique constraints, so repeated saves of a global connection should accumulate duplicate rows and make `getByServiceGlobal` nondeterministic. Mira's flows use org-scoped meta-ads rows so this sits outside my scope, but a platform owner should confirm and fix.
2. The Keep/Pass route mutates CreativeJob directly via Prisma rather than PlatformIngress (`mira-decision.ts:59-63`, route-class "lifecycle"). Project history says /approve to PlatformIngress migration is pending for Mira M1; the governance/ingress domain auditor should own whether this stays an allowlisted direct write.
3. `DeploymentMemory`'s unique constraint includes the unbounded `content` String (`schema.prisma:783`); taste content is short by construction, but other writers could exceed btree index row limits. Worth a platform-level length guard.
4. A stale standalone build artifact (`apps/dashboard/.next/standalone/.claude/worktrees/f-15-chat-ingress-auth/...`) shadows live sources in greps; build hygiene, not a data defect, but it can mislead future audits.

## Refuted during verification

None. All nine findings survived adversarial re-verification against live code at 84083f0c: consent-store consumers re-grepped (none outside `packages/db`), consent enforcement re-grepped across creative-pipeline/api/core (zero hits), the seed call graph re-traced (`seed.ts:611` remains the sole non-test `seedMiraCreativeDeployment` caller and the pilot runbook runs only the enablement seed), the publish pre-flight vs spend-provider status contrast re-read, the demo-fixture taste path re-traced through `listTasteCandidates` and `SURFACING_THRESHOLD` (minSourceCount 3, `packages/schemas/src/deployment-memory.ts:85`), the storage interface confirmed upload-only with the UGC "unknown" fallback live-dead, the money-field types confirmed in schema, and the decrypt-before-org-check confirmed in `toConnectionRecord` (`prisma-connection-store.ts:172`) behind the route's post-fetch check.
