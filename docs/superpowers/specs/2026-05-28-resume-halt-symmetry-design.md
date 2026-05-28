# Resume/Halt Symmetry — Design

## Goal

Emergency halt is org-wide; resume must be its exact inverse. Today resume is
asymmetric and leaves part of the workspace dark while the UI reports all-clear —
the "inverse safety illusion" failure class. Make resume symmetric with halt so
that after Pause→Resume the workspace is genuinely restored and the all-clear is
true.

## The bug (launch-blocking)

`POST /api/governance/emergency-halt` (`apps/api/src/routes/governance.ts`):

- Pauses **every** active deployment in the org via
  `deploymentLifecycleStore.haltAll({ organizationId })` — org-wide, not per-agent.
- (Also contains a campaign-pause loop — see "Verified findings".)

`POST /api/governance/resume` (same file):

- Restores **only Alex** via `deploymentLifecycleStore.resume({ skillSlug: "alex" })`.
- Has **no** campaign re-activation leg.

Effect of the live half: after a global Pause→Resume, **Riley and Mira stay
paused** (dead lead-gen) while the governance profile flips to `guarded` and the
UI shows all-clear. Silent, and exactly the worst bug class for this product.

## Verified findings (code @ origin/main `eed316f9`)

1. **Deployment asymmetry is real and live.** `haltAll` is org-wide
   (`active→paused`); `resume({skillSlug:"alex"})` restores one skill. Confirmed.

2. **The campaign re-activation gap is structurally real but has NO live effect
   today, because halt's campaign-pause is itself inert.**
   - `registerCartridges()` (`apps/api/src/bootstrap/cartridges.ts`) is a no-op
     stub — and is never even called.
   - The cartridge registry is a fresh empty `InMemoryCartridgeRegistry`
     (`packages/db/src/storage/factory.ts`); nothing registers `digital-ads` in
     production (`storage.cartridges.register` is test-only).
   - So in the halt route `storageContext.cartridges.get("digital-ads")` returns
     `undefined` → `isEmergencyHaltCapable` is false → **the campaign-pause loop
     is skipped. Halt pauses zero campaigns.**
   - Corollary: `digital-ads.campaign.pause` is never registered as an intent
     (manifests are built only from the empty registry, `app.ts`), and
     `MetaAdsClient.updateCampaignStatus` has zero production callers.
   - `MetaAdsClient` _is_ wired live — but only for insights/reports and Inngest
     optimization jobs, not for governance halt.

   Therefore there are **no halt-force-paused campaigns** for resume to revive.
   Building a campaign-resume path now would be constructing the inverse of a
   no-op.

## Scope decision (locked with the user)

