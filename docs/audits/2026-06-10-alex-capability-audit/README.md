# Alex Capability & Architecture Audit

**Date:** 2026-06-10
**Scope:** The "Alex" agent end-to-end — capabilities, governed action path, dashboard cockpit, persistence/memory, code/architecture soundness, and synergy with Riley & Mira.
**North star this audit serves:** Switchboard as a _bespoke AI revenue operator_ with strong synergy across **Alex** (frontline medspa conversion), **Riley** (ad optimizer/feeder), and **Mira** (creative/UGC).
**Method:** 1 surface-mapping pass → 6 parallel domain auditors → 2 adversarial verification passes → coordinator line-level confirmation of the headline. Read-only against a clean `origin/main` checkout (`84083f0c`) with `pnpm build` green. Every finding cites `file:line`.

---

## 1. Verdict

> **The architecture is sound. The activation is not.**

Switchboard has genuinely built the governed substrate a revenue operator needs — and built it well. Typecheck, lint, and `arch:check` are clean; ~5,990 tests pass; dependency layering is pristine; there are **no route-level bypasses of `PlatformIngress`** (`check-routes`: 0 active findings); store hygiene is exemplary; all six of Alex's tools are bound to **real executors** (the "stubs only" hypothesis was _refuted_); and the booking→Riley revenue-attribution loop is genuinely closed in code.

But for a **real, non-demo tenant**, the operator does not yet exist as a working loop:

1. **[P0] Alex cannot complete a booking — and tells the customer it's done anyway.** The single most important revenue action silently fails on every default org, while Alex reassures the lead it's "queued."
2. **[P1] Alex/Riley/Mira synergy is dev-seed-only.** A real org gets **Alex alone**; Riley and Mira are never provisioned, so every cross-agent edge is inert in production.
3. **[P1] The cross-agent learning channel is unbuilt.** The `revenue_proven` memory category that would let proven winners flow between agents has **zero writers**, and memory is siloed per-deployment.
4. **[P1] One real architectural gap:** in-skill tool approval **cannot park into a lifecycle** — it evaporates. This must close before Alex/Riley/Mira can share a graduated-trust model.

The recurring shape — substrate built, last mile not switched on — matches Switchboard's own documented pattern ("safety gate needs producer population", "autonomy fields stored ≠ enforced", "switch on, prove the loop"). The good news: because the foundation is real, the highest-impact fixes are **activation and wiring**, not rearchitecting.

**Soundness scorecard**

| Dimension                                              | Verdict                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Code health (typecheck / lint / arch / tests)          | ✅ Sound — all green, ~5,990 tests, layering clean                                  |
| Governed action path (ingress / WorkTrace / no bypass) | ✅ Sound — canonical, atomic, idempotent                                            |
| Capability wiring (tools → real executors)             | ✅ Sound — 6/6 real, trust-bound inputs                                             |
| **Booking executability (real org)**                   | ❌ **P0 — blocked + customer misled**                                               |
| In-skill approval lifecycle                            | ⚠️ P1 — dead-end, cannot park/resume                                                |
| Alex↔Riley↔Mira synergy                                | ⚠️ P1 — built but unprovisioned + learning loop unbuilt                             |
| Cockpit fidelity                                       | ⚠️ P1 — honest where wired, but orphaned chains + stale status + a browser-flag bug |
| Persistence / consent / memory                         | ✅ Mostly sound — 1 tenant-isolation gap, 1 dead consent field                      |

---

## 2. What is sound (verified)

This is substantial and load-bearing — it is _why_ the fixes are activation, not rebuild.

**Governed action path**

