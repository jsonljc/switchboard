# Mira P2 — Governed "publish creative as a PAUSED ad" intent (parked Meta draft package)

> Status: **approved design**, ready for implementation plan.
> Date: 2026-06-02. Branch base: `origin/main` @ `a6b354b2`.
> This is **PR B** of a two-PR sequence (see §3). It closes the _generate → publish_
> leg of the governed creative loop as a **governed seam**, fail-loud until durable
> assets (PR A) exist.

## 1. Context

The Mira creative loop is open at "push-to-ad": `MetaAdsClient.uploadCreativeAsset` and
`createDraftAdSet` exist with **zero non-test callers**, `updateCampaignStatus("ACTIVE")`
hard-throws, and there is no `metaAdId` on `CreativeJob`
(`docs/audits/2026-06-02-mira-audit-and-autonomous-ugc-vision/`). P2a already routed
creative **generation + spend** through `PlatformIngress`
(`creative.job.submit`/`.continue`/`.stop`, PRs #810/#817/#820) and made the spend-approval
threshold real (#817). This PR adds the **publish** intent.

### What grounding revealed (verified against `origin/main`, not assumed)

The literal task ("wire `uploadCreativeAsset` + `createDraftAdSet` into a governed intent +
add `metaAdId`") cannot, on its own, produce a real publish. Three gaps:

1. **The Meta seam is incomplete.** `uploadCreativeAsset` returns a _video in the account's
   media library_; `createDraftAdSet` makes an _empty paused ad set_. Meta's object model is
   campaign → ad set → **AdCreative** → **Ad**. There is **no `createAdCreative` and no
   `createAd`** anywhere (`packages/ad-optimizer/src/meta-ads-client.ts`). Without them there
   is no Ad object and nothing to persist as `metaAdId`.
2. **The rendered asset is not durable.** The assembled MP4 lives at `/tmp/switchboard-*.mp4`
   (gone when the Inngest fn exits); clip URLs are Kling/HeyGen (expire); explicit "upload to
   R2" TODOs exist; **no R2 integration exists**; the polished pipeline does not populate
   `AssetRecord` (it stores in `CreativeJob.stageOutputs`). At parked-approval time there are
   no stable bytes to upload.
3. **No publish target is modeled.** Nothing binds a deployment to a Meta `campaignId`; Riley
   owns no campaign and only emits human-queued recommendations. `createAdCreative` also needs
   a Facebook Page id that is not modeled.

### What is solid

- **Credential resolution.** `serviceId: "meta-ads"`; `apps/api/src/lib/ads-client-factory.ts`
  looks up a `Connection` by `(id, organizationId)`, decrypts, and builds a `MetaAdsClient`
  from `creds.accessToken` + `creds.accountId`. (Used today only for _reading_ insights.)
- **Workflow-intent template** (`apps/api/src/bootstrap/contained-workflows.ts`): a `handlers`
  Map + a `workflowIntents` array; all intents register with `mutationClass: "write"`.
- **Naming win.** The seeded allow policy rule is literally `value: "creative.job.*"`
  (`packages/db/src/seed/creative-governance.ts`), so naming the intent **`creative.job.publish`**
  matches the _existing_ org-scoped allow policy — no new default-deny hole on seeded orgs.

## 2. Goal & non-goals

**Goal.** A governed `creative.job.publish` intent that, on **mandatory human approval**,
creates a **self-contained PAUSED Meta draft package** (campaign → ad set → ad creative → ad)
for a completed, human-kept creative, persists the Meta IDs on the job, and **leaves
activation to a human in Ads Manager**. The seam is correct, allow-pathed, always-parked, and
activation-unreachable; it **fails loud** (never silently no-ops, never fake-succeeds) when a
prerequisite is absent.

**Framing (locked):** this is **"Mira creates a parked Meta draft package … requiring operator
finalization,"** _not_ "Mira publishes an ad" and _not_ a Mira→Riley handoff. No Riley campaign
ownership is invented.

**Non-goals (this PR):** durable asset storage (PR A); dashboard UI / target picker; activation
(`ACTIVE`) of any kind; a deployment→campaign binding model; verifying `uploadCreativeAsset`'s
wire format against live Meta; async/dead-letter hardening of the Meta call chain (deferred to
PR A — see §11).

## 3. Scope & sequencing

- **PR A (separate, sequenced first for go-live):** durable rendered-asset persistence. Produces
  a stable URL/bytes for the assembled creative and writes it to `CreativeJob.durableAssetUrl`
  (the contract field this PR introduces, §6.2). Not built here.
- **PR B (this PR):** the governed publish seam. It fails loud on every missing prerequisite
  (`CREATIVE_ASSET_NOT_DURABLE` etc.). Failing _closed_ on a missing input is safe (unlike a safety
  gate failing _open_), so this sequencing is sound — PR B can be fully built, tested, reviewed, and
  merged now. It becomes pilot-usable only once the **three go-live blockers in §11** all land
  (PR A durable storage, PR C Page-id setter, async/dead-letter hardening) — PR B alone is honest
  but intentionally inert in prod.

## 4. The safety model (the crux)

### 4.1 `approvalPolicy` is decorative — do not rely on it

The policy engine's `determineApprovalRequirement` (`packages/core/src/engine/policy-engine.ts:414`)
computes the approval requirement as `policyApprovalOverride ?? resolvedIdentity.effectiveRiskTolerance[finalRiskCategory]`.
**It never reads `IntentRegistration.approvalPolicy`** — that field is passed into
`proposal.metadata.approvalPolicy` (`work-unit-adapter.ts:57`) and has no engine consumer.
So `approvalPolicy: "always"` does **not** force parking. Because a paused ad carries no spend,
#817's spend-lever cannot escalate it either → an allowed-but-otherwise-unconstrained publish
would **auto-execute**.

We keep `approvalPolicy: "always"` on the registration **only as documented intent**, with a
code comment that the real gate is the seeded policy below. (It is also the safe value if any
future code path ever does read it.)

### 4.2 The real gate: a seeded org-scoped `require_approval` (`mandatory`) policy

`policy-engine.ts:327` — a matched policy with `effect: "require_approval"` and an
`approvalRequirement` sets `policyApprovalOverride`. Policies compose: in the eval loop
(`policy-engine.ts:282–347`) `allow` does **not** short-circuit (only `deny` breaks), so the
existing `creative.job.*` **allow** policy and a new `creative.job.publish`
**require_approval** policy both take effect → _allowed_ **and** _mandatory approval_.

We seed (in the same per-org function that seeds the allow policy) a new org-scoped policy:

- `effect: "require_approval"`, `approvalRequirement: "mandatory"`
  (`ApprovalRequirementSchema = z.enum(["none","standard","elevated","mandatory"])`).
- rule: `{ conditions: [{ field: "actionType", operator: "matches", value: "creative.job.publish" }] }`.
- `organizationId: <org>`, `active: true`, deterministic id
  `policy_require_approval_creative_publish_<org>`, `priority: 40`.

Two reinforcing properties make this airtight:

1. **`"mandatory"` is immune to the #817 downgrade.** `applySpendApprovalThreshold`
   (`packages/core/src/platform/governance/spend-approval-threshold.ts`) only ever relaxes an
   approval whose `approvalLevel === "standard"`; `"mandatory"` is a fixed point.
2. **The spend lever is a guaranteed no-op for publish.** `extractSpendAmount`
   (`packages/core/src/engine/spend-limits.ts`) returns `null` unless one of
   `SPEND_KEYS = ["spendAmount","amount","budgetChange","newBudget"]` is present as a finite
   number in `proposal.parameters`. The publish intent's parameters carry **none** of those
   names (parameters = `{ jobId }`; the minimum campaign budget is computed _inside_ the handler,
   never a submit parameter). `spendAmount === null` short-circuits the lever to a no-op, so the
   `mandatory` decision is returned unchanged → parks.

**Producer-population rule.** The `require_approval` policy **must be seeded in the same PR** as
the intent. An org with the allow policy but not this approval policy would _auto-publish_. Orgs
with neither default-deny (fail safe). The seed function therefore installs **both**.

### 4.3 Activation stays unreachable

- `createAd` (new) hardcodes `status: "PAUSED"`; it exposes no parameter to set `ACTIVE`.
- `createDraftCampaign` / `createDraftAdSet` already hardcode `PAUSED`.
- `updateCampaignStatus("ACTIVE")` keeps its existing `throw`
  (`meta-ads-client.ts:174–179`) and is **never called** anywhere in the publish path.
- No symbol in this PR is named `activate`, `goLive`, or `publishLive`. The persisted lifecycle
  marker is `metaPublishStatus: "parked_paused"`.

### 4.4 Claim safety is gated twice

Medspa health-claim review is human-gated at every trust tier. Two independent gates:
(a) **eligibility** — only a _completed + human-kept_ creative is publishable (§6.3); and
(b) **action** — the publish itself parks at `mandatory` (§4.2). A creative that a human has not
kept can never be published, and even a kept creative cannot reach Meta without an explicit
human approval of the publish action.

### 4.5 Operator-facing copy discipline (review point 1)

The intent **key** stays `creative.job.publish` (it must match the `creative.job.*` allow policy),
but **no operator-facing surface may say "published" / "live" / "delivered."** The result is a
_paused draft_ the operator finalizes in Ads Manager. Enforced everywhere copy is emitted:

- **Route response & approval-request summary:** "Create paused Meta draft" / "Parked in Ads
  Manager — review & activate there." Never "Published."
- **WorkTrace / approval / audit summaries** (the handler's `summary`, the approval record): the
  handler returns `summary: "Created paused Meta draft package (review & activate in Ads Manager)"`.
- **`metaPublishStatus` value** is `"parked_paused"`, not `"published"`.
- A test asserts the handler `summary` and route response contain "paused draft" and do **not**
  contain the substring "publish" in any user-facing phrasing (the intent key is exempt).

## 5. End-to-end flow

1. Operator triggers `POST /creative-jobs/:id/publish` (operator-direct route, §6.5).
2. Route runs **pre-flight** `assertPublishable(orgId, jobId)` (§6.4). Any failure → an actionable
   `4xx` immediately; **the publish never parks if it cannot succeed**.
3. On pass, route calls `platformIngress.submit({ intent: "creative.job.publish",
parameters: { jobId }, … })`.
4. `GovernanceGate` evaluates: allow policy (not denied) + `require_approval(mandatory)` policy →
   **parks**. Ingress creates the WorkTrace + approval lifecycle row and returns the
   approval-required variant. Route returns **`202 PENDING_APPROVAL`** (the
   `"approvalRequired" in response` branch — §6.5).
5. Human approves via the existing approvals lifecycle. Post-approval execution dispatches the
   **workflow handler** (§6.6).
6. Handler (idempotent/resumable — §6.6) re-asserts preconditions defensively, then walks the Meta
   call chain (`uploadCreativeAsset → createDraftCampaign(min-budget) → createDraftAdSet →
createAdCreative → createAd(PAUSED)`) via an **injected** ads-client + asset-fetcher,
   **persisting each id as its object is created** (`metaVideoId/metaCampaignId/metaAdSetId/
metaCreativeId`, then `metaAdId` + `metaPublishStatus:"parked_paused"` together), reusing any
   id already present (resume), and returns `outcome: "completed"` with a "paused draft" summary.

## 6. Components

### 6.1 Meta client additions (`packages/ad-optimizer/src/meta-ads-client.ts`)

Two new methods, mirroring the existing PAUSED-only style:

```ts
async createAdCreative(params: {
  name: string;
  pageId: string;
  videoId: string;        // from uploadCreativeAsset
  imageHash?: string;     // thumbnail (optional)
  message: string;        // primary text
  linkUrl: string;        // destination (booking link)
  callToActionType?: string; // e.g. "BOOK_TRAVEL" / "LEARN_MORE"; default a safe CTA
}): Promise<{ id: string }>          // POST /{account}/adcreatives, object_story_spec.video_data

async createAd(params: {
  name: string;
  adSetId: string;
  creativeId: string;
}): Promise<{ id: string }>          // POST /{account}/ads, status: "PAUSED" HARDCODED
```

`createAd` has **no** `status` parameter. Unit tests assert the request body always carries
`status: "PAUSED"`. (The base64-JSON body of the pre-existing `uploadCreativeAsset` is unverified
against live Meta — out of scope; see §11.)

### 6.2 Schema (`packages/db/prisma/schema.prisma`, model `CreativeJob`) + migration

Add nullable columns:

| field                       | purpose                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `metaCampaignId String?`    | parked campaign id                                                                                                                 |
| `metaAdSetId String?`       | parked ad set id                                                                                                                   |
| `metaCreativeId String?`    | ad creative id                                                                                                                     |
| `metaAdId String?`          | parked **draft** ad id (not proof of live publication)                                                                             |
| `metaVideoId String?`       | uploaded creative-asset (video) id — upload checkpoint for resume (§6.6) **and** the P3 attribution join key                       |
| `metaPublishStatus String?` | `null` → `"parked_paused"` on success                                                                                              |
| `durableAssetUrl String?`   | **PR A contract**; the durable assembled-creative URL. Null until PR A. Publish fails loud `CREATIVE_ASSET_NOT_DURABLE` when null. |

Migration authored by hand (Postgres is not reachable in this worktree): generate with
`prisma migrate diff --script` then apply via `migrate deploy` (no TTY for `migrate dev`); index
names ≤ 63 chars. Run `pnpm db:check-drift` against a running Postgres before merge (or rely on
CI drift validation if local PG is unavailable). No index needed (lookups are by `id`/`taskId`).

### 6.3 Publishable eligibility

A job is publishable iff: it exists and `organizationId === actor org` (cross-org → not found);
its polished pipeline is **complete** (`currentStage === "complete"` and not `stoppedAt`); and the
human has **kept** it (`reviewDecision === "kept"`). The policy (complete **and** human-kept) is
fixed; the exact terminal-stage string and `reviewDecision` values are confirmed in TDD against
the live `CreativeJob` columns (`currentStage` / `stoppedAt` / `reviewDecision`, all present on
the model). Requiring an explicit human "keep" is gate (a) of the two-gate claim-safety model
(§4.4).

### 6.4 Pre-flight service `assertPublishable(orgId, jobId)` (`apps/api/src/services/...`)

Single source of truth, used by the route (pre-flight) **and** the handler (defensive re-check).
Returns either a resolved publish context `{ job, durableAssetUrl, connection, pageId,
adAccountId }` or a typed failure with one of these **actionable** codes:

| code                         | meaning                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `CREATIVE_JOB_NOT_FOUND`     | no such job for this org (covers cross-org)                                |
| `CREATIVE_NOT_PUBLISHABLE`   | not complete, or not human-kept                                            |
| `CREATIVE_ASSET_NOT_DURABLE` | `durableAssetUrl` is null (PR A not yet wired / failed)                    |
| `META_CONNECTION_NOT_FOUND`  | no `serviceId:"meta-ads"` Connection, or missing `accessToken`/`accountId` |
| `META_PAGE_NOT_CONFIGURED`   | no Page id resolvable (resolution order below)                             |

**Page-id resolution order** (never silently pick the first Page on the account):

1. Meta `Connection` credentials `pageId` — **the read side needs no migration**: `credentials`
   is already an (encrypted) JSON blob, so resolving `decrypt(credentials).pageId` is a pure read
   this PR adds. Else
2. org/deployment Meta config `pageId` (if such a field already exists — confirmed in TDD), else
3. fail with `META_PAGE_NOT_CONFIGURED` (actionable: "connect a Facebook Page for ads").

**The write side is the next guaranteed blocker (review point 2).** No producer sets `pageId`
today, so step 3 fires until an operator can store one. PR B ships only the **read + fail-loud**;
the operator **setter** (a small control-plane field/route that writes `credentials.pageId`, plus
validation copy) is sequenced as **PR C** — tracked so the seam is not merely landed-but-unusable
after PR A. (PR B is fully testable now: tests construct a `Connection` whose decrypted
`credentials.pageId` is set.)

### 6.5 Route `POST /creative-jobs/:id/publish` (`apps/api/src/routes/creative-pipeline.ts`)

- `// @route-class: operator-direct`; `requireOrgForMutation`; `Idempotency-Key` required.
- Runs `assertPublishable` → maps failures to `404` (`CREATIVE_JOB_NOT_FOUND`) / `409`
  (`CREATIVE_NOT_PUBLISHABLE`) / `422` (`CREATIVE_ASSET_NOT_DURABLE`, `META_CONNECTION_NOT_FOUND`,
  `META_PAGE_NOT_CONFIGURED`) with the code in the body.
- On pass: `platformIngress.submit({ intent: "creative.job.publish", parameters: { jobId }, … })`,
  actor = auth-authoritative (`request.actorId`/`orgId`, trigger `"api"`), mirroring `revenue.ts`.
- **Must branch on the approval-required variant before destructuring outputs**
  (`feedback_ingress_route_must_handle_pending_approval`): since publish _always_ parks, the
  happy path is `202 PENDING_APPROVAL` (`{ outcome:"PENDING_APPROVAL", workUnitId, traceId,
approvalRequest:{ id: lifecycleId, bindingHash } }`), exactly as `execute.ts`/`actions.ts`. Do
  not copy `revenue.ts` (which is `approvalPolicy:"none"`).
- Remove `creative-pipeline.ts` from the route-allowlist only if newly required (it is already
  off-allowlist from #810).

### 6.6 Intent registration + handler

- `contained-workflows.ts`: add `["creative.job.publish", buildCreativePublishWorkflow(deps)]` to
  the `handlers` Map and a `workflowIntents` entry: `{ intent:"creative.job.publish",
workflowId:"creative.job.publish", budgetClass:"standard", approvalPolicy:"always",
allowedTriggers:["api"] }`. The loop registers `mutationClass:"write"` (honest — reversible
  paused entity). Add a comment that the real gate is the seeded `require_approval(mandatory)`
  policy, since `approvalPolicy` is decorative.
- Handler `buildCreativePublishWorkflow` (`apps/api/src/services/workflows/creative-publish-workflow.ts`),
  shape mirrors `creative-job-decision-workflow.ts`:
  - injected deps: `resolveAdsClient(orgId) => Promise<MetaAdsClient | null>` (built on
    `buildAdsClientFactory` + the `meta-ads` Connection lookup), `fetchAsset(url) =>
Promise<{ buffer: Buffer; type: "image"|"video" }>`, and the job store. Injection keeps the
    handler unit-testable with mocks and respects layering (handler lives in apps/api, Layer 5).
  - `execute(workUnit)` — **idempotent and resumable** (review point 3), because post-approval
    execution is `retryable:true` and a naïve "create everything, persist at the end" would orphan
    or duplicate paused Meta objects on a mid-chain failure/retry:
    1. **Short-circuit:** if `metaPublishStatus === "parked_paused"` and `metaAdId` is set →
       return `completed` with the existing IDs (zero Meta calls).
    2. **Defensive re-check:** re-run `assertPublishable` (state may have changed between submit
       and approval) → on failure return `{ outcome:"failed", error:{ code, message } }`
       (no throw, no phantom success).
    3. **Checkpoint-resume chain** (§4.3 paused-only): for each Meta object, if the job already
       carries its id, **reuse it (skip the create)**; otherwise create it and **persist that id
       immediately** before the next step. Order + checkpoint column:
       `uploadCreativeAsset → metaVideoId`, `createDraftCampaign(min-budget) → metaCampaignId`,
       `createDraftAdSet → metaAdSetId`, `createAdCreative → metaCreativeId`,
       `createAd(PAUSED) → metaAdId` **and** `metaPublishStatus:"parked_paused"` in the same write
       (the terminal checkpoint).
    4. Any Meta call failure → `{ outcome:"failed", error:{ code:"CREATIVE_PUBLISH_META_ERROR",
message:<surfaced Meta message> } }`. The already-persisted checkpoints let the next retry
       resume exactly where it stopped — no orphans, no duplicates.
    5. On completion return `{ outcome:"completed",
summary:"Created paused Meta draft package (review & activate in Ads Manager)",
outputs:{ metaAdId, metaAdSetId, metaCreativeId, metaCampaignId } }` (copy per §4.5).
  - **Budget:** the campaign uses a `MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS` constant — a
    placeholder _daily_ budget in the account's currency **minor units** (`createDraftCampaign`
    takes `{ daily: number }` in minor units) — set **only** on the PAUSED campaign and **never**
    activated. It is not a submit parameter (so never a `SPEND_KEY`, §4.2) and not
    operator-supplied. **Caveat (review point 4):** Meta's minimum valid daily budget varies by
    account currency and (for some) objective/bid strategy, so a single global constant may be
    rejected in some markets; PR B uses a conservative documented placeholder and surfaces any Meta
    rejection as `CREATIVE_PUBLISH_META_ERROR` (fail-loud, not silent). A currency-aware value
    (deriving from the account currency, which `getAccountSummary` exposes) is a go-live refinement
    — deferred only because the path cannot execute until PR A. Audit/approval copy: "A placeholder
    minimum budget is used only because Meta requires one; the ad remains paused." A test asserts
    the created campaign is PAUSED.
  - **Inline orchestration** is correct for PR B (synchronous → doctrine #7's dead-letter
    requirement does not apply; a failure is a normal failed WorkUnit) and is made safe-to-retry by
    the checkpoint-resume above. It is **NOT** production-grade for latency (the client self-rate-
    limits 60s/call across ~5 calls); per review point 5, moving it to a dead-lettered Inngest fn
    is a **blocking precondition for any pilot traffic** (§11), not an optional follow-up.

### 6.7 Seed (`packages/db/src/seed/creative-governance.ts` + `seed-mira-creative-deployment.ts`)

Add `buildCreativePublishApprovalPolicyInput(orgId)` next to `buildCreativeAllowPolicyInput`, and
upsert it inside `seedMiraCreativeDeployment` (alongside the existing allow-policy upsert), so the
allow + mandatory-approval policies are always installed together (§4.2). Shared by seed **and**
the real-gate test so they cannot drift (`feedback_safety_gate_needs_producer_population`).

## 7. Failure modes

Every prerequisite gap is a **loud, typed failure** with an actionable code (§6.4), surfaced as a
`4xx` at the route (pre-flight) and as a `failed` WorkUnit outcome in the handler (defensive). No
silent no-op, no fake `2xx`. In prod today (no `durableAssetUrl`, no Page config) publish returns
`CREATIVE_ASSET_NOT_DURABLE` / `META_PAGE_NOT_CONFIGURED` — by design, until PR A + Page config.

## 8. Test plan (TDD, real behavior — not spy-ingress)

Governance/safety tests drive the **real `GovernanceGate`** with the **seeded policies**, and the
Meta seam via a **mock `MetaAdsClient`** (no live Meta, no real rate-limit). Mirror the
`apps/api` real-gate test style introduced by #817.

1. **Parks at `mandatory`** — submit `creative.job.publish` through the real gate with the seeded
   allow + require_approval policies → decision is `require_approval`, `approvalLevel:"mandatory"`
   (not `execute`). Regression-locks the decorative-`approvalPolicy` trap.
2. **Allow-pathed, not default-denied** — same submit on a seeded org is not `deny`; an **un-seeded**
   org default-denies (fail safe).
3. **Spend lever is a no-op** — assert `extractSpendAmount({ jobId })` is `null` (locks "no SPEND_KEYS
   in publish params"); and that `applySpendApprovalThreshold` leaves a `mandatory` decision
   unchanged even under the autonomous + `spendAutonomy` posture.
4. **Paused-only** — handler happy path: the mock records `status:"PAUSED"` for campaign, ad set,
   and ad (assert each).
5. **Activation unreachable** — `updateCampaignStatus` is never called with `"ACTIVE"` in the
   publish path; and calling `updateCampaignStatus(id,"ACTIVE")` throws (lock the existing guard).
6. **Persistence** — after a successful handler run, the job has `metaVideoId/metaCampaignId/
metaAdSetId/metaCreativeId/metaAdId` and `metaPublishStatus:"parked_paused"`.
7. **Fail-loud** — each missing prerequisite yields its code: `CREATIVE_JOB_NOT_FOUND` (incl.
   cross-org), `CREATIVE_NOT_PUBLISHABLE`, `CREATIVE_ASSET_NOT_DURABLE`, `META_CONNECTION_NOT_FOUND`,
   `META_PAGE_NOT_CONFIGURED` — at route (4xx) and handler (`failed`).
8. **Route 202** — when the gate parks, the route returns `202 PENDING_APPROVAL` with the approval
   envelope, not a phantom `2xx` with empty outputs.
9. **Meta client units** — `createAdCreative` builds a well-formed `object_story_spec`; `createAd`
   always sends `status:"PAUSED"` and offers no way to send `ACTIVE`.
10. **Seed unit** — `seedMiraCreativeDeployment` upserts both the allow policy and the
    `require_approval(mandatory)` publish policy (idempotent).
11. **Idempotency / resume** (review point 3): (a) a fully-parked job
    (`metaPublishStatus:"parked_paused"` + `metaAdId`) → handler short-circuits to `completed`
    with **zero** Meta calls; (b) a partial-state job (e.g. `metaCampaignId` set, `metaAdId` null)
    → handler **reuses** the campaign (the `createDraftCampaign` mock is **not** called again) and
    creates only the remaining objects (no duplicate campaign); (c) a Meta failure mid-chain
    persists the checkpoints completed so far and returns `failed` with `CREATIVE_PUBLISH_META_ERROR`,
    and a subsequent run resumes from the last checkpoint.
12. **Copy discipline** (review point 1): the handler `summary` and the route/approval response
    contain "paused draft" / "Ads Manager" and do **not** present the action as "published" or
    "live"; `metaPublishStatus` is `"parked_paused"` (the `creative.job.publish` intent key is
    exempt).

## 9. Files touched

| layer           | path                                                                    | change                                          |
| --------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| L2 ad-optimizer | `packages/ad-optimizer/src/meta-ads-client.ts` (+ test)                 | `createAdCreative`, `createAd`                  |
| L4 db           | `packages/db/prisma/schema.prisma` + migration                          | `CreativeJob` meta fields + `durableAssetUrl`   |
| L4 db           | `packages/db/src/seed/creative-governance.ts` (+ test)                  | `buildCreativePublishApprovalPolicyInput`       |
| L4 db           | `packages/db/src/seed/seed-mira-creative-deployment.ts` (+ test)        | upsert the publish approval policy              |
| L5 api          | `apps/api/src/services/creative-publish-preconditions.ts` (+ test)      | `assertPublishable`                             |
| L5 api          | `apps/api/src/services/workflows/creative-publish-workflow.ts` (+ test) | handler                                         |
| L5 api          | `apps/api/src/bootstrap/contained-workflows.ts`                         | register intent + handler + deps                |
| L5 api          | `apps/api/src/routes/creative-pipeline.ts` (+ test)                     | `POST /:id/publish`, 202 branch                 |
| L5 api          | real-gate test                                                          | parks-at-mandatory / allow-pathed / spend-no-op |

Layering respected: the Meta client stays in `ad-optimizer` (L2); all wiring/orchestration is in
`apps/api` (L5). `creative-pipeline` (L2) is **not** made to import `ad-optimizer`.

## 10. Conventions / gates

ESM `.js` import extensions; no `any`; no `console.log`; prettier (`pnpm format:check`); co-located
`*.test.ts`; Conventional Commits (lowercase subject first word). Before done: `pnpm typecheck`,
`pnpm --filter @switchboard/api test` (+ `ad-optimizer`, `db`), `pnpm lint`, the route-ingress
check, `pnpm db:check-drift`. New env var (if any) → env-allowlist.

## 11. Open risks & sequencing

PR B lands the governed seam in isolation (fail-loud, fully tested). It is honest but **not
pilot-usable** on its own. The following are tracked, and the three marked **[GO-LIVE BLOCKER]**
must all land before publish is enabled for **any** pilot org — none is an optional "follow-up."

- **PR A — durable storage [GO-LIVE BLOCKER]** (sequenced first): populate
  `CreativeJob.durableAssetUrl` with a stable assembled-creative URL. Until then publish fails loud
  `CREATIVE_ASSET_NOT_DURABLE` (by design).
- **PR C — Page-id setter [GO-LIVE BLOCKER]** (review point 2): a small control-plane field/route
  that writes `credentials.pageId` (+ validation copy). PR B ships only the read + fail-loud; until
  PR C, publish fails loud `META_PAGE_NOT_CONFIGURED`.
- **Async hardening [GO-LIVE BLOCKER]** (review point 5): move the Meta chain from the inline
  handler into a **dead-lettered Inngest function** (doctrine #7: `onFailure` →
  `infrastructure.job.retry_exhausted` ledger + `creative.publish.failed` event), because
  `MetaAdsClient` self-rate-limits 60s/call (`RATE_LIMIT_MS`) across ~5 sequential calls. The
  checkpoint-resume columns (§6.6) carry over directly to Inngest `step.run` isolation. The inline
  handler must **not** serve pilot traffic.
- **Meta wire format** (validate before go-live): `uploadCreativeAsset`'s base64-JSON body is
  unverified against live Meta; proven here only via mock. Validate against a real ad account, and
  adopt a **currency-aware** minimum daily budget (§6.6 budget caveat) at the same time.
- **P3 attribution** (future) consumes `metaVideoId`/`metaAdId` (video_id → AssetRecord → ROAS);
  out of scope here. The `metaVideoId` checkpoint column added in PR B is the join key.
