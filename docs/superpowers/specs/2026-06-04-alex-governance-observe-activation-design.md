# Alex governance observe-mode activation (gate-seam PR2): design

Date: 2026-06-04
Branch: `feat/alex-governance-observe-activation`
Status: approved for implementation (autonomous session; decisions pre-locked by operator prompt)
Predecessors: PR #859 (router-flip de-risk, telemetry substrate), PR #865 (afterSkill seam wired +
eval made governance-aware, merged 2026-06-04 squash `8af445f9`)

## 1. Context and verify-first findings

The 2026-06-02 Alex audit's systemic theme: safety nets are built but unwired, and the green eval
cannot see live seams. #865 closed the wiring half: `SkillExecutorImpl.execute()` now calls
`runAfterSkillHooks` (skill-executor.ts:479, fail-closed, responseSummary refreshed post-gate), the
four governance gates are live-registered (apps/api/src/bootstrap/skill-mode.ts:540-546), and the
alex-conversation harness threads `deps.hooks ?? []` plus a FIRES/BITES enforce-mode test
(`evals/alex-conversation/__tests__/governed-live-path.test.ts`).

Verified against origin/main `055a2100` (2026-06-04):

- **No deployment seeds a `governanceConfig`.** Zero production writers exist (no seed, no route,
  no script). Every gate early-returns on resolver `status:"missing"`. The whole output-claim
  safety layer, including #843's confidence floor, still has zero live effect.
- **Observe mode is not lead-safe for two gates:**
  1. `PdpaConsentGateHook` (pdpa-consent-gate.ts): the revoked-race block (`decision.action ===
"block"`) runs at any mode other than `off`. In observe it would rewrite `result.response`
     to a handoff template, set conversation status `human_override`, and create a Handoff.
     Additionally, the disclosure-miss verdicts (`disclosure_not_shown`,
     `disclosure_version_outdated`) save only under `mode === "enforce"`, so observe is blind to
     exactly the signal the bake needs.
  2. `ClaimClassifierHook` (claim-classifier.ts): `await runClassifier(...)` runs before the
     observe/enforce branch, so observe adds up to `latencyBudgetMs` (default 800ms) of awaited
     per-sentence Haiku classification to every Alex reply.
- **The other two gates are already observe-safe:** `DeterministicSafetyGateHook` observe =
  verdict (allow/warning) with output unchanged; `WhatsAppWindowGateHook` observe = verdicts
  only, no template substitution or blanking (mutations gated on `mode === "enforce"`).
- **`deterministicGate.mode` is shared across layers.** The pre-input gateway scanner
  (`channel-gateway/pre-input-gate.ts`) resolves the same `resolveGovernanceMode(config)` as the
  afterSkill banned-phrase gate. Its observe path is already log-only (verdict `allow`/`warning`,
  submit proceeds; pinned by `channel-gateway-deterministic-gate.test.ts:302`). Seeding observe
  therefore also activates input-layer trigger telemetry (sourceGuard `escalation_trigger`),
  which is desirable: #843's trigger narrowing gets bake data.
- **Telemetry surfaces already exist.** `GovernanceVerdict` (Prisma, indexed by
  deployment+decidedAt and deployment+sourceGuard+decidedAt) is written by all four gates plus
  the pre-input gate; #859's `ExecutionTrace` + `switchboard_skill_llm_*` counters carry
  cost/latency. There is no governance verdict counter and no verdict read route.

### Re-rank confirmation

Scope alternatives considered against the audit and live state: the deferred medical Slice 2
(`ContraindicationGateHook`) needs a new input-scanning hook phase plus precision calibration; the
leverage tier (circuit-breaker/blast-radius wiring) is larger and riskier. Neither unblocks the
already-built gates. This slice is the smallest change that makes everything shipped in
#843/#859/#865 actually run, starts the observe bake that gates the enforce flip, and completes
the audit's freeze-gate arc. It stays the highest-leverage shippable-now slice.

## 2. Goal

Make the four afterSkill governance gates RUN against real traffic in a posture that cannot change
what a lead sees, with telemetry an operator can read, while keeping the enforce flip a deliberate
ops change.

Concretely:

1. Observe mode is strictly log-only for every gate (the PDPA and claim-classifier fixes).
2. The medspa pilot deployment seeds a canonical all-gates-observe `governanceConfig`.
3. The eval proves observe is log-only on the real executor path, from the real seeded posture.
4. A dual-prom counter makes gate verdicts visible for the monitored bake and flip.
5. A runbook documents seeding, bake reads, and the per-gate off-to-enforce flip.