- No mutating route bypasses ingress — `check-routes` → 0 active findings (102 intentionally allowlisted). Managed inbound submits `${slug}.respond` through `PlatformIngress.submit` (`packages/core/src/channel-gateway/channel-gateway.ts:318,349`); `/execute`, `/ingress/submit` likewise.
- Booking side-effects are atomic and linked to the canonical trace: booking + outbox + receipt + stage-advance in one `$transaction` (`packages/core/src/skill-runtime/tools/calendar-book.ts:357-422`), row carries `workTraceId: ctx.workUnitId` (`:281`). One turn = one WorkTrace.
- `"approvalRequired" in response` is tested **before** destructuring everywhere it's consumed (`execute.ts:130`, `actions.ts:98,308`, `creative-pipeline.ts:99,210`, `delegation-submitter.ts:22`, …).
- `"queued"` outcome is not collapsed into failure (`platform-lifecycle.ts:408` `succeeded = completed||queued`; distinct `action.queued` ledger event).
- Cron/system submits use the **seeded** `{id:"system",type:"system"}` principal (`bootstrap/system-identity.ts` + `prisma/seed.ts:51`); no bespoke `system:<x>` actor that would hard-deny.
- Approve path = **dispatch-or-recovery**, payload-authoritative (`approval/lifecycle-dispatch.ts:61-77,107,118`); resolve routes forward to core, never mutate in-handler (`approvals.ts:94,246`).
- `updateMany`/`deleteMany` no-match aborts preserved as `StaleVersionError` (`prisma-booking-store.ts:73,98,151`; `prisma-opportunity-store.ts:131,160,280`).
- NaN-blind gates guarded with `Number.isFinite` (`spend-limits.ts:21`, `spend-approval-threshold.ts:55,57`).
- Idempotency fingerprint is **reused** check-leg → store-leg, not recomputed (`platform-ingress.ts:120`, `work-trace-recorder.ts:97,155`); a `running` claim fails closed on replay.

**Capabilities**

- All six tools have **real, side-effecting executors** (not eval stubs): `crm-query`, `crm-write`, `calendar-book`, `escalate`, `delegate`, `follow-up` — each materializes per-request with a trusted `SkillRequestContext` (orgId/contactId/sessionId injected, never from the LLM). See the inventory in §4.
- Alex→Mira delegation is correctly governed: `delegate` is `effectCategory:"propose"`, routes through `ChildWorkSubmitter` → ingress, child re-runs full governance (`tools/delegate.ts:49,75`).
- The learning-loop code is **real core code**, not eval-only: write-side `ConversationCompoundingService` (`memory/compounding-service.ts:208-253`), read-side `ContextBuilder` (`memory/context-builder.ts:125-231`), prompt-injection-escaped (`outcome-pattern-extractor.ts:80-114`), all co-located-tested.

**Persistence & consent**

- Consent **is** enforced (bright-line intact) — at intake via `Contact.messagingOptIn/consentRevokedAt`: STOP → `recordMessagingOptOut` + PDPA revocation, `runConsentRevocationGate` on every inbound returns before generating a reply (`channel-gateway.ts:240-287`, `pdpa-consent.ts:96-104`, `proactive-eligibility.ts:47-66`).
- Contact store hygiene is exemplary: every mutation org-scoped + `count===0` throw; delete cascade in an interactive `$transaction` (`prisma-contact-store.ts:141,157,168-241`).
- DeploymentMemory: check-leg fingerprint reused, org-scoped, no-match guarded, surfacing threshold (`minSourceCount:3/minConfidence:0.66`) + decay + cap-evict (500) with race handling (`compounding-service.ts:354-384`, `prisma-deployment-memory-store.ts`).
- Claim safety is independent of the doc: `claim-classifier.ts` re-classifies every reply sentence and fail-closes to handoff in enforce mode.

**Code health**

- `pnpm typecheck` 21/21 ✅ · `lint` 0 errors ✅ · `arch:check` no error-level issues ✅ · core tests 4016 ✅ · api tests 1721 ✅ · eval **deterministic** tier 254 ✅ (blocking on Alex PRs).
- Dependency layering clean (anchored-import grep): no `core→db/creative-pipeline/ad-optimizer`, no `db→cartridge-sdk`, no UI imports in backend.

**Cockpit (where wired)**

