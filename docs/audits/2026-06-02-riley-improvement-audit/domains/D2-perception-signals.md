# D2 — Perception & Signal Richness (the "Eyes" beyond PR1)

> Raw domain audit. `file:line` against the post-Eyes provider (now on `main` via #792). Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE — the complete field inventory Riley fetches (post-Eyes)

| Surface                             | Graph fields fetched                                                                                                                                                  | file:line                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Campaign insights (audit core)      | `campaign_id, campaign_name, status, impressions, inline_link_clicks, spend, conversions, revenue, frequency, cpm, inline_link_click_ctr, cost_per_inline_link_click` | `audit-runner.ts:129-142` (`INSIGHT_FIELDS`) |
| Daily breach window                 | `campaign_id, spend, conversions` + `time_increment=1`, trailing 14d                                                                                                  | `meta-campaign-insights-provider.ts:92-96`   |
| Learning (entity edge)              | `id, name, campaign_id, learning_stage_info` on `/adsets` + adset insights `spend, conversions, frequency, inline_link_click_ctr`                                     | `meta-ads-client.ts:120-132`                 |
| Account summary                     | account metadata + 1 aggregate insights row + active-campaign count                                                                                                   | `meta-ads-client.ts:170-189`                 |
| Signal health                       | pixel metadata, `/stats` (combined + server), `/da_checks`                                                                                                            | `signal-health-checker.ts:151-263`           |
| Outcome attribution (separate cron) | `campaign_id, spend, inline_link_click_ctr, impressions` + `breakdowns:["day"]`                                                                                       | `meta-insights-adapter.ts:50-61`             |

**Decision driver:** Every kill/scale/budget threshold runs off `cpa = spend / conversions` (`recommendation-engine.ts:48`, `audit-runner.ts:155`). Booked economics (`costPerBooked`, `trueRoas`, `closeRate`) ARE computed (`source-comparator.ts:46-51`) and wired into the report (`audit-runner.ts:518-525`) but only drive cross-source `shift_budget` recs (`recommendation-engine.ts:284-297`), not the core breach/kill/scale logic. (PR2 scope.)

## 2. GAPS / WEAKNESSES vs north star

**G1 — `conversions` is an unfiltered aggregate; the breach denominator is poisoned.** Riley fetches Meta's raw `conversions` field with NO `action_type` filter and NO `action_attribution_windows` (verified absent). Meta's `conversions` sums _all_ conversion action types. PR1 made `periodsAboveTarget = count of days where spend/conversions > targetCPA` (`meta-campaign-insights-provider.ts:112-118`) the trigger for kill/add-creative. If `conversions` is inflated by non-lead actions, daily CPA is understated → breaches under-fire (false negatives). Nothing pins the result type. **Highest-risk data-quality hole — it sits directly under the signal PR1 just turned on.**

**G2 — Zero use of Meta breakdowns; Riley cannot localize a problem.** The client supports `breakdowns` (`meta-ads-client.ts:82-84`) but the audit-runner never passes any. Riley cannot see **placement** (Feed vs Reels vs Audience Network), **device/platform**, **age/gender**, **region**, or **hour-of-day**. A human buyer's first move on a high-CPA campaign is exactly this drill-down ("Audience Network is 80% of spend at 4x CPA; kill the placement, keep the campaign"). Riley can only say "pause the whole campaign." **Highest diagnostic-value gap.**

**G3 — Ad/creative-level perception is fully orphaned.** `creative-analyzer.ts` defines `RawAdData` (`:12-28`) with exactly the right fields — `imageHash, videoId, videoViews, qualityRanking, engagementRateRanking, conversionRateRanking, thumbStopRatio`. But there is **no ad-level fetch method on the client** (only campaign/adset/learning/account methods), and `deduplicateCreatives`/`analyzeCreatives` are never called in `audit-runner` (only `analyzeBudgetDistribution` is, line 515). The model is fully built and starved of input. **PR3 wires the _analyzers_ but does not add the ad-level fetch that feeds `RawAdData` — a gap in PR3's plan.**

**G4 — Reach is never fetched; saturation detection is structurally inert.** `saturation-detector.ts` needs `audienceReachedRatio` + `weeklyConversionRates` (`:7-12`). But `reach` is in no field list and no schema (`ad-optimizer.ts:48-82`), so `audienceReachedRatio` can only ever be `null`; and `detectSaturation` is never called. Riley is blind to audience burnout — a top medspa failure mode (small local audiences saturate fast).

**G5 — No CPM/reach _trend_; V2 trend path dormant in prod.** `trend-engine.projectBreach` (forecasting) is never called. The whole V2 trends + adSetDetails path requires `getTrendData`/`getAdSetInsights` deps, neither wired in `inngest.ts`. So `AuditRunner` steps 6-7 (`:431-496`) are dead code in production. Riley sees one 7-day vs prior-7-day delta, no rolling 30/60/90 or trajectory.

**G6 — CAPI/conversion signal is output-only; never an input.** `meta-capi-dispatcher.ts` SENDS conversions to Meta. The audit-runner/recommendation-engine never read CAPI volume or match quality back as a performance input. So Riley can't reconcile "Meta says 50 conversions / my CRM says 12 bookings" — the discrepancy that tells a buyer the pixel is mis-optimizing.

**G7 — Event match quality (EMQ) is a proxy.** `signal-health-checker.ts:6-7,276-277` substitutes `serverToBrowserRatio × dedupRate` for EMQ ("EMQ composite isn't on public MAPI"). Dedup is null whenever `matched_count` is absent (`:237`) — common. Riley's read on match quality is a weak derived number that collapses to 0 frequently.

**G8 — Rate-limit × serial fan-out is a hard scale ceiling (quantified).** `RATE_LIMIT_MS = 60_000` (`meta-ads-client.ts:10`), enforced serially across ALL calls on one client instance (`:308-316`). **4 Graph calls per campaign**: `getCampaignLearningData`→1 + `getAdSetLearningInputs`→2 internal (`/adsets` + adset insights) + `getTargetBreachStatus`→1. At 60s/call serial = **~4 min/campaign**. Plus per-deployment fixed ~9 calls. 1 org × 10 campaigns ≈ 40 min; 25 orgs × 5 campaigns ≈ **8.3 hours** — exceeds the weekly cron's practical step budget. The 60s constant is far more conservative than Meta's actual rate tiers.

**G9 — `getAdSetLearningInputs` reads page 1 only (≤200 ad sets).** `meta-ads-client.ts:118-124` — no `paging.next`. For >200 ad sets, coverage silently drops and the coverage-incompleteness guard over-protects. Flagged in-code.

**G10 — The dormant weekly-snapshot fallback is genuinely unreachable.** `meta-campaign-insights-provider.ts:103-109`: the `snapshots` branch only fires when the audit passes `snapshots`, which it never does (`audit-runner.ts:399-406`). **DROP it** (or wire a real source); the daily path already fails safe to `{periodsAboveTarget:0}`.

## 3. RANKED RECOMMENDATIONS

**R1 — Filter `conversions` to the real result type (attribution-windowed Lead/Purchase).** Fetch `actions`/`action_values`, select the medspa result action with explicit `action_attribution_windows`. Fixes the denominator under PR1's just-enabled breach signal. `meta-ads-client.ts:327,346`; `meta-campaign-insights-provider.ts:94`; `audit-runner.ts:137`. Effort M, risk M. **[extends:PR1 — arguably a correctness bug.]**

**R2 — Add placement + device breakdown; emit placement-scoped recs.** `getCampaignInsights({breakdowns:["publisher_platform","platform_position"]})` per breaching campaign → "exclude placement X" instead of "pause campaign." `audit-runner.ts:258-263` + new analyzer. Effort M. **[net-new — highest diagnostic lift.]**

**R3 — Add an ad-level fetch method; feed the orphaned creative analyzer.** New `getAdInsights(campaignId)` (ad_id, creative{id}, impressions, spend, clicks, conversions, video_thruplay, quality/engagement/conversion rankings, image_hash/video_id) → populate `RawAdData`; call `deduplicateCreatives`/`analyzeCreatives` → `creativeBreakdown`. Effort M-L. **[extends:PR3 — PR3 would wire a starved analyzer.]**

**R4 — Fetch `reach`; wire saturation detection.** Add `reach` to fields+schema; compute `audienceReachedRatio` + weekly conversion-rate series; call `detectSaturation`. `ad-optimizer.ts:48-82`; `audit-runner.ts:137,431`. Effort M. **[extends:PR3.]**

**R5 — Wire the dormant V2 trend + ad-set-detail path into the cron.** Implement/inject `getTrendData`/`getAdSetInsights` deps in `inngest.ts` so forecasting + rolling 30/60/90 + V2 learning run. Call `projectBreach`. Effort M. **[extends:PR3.]**

**R6 — Reconcile Meta conversions vs CRM bookings as an input signal.** Compare Meta `conversions` vs CRM `bookings` (already fetched, `real-provider.ts:137`) at `audit-runner.ts:292-304`; emit "Meta over/under-reporting Nx" insight; sanity-check the breach denominator. Effort S-M. **[net-new.]**

**R7 — Adaptive rate limiting (respect Meta headers) instead of fixed 60s.** Replace the static serial gate (`meta-ads-client.ts:308-316`) with backoff driven by `X-Business-Use-Case-Usage`/`X-Ad-Account-Usage` + 429 handling. Effort M. **[net-new — spec §7 hand-waves "reuse existing backoff"; there is none, only a fixed sleep.]**

**R8 — Parallelize per-deployment audits + batch Graph calls.** `Promise.all` of `step.run` (the code's own TODO); batch the multi-call patterns; fetch `time_increment=1` once and derive both aggregate and daily. `inngest-functions.ts:99-148`; `meta-campaign-insights-provider.ts:34,92`. Effort M-L. **[net-new — spec §7 dismisses rate-limit cost as "negligible"; that's wrong once the provider is real and per-campaign.]**

**R9 — Drop (or wire) the unreachable snapshot fallback.** `meta-campaign-insights-provider.ts:100-109`. Effort S. **[extends:PR1.]**

**R10 — Paginate `getAdSetLearningInputs`.** Follow `paging.next` (`meta-ads-client.ts:118-125`). Effort S. **[extends:PR1.]**

## 4. VERIFICATION LOG

Confirmed: provider/client diff (only `timeIncrement` + `getAdSetLearningInputs` + parseFloat); field inventory (`audit-runner.ts:129-142`, etc.); breakdowns unused in audit (grep → only plumbing + the `["day"]` outcome cron); orphaned analyzers (grep `deduplicateCreatives|analyzeCreatives|detectSaturation|projectBreach` → zero callers in audit-runner); no ad-level fetch (grep `getAds|level:"ad"|image_hash|quality_ranking` empty); V2 deps not wired in `inngest.ts`; CAPI output-only (grep empty in audit-runner/engine); `conversions` unfiltered (grep `action_attribution_windows` empty); `reach` absent from schema; rate-limit math (4 calls/campaign × 60s); snapshot fallback unreachable; pagination cap.
Domain boundary: R1/R6 touch the conversions/booking seam overlapping PR2 (D3); scoped here strictly as perception/data-quality (what number Riley fetches + whether it's trustworthy), not the optimize-on-booked decision change.