## 3. Non-goals

- No gate flips to enforce. The flip stays ops-controlled, gated on the observe bake.
- No operator dial, settings UI, or verdict read route ("modes not knobs"; Gov-UX
  deprioritization holds: strip operator UX, keep enforcement).
- No input-layer capability work (medical Slice 2 `ContraindicationGateHook` stays deferred).
- No changes under `packages/core/src/governance/classifier/**` (classifier eval prompt-hash and
  locked baseline must not shift; this slice edits only the hook layer).
- No new env flag (posture lives in the DB config, not the environment).
- No `ExecutionTrace.governanceDecisions` population (the `GovernanceVerdict` table is the
  system of record for gate outcomes).

## 4. Locked decisions

- Byte-identical at merge: prod behavior changes only when ops runs the seed (demo/dev re-seed or
  a deliberate prod update), and even then observe is log-only.
- Observe differs from enforce ONLY by never mutating lead-visible state (response text,
  conversation status, handoffs). Telemetry is identical between modes wherever possible.
- Claim-classifier in observe runs fire-and-forget (zero awaited hot-path latency); enforce stays
  awaited. Precedent: #859's `TracePersistenceHook` fire-and-forget telemetry on the same path.
- Jurisdiction `SG`, clinicType `medical` for the pilot (Singapore launch market; injectable
  treatments make `medical` the conservative posture; observe makes stricter scanning free).
- Leverage existing telemetry (GovernanceVerdict + ExecutionTrace + dual-prom registry); the one
  addition is a verdict counter in the existing registries, not a parallel system.

## 5. Design

### 5a. PDPA consent gate: observe hardening (`packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`)

- Gate the revoked-race mutation on enforce. In observe, when `evaluateConsentGate` returns
  `block`: save a verdict `action:"allow"`, `auditLevel:"warning"`, `reasonCode:"consent_revoked"`,
  `details:{ event:"defense_in_depth_revoked_race", wouldBlock:true }`, response untouched, no
  conversation-status write, no handoff. Enforce behavior is byte-identical to today.
  (House convention: safety gate and claim classifier already record observe as allow/warning.)
- Disclosure-miss verdicts (`disclosure_not_shown`, `disclosure_version_outdated`) save in observe
  AND enforce (drop the `mode === "enforce"` qualifier on the two verdict branches). They were
  already allow/warning + never mutating, so this is pure telemetry gain.
- Bookkeeping writes stay mode-independent: `attachToGovernedInteraction` (jurisdiction stamp) and
  `recordDisclosureShown` record true facts about replies that actually go out; they are
  lead-invisible and correct in both modes.

### 5b. Claim classifier: observe goes off the hot path (`packages/core/src/skill-runtime/hooks/claim-classifier.ts`)

- After config resolution + posture remember, branch:
  - `observe`: snapshot `result.response`, then `void this.runObservePipeline(...)` with a
    `.catch` that logs; return immediately. The pipeline runs `splitSentences` -> `runClassifier`
    -> `decideAction` -> the existing observe persistence paths against a DETACHED result object
    (`{ response: snapshot }`), so even a regression in the apply helpers cannot touch the live
    reply. Verdicts persist exactly as today's observe branches (allow/warning, original
    sentences, `modelLatencyMs`).
  - `enforce`: the existing awaited path, unchanged.
- Classifier errors/timeouts inside the fork resolve to the existing fail-closed decide branches,
  which in observe persist verdicts only. A thrown error is caught and logged
  (`console.error`), never unhandled, never propagated to the executor.