- **Fix the live deployment bug now** (this PR's implementation).
- **Do not** build a campaign-resume cartridge/intent for a pause that does not
  fire. Capture the coupling rule below so it is not lost.
- **Remove** the per-skill `resume()` store method. After the route switches to
  an org-wide resume, `resume(skillSlug)` is dead — and an asymmetric resume
  method sitting next to the symmetric halt is the exact footgun that produced
  this bug. Net store API becomes `haltAll` / `resumeAll` / `suspendAll`, all
  org-wide.

## The fix (deployment symmetry)

**Store interface** — `packages/core/src/platform/deployment-lifecycle-store.ts`

- Remove `resume`, `ResumeInput`, `ResumeResult`.
- Add `resumeAll(input: ResumeAllInput): Promise<ResumeAllResult>`:
  - `ResumeAllInput { organizationId: string; operator: Actor }`
  - `ResumeAllResult { workTraceId: string; affectedDeploymentIds: string[]; count: number }`

**Prisma impl** — `packages/db/src/stores/prisma-deployment-lifecycle-store.ts`

- `resumeAll` is the exact inverse of `haltAll`: `$transaction` → `findMany`
  `{ organizationId, status: "paused" }` ordered by `id` → `updateMany`
  `paused→active` → `recordOperatorMutation` of an `agent_deployment.resume`
  `WorkTrace` → finalize `completed`. Returns `{ workTraceId,
affectedDeploymentIds, count }`.
- Filtering on `status: "paused"` is precisely correct: `paused` is produced only
  by `haltAll` (there is no per-agent pause surface — the agent panel is
  read-only), and it leaves `suspended` deployments (the separate `suspendAll`
  billing/abuse lifecycle) untouched.

**Route** — `apps/api/src/routes/governance.ts`

- Swap `resume({ organizationId, skillSlug: "alex", operator })` →
  `resumeAll({ organizationId, operator })`.
- The `agent.resumed` audit snapshot's `affectedDeploymentIds` now truthfully
  lists every restored agent.
- Unchanged: readiness gate, profile→`guarded`, prisma/store 503 guards,
  tenant scoping via `resolveOrganizationForMutation`.

### Invariants honored

- Tenant-scoped: `resumeAll` filters by the resolved `organizationId` only.
- Idempotent: re-running with nothing paused → `count: 0`, no error.
- Fail-loud: a DB failure throws → 500; the deployment flip is a single atomic
  `updateMany`, so there is no silent partial deployment resume.
- `WorkTrace` remains canonical persistence; the mutation is an operator
  mutation recorded exactly like `haltAll`.

## Testing (TDD, red first)

- **core** (`deployment-lifecycle-store.test.ts`): interface declares
  `resumeAll` (and no longer `resume`).
- **db** (`prisma-deployment-lifecycle-store.test.ts`): `resumeAll` flips all
  `paused→active` in the org; org-scoped (does not touch another org's paused
  rows); writes a finalized `agent_deployment.resume` WorkTrace; idempotent
  (0 paused → count 0); leaves `suspended` rows untouched.
- **api** (`api-governance.test.ts`): resume calls `resumeAll` (not
  `resume({skillSlug:"alex"})`); **multi-agent** assertion that Alex + Riley +
  Mira are all restored (mock returns all three in `affectedDeploymentIds`);
  cross-tenant scope preserved. Update mocks (`resume`→`resumeAll`).

## Campaign-leg coupling rule (forward-looking — the reason this spec exists)

When the `digital-ads` cartridge is re-wired so that halt **actually** pauses
campaigns, resume MUST gain a symmetric re-activation leg **in the same change**.
Required for that future work:

1. **Persist what halt paused.** Halt currently returns `campaignsPaused` only in
   the HTTP response; add `affectedCampaignIds` to the `agent.emergency-halted`
   audit snapshot (the `/status` reader already reads the latest halt audit row,
   so this is the natural home).
2. **Add a `digital-ads.campaign.resume` intent.** The undo system already names
   it as pause's reverse (`reverseActionType: "digital-ads.campaign.resume"`),
   and `MetaAdsClient.updateCampaignStatus(id, "ACTIVE")` already exists — wire it
   through the cartridge + intent registrar symmetrically to pause.
3. **Re-activate exactly the halt-paused set**, read from the latest halt's
   `affectedCampaignIds` — NOT all currently-paused campaigns. Reactivating
   everything paused would wake campaigns a user deliberately paused
   (over-activation = unauthorized spend), a second safety bug.
4. **Fail-loud, mirroring halt.** Collect per-campaign failures and surface them;
   never report all-clear on a partial re-activation.

This coupling exists so the deployment fix here cannot lull a future change into
re-introducing the asymmetry the day campaigns become live again.

## PR structure

- **PR 1 (this doc):** focused docs PR to `main`.
- **PR 2:** the deployment-symmetry implementation + tests to `main`.

## Out of scope

- Building the campaign-resume capability (deferred per scope decision above; the
  pause it would invert is inert).
- Redesigning the resume readiness gate (Alex-centric `buildReadinessContext`) —
  it gates whether resume proceeds, unrelated to which deployments are restored.
- Re-wiring the `digital-ads` cartridge.