- The live Home modules + AgentPanel are honestly wired to org-scoped stores; the `enabled:false` React-Query pitfall is handled correctly (gate on `{data,error}` not `isLoading`); no fabricated data; **no per-agent autonomy/pause illusion** (global halt only, per the canonical decision).
- The booking→Riley revenue loop is real: booked `value` + `sourceCampaignId` → `ConversionRecord` → `bookedValueByCampaign` → Riley `trueRoas` → `source-reallocation` recommends shifting budget (`calendar-book.ts:365-378`, `analyzers/source-reallocation.ts:51-60`).

---

## 3. Findings by severity

Severities reflect customer/revenue impact on a **real tenant**, after adversarial verification.

### P0 — Pilot-blocking / integrity

#### F1 — Default real-org Alex cannot complete a booking, and falsely tells the lead it's queued

- **Evidence (chain, all confirmed line-level):**
  - Real orgs get Alex via `apps/api/src/lib/ensure-alex-listing.ts:43-57`, which writes **no `governanceSettings`** (not `onboard.ts`).
  - With no `trustLevelOverride`, the gate floor is `DEFAULT_CARTRIDGE_CONSTRAINTS.trustLevel = "guided"` (`platform/governance/governance-gate.ts:93-95` + `default-constraints.ts:12`). The comment is explicit: _"Absent ⇒ unchanged DEFAULT_CARTRIDGE_CONSTRAINTS … without consulting the score-based ramp."_ (The score-based `supervised` is computed but dropped — this resolves the supervised-vs-guided contradiction between the first-pass agents.)
  - `calendar-book.booking.create` is `effectCategory:"external_mutation"` (`tools/calendar-book.ts:216`). At `guided`, `external_mutation → require-approval` (`skill-runtime/governance.ts:29-33`).
  - On a `require-approval` decision the in-skill hook short-circuits: `skill-executor.ts:541-559` sets `result = pendingApproval(...)`; `op.execute()` (`:585`, mutually-exclusive `else if`) is **never reached** → **the booking row is never created.** No `ApprovalLifecycle`, no WorkTrace park, no operator notify, no resume (grep `lifecycleService|createGatedLifecycle|ApprovalLifecycle` under `skill-runtime/` → empty).
  - `skills/alex/SKILL.md:239-241` instructs Alex, on `pending_approval`, to tell the lead _"I've put your booking request in … the team will confirm it shortly … the approval is already queued."_
- **Observed:** A real-org lead completes the conversation, Alex says the booking is queued, **no booking exists and no human will ever see it.** (`crm-write` and `follow-up` are `write` → auto-approve at `guided`, so they _do_ work — the failure is specific to booking/reschedule/cancel.) The seeded demo masks this with `trustLevelOverride:"autonomous"` (`seed-marketplace.ts:740`).
- **Impact:** The core north-star action silently fails on every default tenant, and the customer is actively misled — a trust/integrity breach, not just a dropped action.
- **Fix (a product decision — see §6 options):** at minimum, (d) correct the SKILL.md text so Alex never promises a queue that doesn't exist; structurally, (a) make in-skill approval park into the existing `ApprovalLifecycle`+`lifecycle-dispatch` substrate (correct, ties to F2), or (b) provision booking-capable trust per-org, or (c) reclassify booking's effect category.
- **Test:** integration — onboard a fresh org, drive an Alex booking; assert either a `Booking` row is created (autonomous/auto) or a real parked lifecycle exists (park+resume) — never a `completed` turn with no booking.

### P1 — Significant gaps

#### F2 — In-skill per-tool approval is architecturally a dead-end (the general mechanism behind F1)

