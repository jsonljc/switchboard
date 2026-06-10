# D3 — Economics & Attribution Truth (Riley capability audit, 2026-06-10)

> Re-audit of the 2026-06-02 baseline domain D3 against current main. Every claim re-verified against code; file:line relative to repo root.

## Thesis

Riley's economics layer has crossed from "computed then discarded" to a genuinely floored, unit-disciplined decision substrate: per-campaign booked-CAC projection, an economic-tier ladder, per-source spend attribution with coverage gates, a reasoned corroboration predicate, and an execution-clock-anchored outcome ledger all exist and fail toward abstention. **But the revenue NUMERATOR never arrives.** Two missing producers — booked conversion value (always 0) and targetCostPerBooked (never configured) — keep the booked_cac tier, per-campaign trueROAS, and the corroborated causal arm permanently dormant. Riley today reallocates on booked-COUNT truth judged against a CPL proxy. The architecture is honest about this everywhere (nulls and abstentions, never fabricated zeros), which is why the verdict is sound-with-gaps and not unsound: nothing moves money on fabricated data, but the moat's revenue leg is not yet real.

## Current state (verified)

| Leg                                                     | State                                                    | Evidence                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-campaign funnel projection (baseline R1 keystone)   | **SHIPPED, sound**                                       | `real-provider.ts:124-144` — byCampaign rides the same store rows, zero new queries; sparse rows preserved as null                                                                                                                                                                                |
| Economic-tier ladder, account + per-campaign (R2)       | **SHIPPED but DORMANT**                                  | `economic-target.ts:168-230` calibrate-first; `audit-runner.ts:452-457,531-535`; Tier-1 requires `inputConfig.targetCostPerBooked` which **no product surface writes** (`inngest-functions.ts:183-194`)                                                                                           |
| Booked event attribution stamping (R3, attribution leg) | **SHIPPED**                                              | `booked-conversion-payload.ts:25-45` — sourceCampaignId/sourceAdId/fbclid/lead_id/customer stamped in the booking tx (`calendar-book.ts:365-380`)                                                                                                                                                 |
| Booked event VALUE (R3, value leg)                      | **STILL OPEN**                                           | `calendar-book.ts:375` `value: estimatedValue ?? 0`; `Opportunity.estimatedValue` has **no production writer** (alex.ts:68-74, skill-mode.ts:321-327/756-764 create without it; no update path)                                                                                                   |
| Per-source spend attribution + reallocation (R7)        | **SHIPPED, sound**                                       | `spend-attributor.ts:40,67-134` per-candidate coverage floor 0.7; `source-reallocation.ts:136-188` 7 ordered abstention gates, advisory-only                                                                                                                                                      |
| Reconciliation (R5)                                     | **SHIPPED**                                              | `reconciliation.ts:39-44` real ReconciliationRunner; baseline's hardcoded-healthy stub is gone (`inngest.ts:603`)                                                                                                                                                                                 |
| CAPI dispatch (R6/R8)                                   | **OFF; multi-tenant-unsafe as wired; dead path remains** | `conversion-bus-bootstrap.ts:54-57` global env pixel/token for all orgs; `wireCAPIDispatcher`/`MetaCAPIClient` zero non-test callers                                                                                                                                                              |
| Outcome ledger (#886/#939/#946/#948)                    | **SHIPPED, mostly sound, flag-dark**                     | `outcome-attribution.ts`, `outcome-corroboration.ts:123-196` (finite-guarded, upgrade-only), `recommendation-store.ts:303-339` (execution clock anchor), `operational-stability.ts:264-279` (late evidence disruption-only); `RILEY_OUTCOME_ATTRIBUTION_ENABLED=false` default (.env.example:331) |
| Units discipline                                        | **Sound**                                                | cents→major exactly once at boundaries: `conversion-value.ts:9-11`, `source-comparator.ts:61-64`, `meta-capi-dispatcher.ts:100-110`; cents-over-cents dimensionless ratio in corroboration                                                                                                        |

## Findings

### D3-1 (P1, known-open) — Booked value is always 0; booked-revenue truth is count-truth

The only producer of `type:"booked"` ConversionRecords is calendar-book, and its value is `estimatedValue ?? 0` (`calendar-book.ts:375`). No production path writes `Opportunity.estimatedValue`. Every value-gated consumer filters `value > 0`: `queryBookedValueCentsByCampaign` (`prisma-conversion-record-store.ts:238`) → per-campaign trueROAS null everywhere; `getBookedStatsForOrgWindow` (`:325`) → corroboration permanently rejects `sparse_bookings` (`outcome-corroboration.ts:167-171`); CAPI booked events carry no value. Baseline R3's value leg, still open. **Fix:** populate estimatedValue from a service-price source at opportunity creation, or stamp value from the verified-payment leg.

### D3-2 (P1, net-new) — targetCostPerBooked has no producer; the whole booked_cac ladder is dormant

Read at `inngest-functions.ts:183-194` from `deployment.inputConfig`; written by nothing (dashboard writes only adAccountId/pixelId — `marketplace.ts:146,157`; seeds write none). Without it `hasBookedTarget` is always false (`economic-target.ts:63,168-189`) → every audit judges on CPL/CPC forever, account and per-campaign. The exact "safety gate needs producer population" pattern. **Fix:** small settings/onboarding field writing the existing inputConfig route; consider unifying with the cockpit's separate `targetCpbCents` surface (`metrics-riley.ts:111-113`).

### D3-3 (P2, net-new) — NaN-blind delta gate can mint a permanent renderable outcome row

`attributeOneRecommendation` computes `deltaPct` that can be NaN (pre>0, post=NaN: Meta spend/ctr parse via `parseFloat`, `meta-ads-client.ts:464-469`; the adapter finite-guards only `accountSpendCents`, not `spendCents`/`ctr` — `meta-insights-adapter.ts:70-84`). NaN passes `deltaPct !== null` → `cockpitRenderable=true` (`outcome-attribution.ts:117`), noise floor comparisons are NaN-false (`:105-114`), `Math.sign(NaN)` → unfavorable → `trustDelta:"down"` + NaN copy values (`:158-176`). Row is insert-once; the corruption freezes. #939's `Number.isFinite` guard covers the corroboration arm only (`outcome-corroboration.ts:153-165`). `detectDenominatorStepChange` is similarly NaN-blind toward "trusted" (`denominator-step-change.ts:27-34`). **Fix:** finite-guard spendCents/ctr in the adapter (mirror the accountSpendCents guard) plus `Number.isFinite(deltaPct)` in the renderability predicate.

### D3-4 (P2, net-new) — Executed pauses structurally collapse to meta_data_missing

Meta's insights edge omits zero-delivery days; a fully paused campaign yields zero post-window rows → `getWindowMetrics` returns null (`meta-insights-adapter.ts:73-74`) → `meta_data_missing`, hidden, inconclusive (`outcome-attribution.ts:59-66`). The act-leg's flagship action cannot earn renderable wins; success is indistinguishable from missing data. #946's execution-clock anchor is correct but anchors a window the pipeline then discards. **Fix:** for candidates with a stashed `executedWorkUnitId` (machine receipt), treat an absent post-window as ground-truth zero spend.

### D3-5 (P2, net-new) — Booked occurredAt = slotStart (appointment time), not booking time

`calendar-book.ts:381`. Corroboration sub-windows and the weekly booked-value join window on `occurredAt` (`prisma-conversion-record-store.ts:239,326`), so bookings MADE in-window for future slots vanish from the window the ad caused them in. MetaCAPIDispatcher checks only too-old, not future `event_time` (`meta-capi-dispatcher.ts:45-48`) — Meta will reject future-dated booked events when CAPI flips on. Latent only because of D3-1. **Fix:** stamp occurredAt at booking confirmation; slot times already live in metadata.

### D3-6 (P2, net-new) — 7-day same-cohort funnel window starves booked counts

`queryFunnelCounts` requires contact.createdAt AND booking.createdAt in the same 7-day audit window (`crm-funnel-store.ts:93-156`; window from `inngest-functions.ts:128-141`). Lead→booking lag crossing the weekly boundary drops the booking from every window, making the Tier-1 floor (10 bookings/campaign/week, `economic-target.ts:12`) and the per-source booking floor (3, `source-reallocation.ts:48`) nearly unreachable at SMB volume. Conservative direction (more abstention), but it silently caps the keystone even after D3-2 is fixed. **Fix:** decouple the cohort axes (longer contact-attribution lookback, window on booking creation).

### D3-7 (P2, known-open) — CAPI off; global single-pixel wiring is multi-tenant-unsafe; dead duplicate path remains

`conversion-bus-bootstrap.ts:54-57` gates on global `META_PIXEL_ID`/`META_CAPI_ACCESS_TOKEN` (blank by default) — one pixel for ALL orgs' events, while per-org pixel resolution already exists for signal health. Baseline R8 not done: `wireCAPIDispatcher`/`MetaCAPIClient` still on disk with zero non-test callers. **Fix:** per-org dispatcher from DeploymentConnection creds; delete the dead path; sequence after D3-1/D3-5.

### D3-8 (refinement) — Pause-win tautology persists; its designed antidote is blocked by D3-1

Favorable pause delta (spend fell — mechanical after execution) earns `trustDelta:"up"`/`pause.spend.fell` unless operator-confirmed unstable (`outcome-attribution.ts:158-176`). The corroborated arm is the honest answer (`outcome-corroboration.ts:16-26`) but cannot fire on zero-value bookings. trustDelta is advisory copy only today (`outcome-activity-row.ts:31`), so refinement — escalates the moment a trust ramp consumes the ledger.

### D3-9 (refinement, net-new) — Cockpit cost-per-booked over-credits Riley

`metrics-riley.ts:108` divides Meta spend by ALL non-cancelled bookings (no attribution filter), counting Alex/organic bookings in Riley's CAC. The reports layer already does this correctly via first-touch split (`attribution-rule.ts:5-10,43-62`). Display-only.

### D3-10 (verify-shipped) — What is sound, with evidence

- **Per-campaign projection**: zero-extra-query byCampaign with sparse-row-preserving nulls (`real-provider.ts:124-144`, `source-comparator.ts:89-103`).
- **Abstention discipline**: reallocation passes 7 ordered gates (winner quality, absolute profitability ≥1.0 trueROAS, per-candidate spend-attribution coverage ≥0.7, measurement trust, per-source volume floors, account evidence floor) and is advisory-only (`source-reallocation.ts:136-188`).
- **Units**: cents→major converted exactly once at named boundaries; corroboration compares cents/cents dimensionless (`outcome-corroboration.ts:189-192`).
- **Corroboration (#939)**: reasoned rejection enum, finite-guard BEFORE comparison gates, upgrade-only, anti-degeneracy spend-continuity band 0.5–1.5 (`outcome-corroboration.ts:123-196`).
- **Operational stability (#948)**: late confirmations admitted as dated-interval disruption evidence only — can flip toward unstable, never certify; unparseable bounds fail toward unstable (`operational-stability.ts:97-127,264-279`).
- **Executed-pause anchoring (#946)**: `markActedByExecution` uses the execution clock, race-safe conditional updateMany, machine sentinel actor (`recommendation-store.ts:303-339`).
- **Reconciliation (R5)**: real runner wired (`reconciliation.ts:39-44`); baseline's unconditional-healthy stub is gone.
- **Idempotency**: outcome rows two-layer guarded (pre-check + P2002 typed error, `outcome-attribution.ts:371-384`, `recommendation-outcome-store.ts:95-126`).

**Ops note:** the outcome ledger itself is dark until `RILEY_OUTCOME_ATTRIBUTION_ENABLED=true` (default false, `.env.example:331`); confirm prod env when flipping the pilot.

## Priority sequence for the north star

1. **D3-1 + D3-2** (the two producers) — everything value-shaped downstream unblocks at once.
2. **D3-5** (occurredAt) before any value flows, so it lands in the right windows.
3. **D3-6** (cohort window) so Tier-1/floors are reachable at pilot volume.
4. **D3-3 + D3-4** (ledger hardening) before Spec-1B leans on outcomes for trust.
5. **D3-7** (per-org CAPI) as the Attribute→Meta leg, after 1-3.