- Accepted: a fast-replying session can have multiple observe pipelines in flight (each internally
  bounded by `latencyBudgetMs`); verdicts may be lost if the process dies mid-write (same class
  as the #859 trace hook).

### 5c. Canonical observe posture + seed (`packages/schemas`, `packages/db`)

- `packages/schemas/src/governance-config.ts` exports
  `buildObserveGovernanceConfig({ jurisdiction, clinicType })`: returns the all-gates-observe
  config. Shape (pinned by tests):

  ```json
  {
    "jurisdiction": "SG",
    "clinicType": "medical",
    "deterministicGate": { "mode": "observe" },
    "claimClassifier": { "mode": "observe" },
    "consentState": { "mode": "observe" },
    "whatsappWindow": {
      "enabled": true,
      "mode": "observe",
      "allowMarketingTemplateSubstitution": false
    },
    "lifecycleTagging": {
      "mechanical": { "mode": "off" },
      "qualification": { "mode": "off" }
    }
  }
  ```

  `lifecycleTagging` stays off explicitly (binary on/off blocks; out of this slice's scope but
  spelled out so the seeded posture is self-documenting). `claimClassifier` omits
  `latencyBudgetMs`/`model`/`confidenceThreshold` so resolver defaults stay the single source of
  truth.

- `packages/db/src/seed/medspa-governance-config.ts` exports
  `MEDSPA_PILOT_GOVERNANCE_CONFIG = buildObserveGovernanceConfig({ jurisdiction: "SG",
clinicType: "medical" })`. `prisma/seed-marketplace.ts` adds `governanceConfig:
MEDSPA_PILOT_GOVERNANCE_CONFIG` to BOTH branches of the Alex deployment upsert (org `org_demo`,
  listing `alex-conversion`; the same block provisions dev orgs). Seed-only change; the
  `AgentDeployment.governanceConfig Json?` column exists (migration `20260511014108`), so NO
  migration and no `db:check-drift` exposure.
- Producer-parity test (`packages/db/src/seed/__tests__/medspa-governance-config.test.ts`): the
  literal constant parses via `GovernanceConfigSchema`, and every per-gate resolver
  (`resolveGovernanceMode`, `resolveClaimClassifierConfig`, `resolveConsentStateConfig`, plus the
  `whatsappWindow` block read the way the gate reads it) yields the observe posture. This is the
  "test from real producer defaults" net: a future schema or resolver change that silently
  de-activates or escalates the seeded posture reds this test.

### 5d. Eval: observe-mode live-path proof (`evals/alex-conversation/__tests__/governed-live-path.test.ts`)

Extend the #865 test file with an observe block that drives the REAL `SkillExecutorImpl` with all
FOUR real gates in production order (safety -> claim -> pdpa -> whatsapp), configured with the
canonical posture (`buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" })`)
and stub stores/deps (the established `new Gate(deps as never)` pattern; classifier stubbed to
flag a sentence; consent reader stubbed to a revoked contact; thread store stubbed outside-window):

- The reply that would trip every gate comes back byte-identical.
- Verdicts were recorded for the would-fire gates (captured via stub verdict stores).
- Zero handoffs, zero conversation-status writes.
- Plus a latency guard at the unit layer (5b tests): observe `afterSkill` resolves without
  awaiting a never-resolving classifier.

Bite demonstrations (run during development, recorded in the PR, not committed): re-introduce the
mode-blind PDPA race block -> the observe test reds; make observe await the classifier and hang
the stub -> the latency test reds. Imports stay core/schemas only, so all four eval CI jobs run it
with no `ci.yml` change.

### 5e. Verdict counter for the monitored bake (core interface + both app registries)

- Add `governanceVerdictsRecorded` to `SwitchboardMetrics`
  (`packages/core/src/telemetry/metrics.ts`), counter
  `switchboard_governance_verdicts_total` with labels
  `deployment_id, source_guard, action, audit_level`. Mirror the #859/#838 dual-prom shared
  pattern in `apps/api/src/metrics.ts` and the chat registry, and update the noop/test
  implementations.
- Emission point: the verdict-store `onWrite` seam at the app construction sites (api skill-mode
  bootstrap for the four gates; chat gateway-bridge for the pre-input gate). Compose with any
  existing `onWrite` callback; the increment is non-throwing. Zero gate-file involvement, one
  emission point per process, and the counter rides the verdict write (the system of record), so
  it cannot drift from the table.

### 5f. Runbook (spec section + PR body; no product surface)

- Activate (ops): run `pnpm db:seed` for demo/dev; for prod, a deliberate one-off Prisma update of
  the pilot deployment's `governanceConfig` with the canonical constant. Verify with a select.
- Bake reads: SQL over `GovernanceVerdict` grouped by `sourceGuard, action, reasonCode,
auditLevel`; `switchboard_governance_verdicts_total` in metrics; verdict `modelLatencyMs`
  distribution for the classifier; `switchboard_skill_llm_*` + reply latency must be unmoved by
  observe. Classifier token spend rides key-level Anthropic monitoring (its calls do not flow
  through the executor adapter counters).
- READ CAVEAT (pre-existing gate convention divergence, surfaced by the counter): the WhatsApp
  gate encodes its would-fire signal as the literal action (`block` / `template_required`,
  `auditLevel:"critical"`) EVEN IN OBSERVE, while safety/claim/pdpa/pre-input encode observe as
  `allow` + `warning`. Read WhatsApp verdict rows and counter labels with the deployment's
  posture in mind; nothing was mutated while the posture is observe. Normalizing the WhatsApp
  gate to the `allow`+`warning` observe convention is a candidate follow-up BEFORE its enforce
  flip (deliberately out of this slice, which changes no WhatsApp gate code).
- Flip (post-bake, ops-controlled, per gate, config-only): update the deployment's
  `governanceConfig` sub-block mode to `enforce`. Recommended order: `deterministicGate` ->
  `whatsappWindow` -> `consentState` -> `claimClassifier` (regex first, LLM judgment last).
  Rollback = set the mode back. No code change, no redeploy.

## 6. Blast radius (explicit)

1. Seeding activates the INPUT-layer pre-input scanner in observe via the shared
   `deterministicGate.mode` (log-only, verdicts `escalation_trigger`, submit proceeds; existing
   tests pin this). Deliberate and documented, not conflation: no input-layer code changes here.
2. The WhatsApp gate's fail-closed `unavailable` path (resolver error + no cached posture -> blank
   reply + critical verdict) becomes reachable once seeded. That posture is the deliberate 1c
   precedent, preserved by #865; unchanged here and called out in the runbook.