- **Evidence:** `skill-executor.ts:550-559` (synthesize `pendingApproval`, reinject at `:613-630`), `hooks/governance-hook.ts:38-44`, `platform/modes/skill-mode.ts:108` (`trace.status==="success" ? "completed" : "failed"` — a parked tool still yields success). The only resume substrate (`approval/respond-to-parked-lifecycle.ts`) is keyed off an `ApprovalLifecycle` the in-skill path never creates; it re-runs the **whole turn**, not a specific tool.
- **Observed:** Any in-skill tool needing approval evaporates. At `supervised`, this also silently kills `escalate`/`crm-write`/`follow-up` (all `write`). This is the documented "two constraint regimes never reconcile / mid-loop approval unrepresentable" gotcha, made concrete.
- **Impact:** Mid-conversation human-in-the-loop for a single risky Alex action is impossible; blocks safe graduated autonomy shared across Alex/Riley/Mira.
- **Fix:** When `beforeToolCall` returns `pending_approval`, create a gated lifecycle bound to the frozen tool-call payload, return a distinct `parked` status, and map it in `skill-mode.ts` to `outcome:"pending_approval"`+`approvalRequired:true` so the existing dispatch engine drives resume.

#### F3 — Synergy is dev-seed-only: a real org gets Alex alone

- **Evidence:** signup/first-access seeds only the Alex listing+deployment (`routes/organizations.ts:83` → `ensureAlexListingForOrg`), day-one `OrgAgentEnablement` flags (`:88` → `seedOrgDayOneAgents`, day-one only), and the Alex skill pack (`:90`). Riley/Mira **AgentDeployments** and the **recommendation-handoff governance** are seeded only for `org_dev` (`prisma/seed.ts:611,620`). No per-org provisioning/pilot-flip job creates them; crons/submitters only _read_ existing deployments (`bootstrap/inngest.ts:1225,359`).
- **Observed:** In production every cross-agent edge (Alex→Mira, Riley→Mira) is **inert** — the code is live but the deployments and governance policies don't exist for the tenant. Edge matrix: 2 of 9 directed agent edges implemented, both unprovisioned for real orgs; Alex→Riley is **absent by construction** (no Riley target in `bootstrap/delegation-targets.ts:54`, only the creative target).
- **Impact:** The "synergy across Alex/Riley/Mira" north star does not exist for a paying tenant.
- **Fix:** an entitlement-gated per-org provisioning step that seeds Riley/Mira deployments + handoff governance (reuse `seedRileyAdOptimizerDeployment`/`seedMiraCreativeDeployment`).

#### F4 — Cross-agent learning channel unbuilt; memory is three silos

- **Evidence:** `DeploymentMemory.revenue_proven` (the designed Riley→Mira/Alex channel) has **zero writers** in non-test source — only a _read_ in `builders/mira.ts:76,91-99`; `compounding-service.ts:444,511` writes only `faq`/`pattern`. Memory is scoped per `(organizationId, deploymentId)` (`prisma-deployment-memory-store.ts:20-78`) and each agent is a distinct deployment, so even the wired Mira read could never see a Riley write.
- **Impact:** No genuine cross-agent learning; "Riley's proven winners influence Alex/Mira" is impossible today.
- **Fix:** build the Riley `revenue_proven` writer **and** an org-level shared read tier (`organizationId` is already a separate column — no migration needed for an `org`-scoped read of the cross-agent categories).

#### F5 — Booking→learning loop half-open: Alex conversions write no structured outcome

- **Evidence:** `skill-runtime/outcome-linker.ts:14-45` maps only `crm-write/stage.update → "stage_<x>"` (ad-hoc string, not the `InteractionOutcome` enum) and opt-out; no branch links a successful **booking** to a `Booking`/`InteractionOutcome`/`RecommendationOutcome(agentRole:"alex")` row. (`agentRole:"alex"` is reserved but unused — `schema.prisma:644-655`.)
- **Impact:** Booking _value_ reaches Riley via `ConversionRecord` (the strong, working part), but the per-action outcome ledger the cockpit and Riley attribution would join on isn't written. The "Alex converted this lead → here's the trace + revenue" join is missing.
- **Fix:** extend the linker to emit a booking-typed outcome on `booking.create` success.

#### F6 — Multi-market references are dead at runtime

