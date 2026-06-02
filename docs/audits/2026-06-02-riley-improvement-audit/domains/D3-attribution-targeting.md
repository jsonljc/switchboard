# D3 — Economic Targeting & Attribution Closure (the "Target" + flywheel Attribute leg)

> Raw domain audit. `file:line` against `main`. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE (verified)

**The end-to-end path EXISTS but breaks in three places: aggregate-only at the provider, never reaches the decision engine, and the booked event carries no attribution.**

**(a) Spend → lead → booked → revenue, traced:**

- **Spend (per-campaign):** `MetaCampaignInsightsProvider` (now wired on `main` via #792) yields per-campaign `insight.spend`/`conversions`.
- **Lead ingest + attribution:** `meta-leads-ingester.ts:72-85` fetches `campaign_id`; `meta-lead-record-inquiry-workflow.ts:16-26` writes an outbox `inquiry` event **with `sourceCampaignId`** ✅.
- **Booked producer (EXISTS):** `calendar-book.ts:277-298` writes `outboxEvent{type:"booked"}` in the booking-confirm transaction. **But the booked payload has `value:0` and NO `sourceCampaignId`/`fbclid`/`lead_id`** (`:286,289-295`).
- **Publish chain (COMPLETE):** `OutboxPublisher.publishBatch` (`outbox-publisher.ts:28-53`) → `bus.emit` → `conversion-bus-bootstrap.ts:43-87`: (i) `ConversionRecordStore.record` always; (ii) `MetaCAPIDispatcher.dispatch` **only if `META_PIXEL_ID && META_CAPI_ACCESS_TOKEN`** (`:54-57`).
- **CRM → funnel rollup (per-campaign, then COLLAPSED):** `PrismaCrmFunnelStore.queryFunnelCounts` **already groups by `(sourceType, sourceCampaignId, stage)`** incl. `booked` + `revenue` (`crm-funnel-store.ts:42,142-176`). **`RealCrmDataProvider.getFunnelData` then throws `sourceCampaignId` away** — it buckets only into hardcoded `ctwa`/`instant_form` (`real-provider.ts:116-133`) and returns ONE aggregate + a 2-key `bySource`.

**(b) Per-campaign attribution fork — RESOLVED:** `getFunnelData` returns ONE aggregate (`real-provider.ts:141-170`) plus `bySource` keyed by **source type, not campaign**. `sourceComparison` (`source-comparator.ts:12-19`) is **per-source** (CTWA vs Instant Form) — computes `costPerBooked`/`trueRoas`/`closeRate` ✅ but only as output decoration (`audit-runner.ts:511-516,572`); never read by breach/kill/scale. **Cheapest correct per-campaign path: the data already exists one layer down.** Adding a `byCampaign` projection at `real-provider.ts:121-133` is **zero new queries** (same rows, second group-by key). Beats N `getFunnelData` calls AND account-level calibration. Account-level calibration (`effectiveTargetCPA = targetCostPerBooked × accountLeadToBooked`) is the right **Tier-2 fallback** when a campaign has sparse bookings, using `getBenchmarks().qualifiedToBooked` (`real-provider.ts:189-201`).

**(c) CAPI — flag-off by env, with a redundant dead path:** Active path = `MetaCAPIDispatcher`, gated on `META_PIXEL_ID && META_CAPI_ACCESS_TOKEN` (`conversion-bus-bootstrap.ts:54-57`); both unset by default → never fires. Otherwise fully implemented (PII SHA-256 `:92-97`, 7-day freshness `:44`, `fbc` synthesis `:147`). **Dead code:** `conversion-bus-wiring.ts:wireCAPIDispatcher` + `meta-capi-client.ts:MetaCAPIClient` have zero non-test callers (a second, weaker CAPI impl). `outcome-wiring.ts`/`OutcomeDispatcher` intentionally dormant.

**(d) Reconciliation — real runner exists; production wiring is a hardcoded lie:** `ReconciliationRunner` (`core/attribution/reconciliation-runner.ts:31-82`) is real (booking-linkage + crm-sync, drift bands 1%/5%). `inngest.ts:394-404` **does not instantiate it** — `runReconciliation` returns `{overallStatus:"healthy", checks:[]}` unconditionally. The daily cron counts every org "healthy."

**(e) `booked` producer — YES but attribution-blind:** `calendar-book.ts:280` emits it; `countByType("booked")` reads `conversionRecord` (`prisma-conversion-record-store.ts:145-152`), so the record IS written. But `value:0` + no `sourceCampaignId` → useless for revenue ROAS / per-campaign CAC, and `MetaCAPIDispatcher.canDispatch` (`:33-41`) likely rejects it unless contact email/phone are attached.

**(f) `metrics-riley.ts` — CONFIRMED:** `qualifiedPct = 0` hardcoded (`:57`); `targetCpbCents` "reinterpreted as **target cost per lead**" (`:100-109`); ROI label "cost per lead" (`:129,138,145`); CTR forced unavailable (`:72-73`). Booked economics never imported here.

**Roadmap status:** PR1 Eyes DONE. **PR2 "Target" NOT STARTED** — `metrics-riley.ts` unchanged; reconciliation stub unchanged; economic diff empty.

## 2. GAPS / WEAKNESSES vs NORTH STAR

1. **Decision engine optimizes cost-per-LEAD, not cost-per-booked** (`audit-runner.ts:145-146,366`; `cpa = spend/conversions`). Cheap junk leads score as a win — the exact failure the north star forbids.
2. **Per-campaign booked-CAC is computed at the store and discarded at the provider** (`real-provider.ts:121-133`). Highest-leverage, lowest-effort fix in the domain.
3. **`sourceComparison` proves the economics work but routes them nowhere** (`audit-runner.ts:572`).
4. **The booked event is attribution-blind and revenue-blind** (`calendar-book.ts:286,289-295`). Even with CAPI on, Meta learns "a booking happened" but not which ad or its value.
5. **CAPI flag-off = Riley measures, Meta doesn't learn.** The Attribute→Meta-optimizer leg is severed.
6. **Reconciliation reports green unconditionally** — silent data-integrity blindness.
7. **`metrics-riley` surfaces the wrong KPI** (cost-per-lead as the target; `qualifiedPct=0`).
8. **Hardcoded source taxonomy** (`real-provider.ts:116-119`: only `ctwa`/`instant_form`) — WEBSITE/other destinations silently drop to zero attribution.

## 3. RANKED RECOMMENDATIONS (by leverage on outperform-human + flywheel closure)

**R1 — Expose per-campaign booked-CAC from the provider (the keystone).** Add `byCampaign: Record<campaignId, SourceFunnel>` to `getFunnelData` via a second group-by key; rows already carry `sourceCampaignId` (`crm-funnel-store.ts:42`). `real-provider.ts:121-133`. **Effort S (no new queries).** Risk low. Unlocks all of PR2. _TAG: PR2 enabling — corrects the plan, which assumes the fork is unresolved._

**R2 — Drive breach/kill/scale off cost-per-booked + strict fallback ladder.** Replace `cpa = spend/conversions` with per-campaign cost-per-booked from R1; Tier-2 = `effectiveTargetCPA = targetCPA × accountLeadToBooked`; Tier-3 = CPC watch-only; tag `economicTier`. `audit-runner.ts:366,394,405,498`; `recommendation-engine.ts`. Effort M, risk med. Deps R1. _TAG: PR2 core._

**R3 — Stamp attribution + value onto the booked event.** Populate `sourceCampaignId`/`sourceAdId` + real `value` (booking/service price) instead of `value:0`. `calendar-book.ts:286,289-295`. Effort S-M, risk med (mutating txn). _TAG: PR2 / CAPI-enablement._

**R4 — Fix `metrics-riley` to show customer economics.** Consume booked/CAC-vs-target; replace `qualifiedPct=0`; relabel ROI "cost per booked customer"/trueROAS. `metrics-riley.ts:57,96-152`. Effort M. _TAG: PR2._

**R5 — Instantiate the real `ReconciliationRunner`.** Wire `inngest.ts:394-404` to `new ReconciliationRunner({...})`; all four stores exist. Effort S, risk low (read-only; may surface real drift = a feature). _TAG: strategic gap._

**R6 — Turn CAPI on (env) once R3 lands.** Set `META_PIXEL_ID`+`META_CAPI_ACCESS_TOKEN`. Effort S, risk med (sends real PII conversions; coordinate w/ Meta App Review). Deps R3. _TAG: strategic gap (separate flag-flip per spec §2)._

**R7 — Per-campaign `sourceComparison` into decisions.** Extend `compareSources` to produce per-campaign rows from R1's `byCampaign`; feed budget-reallocation. `source-comparator.ts:38`; `audit-runner.ts:511-516`. Effort M. Deps R1. _TAG: PR3._

**R8 — Delete dead CAPI path / generalize source taxonomy (hygiene).** Remove unused `wireCAPIDispatcher` + `MetaCAPIClient`; make `bySource` data-driven not hardcoded (`real-provider.ts:116-119`). Effort S. _TAG: hygiene / PR2-adjacent._

## 4. VERIFICATION LOG

Spec PR2/§5/§3.4 matches code. Per-campaign fork: `getFunnelData` one aggregate + 2-key `bySource`; `sourceComparison` per-source; **store already groups per-campaign** (`crm-funnel-store.ts:42,142-176`) — collapse at `real-provider.ts:121-133`; cheapest fix = R1. Decision uses leads not booked (`audit-runner.ts:145-146,366`). CAPI env-gated; dead `wireCAPIDispatcher`/`MetaCAPIClient` (zero non-test callers). Reconciliation stub (`inngest.ts:394-404`) vs real runner (`reconciliation-runner.ts:31-82`). booked producer `calendar-book.ts:277-298` (`value:0`, no campaign id). `metrics-riley` CPL labels identical on main + Eyes worktree. Eyes delta: `inngest.ts:242` (stub→real) + Eyes signals; economic/Target diff empty.