3. Both `org_demo` and dev-org Alex deployments receive the config (the same upsert provisions
   both); re-running the seed overwrites a hand-edited `governanceConfig` exactly like the
   existing `update` branch overwrites `governanceSettings`/`inputConfig`. Seeds are provisioning.
4. New steady-state DB writes in observe: in-window WhatsApp `allow/info` verdicts per WhatsApp
   reply, per-flagged-sentence classifier verdicts, trigger-match verdicts, consent bookkeeping
   stamps. Pilot scale; covered by existing indexes.
5. Hot path: safety/pdpa/whatsapp gates add small awaited DB reads/writes per turn (existing #865
   design); the classifier adds zero awaited latency in observe (5b). Each gate still resolves
   the deployment row independently per turn (existing design; noted, not changed).
6. Fire-and-forget durability: observe classifier verdicts may be lost on process death; accepted
   for telemetry (same class as the #859 trace hook).

## 7. Testing strategy

TDD per workstream. Unit tests extend the co-located gate tests (PDPA observe-race, disclosure
verdicts in observe, classifier fork latency/error/persistence). Producer-parity test in
`packages/db`. Live-path observe test in `evals` (real executor + real gates + canonical posture).
Bite demonstrations recorded in the PR. Full local gate: `pnpm build && pnpm typecheck && pnpm
test && pnpm format:check && pnpm lint` + `pnpm arch:check` + eval package typechecks; noting
pre-existing flakes (chat gateway-bridge-attribution under full-suite load; db pg_advisory/ledger/
greeting without Postgres). No schema change, so no drift check is required; if local Postgres is
reachable, run `pnpm db:seed` once as a smoke test and select the seeded config back.

## 8. Alternatives considered

- Seed-only (no gate changes): rejected. Observe would not be log-only (PDPA race mutates replies)
  and would add up to ~800ms awaited classifier latency to every reply. The gate fixes are
  prerequisites of the seed, and per the producer-population lesson they ship in the SAME PR.
- Await-the-classifier-in-observe (status quo semantics): rejected for lead-visible latency; the
  bake can read latency from verdict `modelLatencyMs` without paying it on the reply path.
- Full read surface now (verdict API route + dashboard page + flip script): rejected as scope
  creep against the Gov-UX deprioritization; SQL + the counter serve a pilot-scale bake. A read
  surface can become its own slice if the bake outlives raw SQL.
- Observe verdicts recording the would-be action (`block`/`escalate`) instead of `allow`:
  rejected to stay consistent with the existing safety-gate/claim-classifier observe convention;
  the would-fire signal lives in `auditLevel:"warning"` + `reasonCode` + `details.wouldBlock`.

## 9. Acceptance criteria

1. All four afterSkill gates run on the live path once seeded, proven by a live-path governed
   integration test through the real executor (not mocks of the seam).
2. Observe is strictly log-only for all four gates: response byte-identical, no handoffs, no
   status writes, no awaited classifier latency; adversarially demonstrated to red on regression.
3. The seeded posture comes from one canonical constant, schema-parity-tested from the literal
   producer value.
4. Lead-visible behavior is byte-identical at merge (nothing reads a config that does not exist)
   and lead-safe after seeding (observe). Enforce remains a config-only ops flip, documented.
5. Classifier eval baseline + prompt-hash unshifted (no `governance/classifier/**` edits;
   verified at review). Alex baseline unshifted (eval defaults stay `[]` hooks).
6. Verdict counter registered in both app registries and emitted at the verdict-write seam.
7. Full local gate green modulo documented pre-existing flakes; PR to main, squash, NO auto-merge.