- **Evidence:** `skills/alex/references/markets/{sg,my}-medspa.md` and `regulatory/{sg,my}-rules.md` are loaded into `SkillDefinition.references` but have **no Alex consumer** (grep: only creative-pipeline reads `.references`); only `references/medspa/` is seeded (`seed-alex-skill-pack.ts:77`); no per-org jurisdiction selector exists. The `sg/my` rule files self-describe as Phase-1a placeholders.
- **Impact:** The SG/MY market positioning has **no prompt-layer substance** — voice/market differentiation is illusory (claim _safety_ still holds via the jurisdiction-agnostic classifier).
- **Fix:** a market-keyed scope in `ALEX_SKILL_PACK_SCOPES` chosen by org market/timezone (author the bodies), or delete the dead files to stop implying capability.

#### F7 — `messaging-rules` (POLICY_CONTEXT) ships empty in production

- **Evidence:** declared (`SKILL.md:74-77`, rendered `:377`) but seeded only in demo (`fixtures/demo-knowledge.ts:193`); not in `ALEX_SKILL_PACK_SCOPES` nor `assertAlexSkillPackSeeded`.
- **Impact:** Alex's "Messaging Policy" section renders blank for real orgs — cadence/opt-out/disclaimer rules silently absent.
- **Fix:** seed a canonical `messaging-rules` scope, or drop the slot.

#### F8 — Handoff store has no tenant isolation

- **Evidence:** `packages/core/src/handoff/types.ts:22-28` — `getById(id)`/`getBySessionId(sessionId)`/`updateStatus(id,…)` take no `organizationId`; impl `handoff-store.ts:46-67` self-flags _"store-mutation-deferred — unscoped … tracked for Round-3 #643"_. `Handoff` embeds `leadSnapshot` PII and has `@@index([sessionId])`.
- **Impact:** Cross-tenant read of lead PII / status mutation if an id or sessionId leaks.
- **Fix:** add `organizationId` to the three signatures; `findFirst({where:{id,organizationId}})` and `updateMany` + `count===0` throw (mirror the Contact/DeploymentMemory pattern).

#### F9 — `NEXT_PUBLIC` dynamic-bracket read silently disables the operator's path to Alex's output (F-20 class)

- **Evidence:** `apps/dashboard/src/lib/.../route-availability.ts:37` `process.env[TOOLS_LIVE_ENV[id]] === "true"` — dynamic bracket on `process.env`, consumed by `"use client"` components (`app-sidebar.tsx:98`, `results-page.tsx:35`, …). Next.js only inlines _static_ `process.env.NEXT_PUBLIC_X`, so this is permanently `undefined`→`false` in the browser; the `vi.stubEnv` test masks it.
- **Impact:** Setting `NEXT_PUBLIC_REPORTS_LIVE=true` in Vercel does **not** light up Results/Activity/Contacts — the operator's window into Alex's output stays in fixture mode. ("flag on in env but UI ignores it.")
- **Fix:** static `switch (id)` over literal `process.env.NEXT_PUBLIC_*` accesses; add a lint rule banning `process.env[` for `NEXT_PUBLIC` keys.

#### F10 — Cockpit chains orphaned; Alex's pipeline & wins never render

- **Evidence:** `use-agent-pipeline.ts` has **zero importers**; `listWins` exists with **no hook** and its link is gated off (`route-availability.ts:51`); retired primitives `cockpit/identity.tsx`, `status-pill.tsx`, and `alex-config.ts` status helpers + `DEFAULT_ALEX_VARIANT` are dead (grep: no live consumers; keep `ALEX_APPROVAL_ACCENT` — it _is_ used).
- **Impact:** Alex's stated mission is "Consultations pipeline" (`alex-config.ts:15`) yet the cockpit shows no pipeline; "what Alex achieved" (Wins) is computed end-to-end but dark. Build type-checks the dead code.
- **Fix:** decide surface-vs-retire per chain; if surfacing, add a Pipeline/Wins panel to the AgentPanel (backends already live + tested).

#### F11 — Live `activityStatus` has no time-decay → stale "Working" (fidelity violation)

- **Evidence:** `agent-state-deriver.ts:95` sets status purely from the latest matching audit event with no recency cutoff; `action.proposed → "working"`.
- **Impact:** The cockpit can show Alex "Working" indefinitely when idle — the exact illusion the north star forbids; the stale value also flows into the home "N of M working" proof line.
- **Fix:** decay non-terminal statuses (`working`/`analyzing`) to `idle` past a freshness window using the already-present `lastActionAt`.

### P2 — Refinements / latent

| ID  | Finding                                                                                                                                                                                                                                                                                                      | Evidence                                                                                               | Fix                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| F12 | Customer-facing **"Awaiting approval" leak** on an outer-gate park (no `pending_approval` branch in the dispatcher). _Latent_ — not reachable under default seed today; fires once an operator seeds a `require_approval` policy for `alex.respond` (the F-16 pilot work) or runs autonomous+spend-autonomy. | `channel-gateway.ts:65-131`; park shape `platform-ingress.ts:289-298,363-373`                          | Add a holding-message/suppression branch for `approvalRequired`/`pending_approval`.                                      |
| F13 | `trackPattern` cross-key identical-content **P2002 silently swallowed** → booking-attributed learning signal dropped (unique on `content`, dedup on `canonicalKey`).                                                                                                                                         | `compounding-service.ts:487-518` (no P2002 catch; swallowed at `:306-307`); unique `schema.prisma:783` | On collision, record evidence against the existing row (reuse check-leg id) instead of `create`.                         |
| F14 | `ContactLifecycle.optedOut` is a **dead consent field** — no production caller; interface self-marked `@deprecated`. A future "block opted-out" change reading it would compile, pass tests, enforce nothing.                                                                                                | `schema.prisma:1000`; `prisma-conversation-store.ts:70-81` (no callers)                                | Remove it (migration) or wire `recordMessagingOptOut` to flip it; canonical consent is on `Contact.*`.                   |
| F15 | `BUSINESS_FACTS required:true` and `claim-boundaries required:false` are **decorative contract flags** — runtime degrades to empty rather than enforcing/loud-failing.                                                                                                                                       | `builders/alex.ts:98-105`; `modes/skill-mode.ts:160,165`; `SKILL.md:78-89`                             | Gate live dispatch on skill-pack presence; emit a metric when a policy-critical slot resolves empty for an entitled org. |
| F16 | **No deterministic E2E for the Alex booking arc** — `crm-query→crm-write→calendar-book→outcome` runs only in the non-blocking live eval.                                                                                                                                                                     | `skill-executor.test.ts` (synthetic tools only); `ci.yml:472` (`continue-on-error`)                    | Key-free scripted-adapter executor test through the 3-tool sequence asserting order + terminal trace.                    |
| F17 | `skill-executor.ts` (685) & `platform-ingress.ts` (676) **over the 600-line hard limit**, grandfathered via `eslint-disable`; `execute()` complexity 37 — and that function is exactly where F1/F2 live.                                                                                                     | arch:check log; lint `skill-executor.ts:274`                                                           | Extract the tool-call loop body (the pending-approval branch); carving it out naturally enables the F2 fix.              |
| F18 | `delegate` silently absent if `childWorkSubmitter` not supplied (latent capability-illusion; prod is wired).                                                                                                                                                                                                 | `bootstrap/skill-mode.ts:300-306`; supplied `app.ts:482,495`                                           | Startup assertion / warn when omitted.                                                                                   |

---

## 4. Capability inventory (what Alex can actually do)

| Tool                                      | Declared | Registered    | Executor                    | At `guided` (default real org)           | Evidence                                           |
| ----------------------------------------- | -------- | ------------- | --------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `crm-query` (contact.get / activity.list) | ✅       | ✅            | **real** read               | ✅ auto-executes                         | `tools/crm-query.ts:25,49`                         |
| `crm-write` (stage.update / activity.log) | ✅       | ✅            | **real** write              | ✅ auto-executes                         | `tools/crm-write.ts:40,75`                         |
| `calendar-book.slots.query`               | ✅       | ✅            | **real** read               | ✅ auto-executes                         | `tools/calendar-book.ts:178`                       |
| **`calendar-book.booking.create`**        | ✅       | ✅            | **real** (atomic tx)        | ❌ **require-approval → dead-ends (F1)** | `tools/calendar-book.ts:216`                       |
| `calendar-book.booking.reschedule/cancel` | ✅       | ✅            | **real**                    | ❌ require-approval → dead-ends          | `tools/calendar-reschedule.ts:57,153`              |
| `escalate.handoff.create`                 | ✅       | ✅            | **real** (notifies)         | ✅ auto-executes (write)                 | `tools/escalate.ts:29`                             |
| `delegate.<creative>`                     | ✅       | conditional\* | **real** (→ governed child) | ✅ auto-executes (propose)               | `tools/delegate.ts:49`; `delegation-targets.ts:54` |
| `follow-up.followup.schedule`             | ✅       | ✅            | **real**                    | ✅ auto-executes (write)                 | `tools/schedule-follow-up.ts:49`                   |

\* `delegate` requires `childWorkSubmitter` (supplied in prod). Only target is Mira creative-concept; **no Riley target exists**.

**Governance table (in-skill `GOVERNANCE_POLICY`, `governance.ts:19-35`)** — TrustLevels: `supervised | guided | autonomous`:

| effectCategory                | supervised       | **guided (default)** | autonomous       |
| ----------------------------- | ---------------- | -------------------- | ---------------- |
| read / propose / simulate     | auto             | **auto**             | auto             |
| write                         | require-approval | **auto**             | auto             |
| external_send                 | require-approval | **require-approval** | auto             |
| external_mutation (= booking) | require-approval | **require-approval** | auto             |
| irreversible                  | deny             | require-approval     | require-approval |

**Knowledge:** 3 medspa context slots (`objection-handling`, `qualification-framework`, `claim-boundaries`) are genuinely seeded + readiness-asserted (`seed-alex-skill-pack.ts:31-185`, `readiness.ts:248`). The learning loop (`OUTCOME_PATTERNS`) is real core code, pilot-gated.

---

## 5. North-star synergy: the revenue loop today

**Target loop:** Riley reallocates spend → leads → **Alex** converts/books → booking outcomes feed attribution & learning → **Mira** refreshes creative on winners → Riley reallocates.

```
                 [✅ closed in code]                 [❌ F3: unprovisioned in prod]
  Riley ───booked value / trueRoas──▶ source-reallocation        Alex ──delegate──▶ Mira
   ▲          (ConversionRecord)                                   │  (live, but Mira not seeded)
   │                                                               ▼
   └────────── [❌ F4: revenue_proven has zero writers] ◀──── booking outcome
                [❌ F5: no structured Alex booking outcome row]
   Alex ──X──▶ Riley   [absent by construction — no Riley delegation target]
```

| Edge                                  | State             | Why                                                             |
| ------------------------------------- | ----------------- | --------------------------------------------------------------- |
| Alex → Mira (creative concept)        | **INERT in prod** | live code; Mira is day-thirty, not seeded at signup (F3)        |
| Riley → Mira (recommendation handoff) | **INERT in prod** | live code + parked-approval loop; dev-seed-only governance (F3) |
| Alex → Riley                          | **ABSENT**        | no Riley delegation target by construction                      |
| Riley → Alex / Mira → \*              | **ABSENT**        | `revenue_proven` unbuilt (F4); no Mira outbound tool            |
| Alex/Riley/Mira → human               | **LIVE**          | escalate / require_approval / review-board                      |
| Booking value → Riley attribution     | **LIVE** ✅       | the one genuinely closed economic edge                          |

**The loop's strong half is built (booking value → Riley reallocation).** What's missing to close it: provision Riley/Mira per-org (F3), write `revenue_proven` + share memory at org scope (F4), write a structured Alex booking outcome (F5), and feed Alex's conversion signals (objections/treatments booked) into Mira's brief.

---

## 6. Recommended sequencing

Ordered by _unblock-the-loop_ leverage. Each is grounded in code that already exists.

**Wave 0 — Make Alex actually work + stop misleading customers (P0/P1, do first)**

1. **Fix the booking dead-end (F1/F2).** Decide the model (see options below) and implement. _This is the gate on everything — Alex's core action._
2. **Correct the SKILL.md false-promise text (F1d).** Trivial, do regardless of #1. _S_
3. **Add the dispatcher `pending_approval` branch (F12).** Closes the customer leak before any approval policy is seeded. _S_

**Wave 1 — Provision & close the loop (P1, the north star)** 4. **Per-org provisioning of Riley + Mira + handoff governance (F3).** Without this, no synergy exists in prod. _S–M_ 5. **Build the `revenue_proven` writer + org-scoped shared memory read (F4).** _M_ 6. **Write structured Alex booking outcomes (F5)** + feed booked-treatment/objection signals into Mira's brief. _S–M_

**Wave 2 — Fidelity, safety, polish (P1/P2)** 7. Tenant-isolate the Handoff store (F8, security). _S_ 8. Fix the `NEXT_PUBLIC` browser-flag bug (F9) so operators can see Alex's output. _S_ 9. Surface (or retire) the Pipeline & Wins cockpit chains (F10); add time-decay to status (F11). _M_ 10. Jurisdiction-aware references (F6) — the SG/MY substance; seed `messaging-rules` (F7); remove dead `optedOut` (F14). _M_ 11. Deterministic booking-arc test (F16); split the 685-line executor while fixing F2 (F17). _S–M_

### Decision required for F1/F2

| Option                                         | What                                                                                                                 | Trade-off                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A. Park + resume (recommended)**             | Make in-skill approval create a real `ApprovalLifecycle` bound to the frozen tool call; resume on operator approval. | Correct, doctrine-aligned, enables graduated autonomy for all three agents. Effort **L**.       |
| **B. Provision booking-capable trust per-org** | At provisioning, set `trustLevelOverride` so booking auto-executes (as demo does).                                   | Fast (**S**), unblocks pilots immediately — but removes the approval gate on bookings entirely. |
| **C. Reclassify `booking.create`**             | Change effect category so it auto-approves at `guided`.                                                              | **S**, but loses the "external mutation needs review" semantics.                                |
| **D. Text-only (interim)**                     | Just fix SKILL.md so Alex doesn't claim a queue.                                                                     | Stops the lie; booking still doesn't happen. Pair with A or B.                                  |

A is the architecturally right answer and the prerequisite for safe Alex/Riley/Mira autonomy; B unblocks a pilot this week. A common path is **B (or B-then-A) + D now**.

---

## 7. Confidence & method

- **High confidence** on all P0/P1 findings — each traced `file:line` through the live wiring; the headline (F1) was confirmed by two independent verification passes _and_ coordinator line-level read of all six pivotal sites.
- **Not executed at runtime:** no live conversation / DB (read-only audit). F1's "booking never persists" is airtight by static control flow (the hook short-circuits _before_ `execute()`), but a one-shot integration repro would make it indisputable and is the recommended first test.
- **First-pass corrections caught by verification:** the resolved default trust is `guided` (not `supervised`); real orgs use `ensure-alex-listing.ts` (not `onboard.ts`); "every mutating tool blocked" is too broad — only `external_mutation` (booking) blocks at `guided`. These corrections are folded into the findings above.
- **Out of scope:** Riley/Mira internal quality, live LLM output quality, the chat app's INTERNAL_API_SECRET hop, non-Alex cockpit fidelity.

_Auditors: 1 surface mapper (Explore) + 6 domain agents (capability, governance, synergy, cockpit, persistence, code-quality) + 2 adversarial verifiers. Worktree `worktree-alex-capability-audit` @ `84083f0c`._
