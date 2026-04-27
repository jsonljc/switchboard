# Ad Optimizer V2 — Enhanced Analytics & Diagnostics

> **Status:** Final
> **Date:** 2026-04-25
> **Scope:** 7 enhancements to the existing ad optimizer analytical pipeline
> **Verified against:** Meta internal learning phase framework, Marketing API field availability, internal creative fatigue scoring, delivery system behavior
> **Deferred:** PCD pipeline integration, seasonality/YoY, PAC ad variant handling

---

## 1. Learning Phase Rework

### Problem

The current `LearningPhaseGuard` operates at campaign level, uses a homegrown heuristic
(modified < 7 days + events < 50), and blanket-downgrades all recommendations to watches.
Meta's learning phase is per ad set, exposes a 3-state machine via `learning_stage_info`,
and already provides the signals we're guessing at.

### Design

Read Meta's actual learning status via `learning_stage_info{status}` on each ad set.
This field returns `LEARNING`, `SUCCESS`, or `FAIL` (Learning Limited).

| Meta State                       | API Detection                             | Switchboard Behavior                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learning** (`LEARNING`)        | `learning_stage_info.status = "LEARNING"` | Gate destructive actions (kill, restructure) but **allow creative fatigue detection** (fatigue can cause learning failure). Snapshot key metrics (CPA, ROAS, CTR). Report observation.                                                 |
| **Learning Limited** (`FAIL`)    | `learning_stage_info.status = "FAIL"`     | Escalate — don't watch. Diagnose root cause: (1) high frequency = audience too narrow → expand targeting, (2) low spend = underfunded → increase budget or consolidate ad sets, (3) high CPA = cost-constrained → review bid strategy. |
| **Learning Success** (`SUCCESS`) | `learning_stage_info.status = "SUCCESS"`  | Compare learning-period snapshot vs first 7 days post-exit. Flag "unstable exit" if performance degraded, "healthy exit" if held/improved.                                                                                             |

**Significant edit awareness:** When Switchboard recommends an action that triggers a
learning reset, warn the operator. Complete list of resets:

- Targeting changes
- Creative changes
- Optimization event changes
- Bid strategy changes
- Adding a new ad to an ad set
- Pausing an ad set for 7+ days
- Significant budget changes (magnitude-dependent, internally ~40%+ threshold)

**CBO impact:** A significant budget change at campaign level on CBO campaigns may reset
learning on multiple child ad sets. Factor in the count of ad sets currently in learning
or recently exited before recommending campaign-level budget changes.

**Data model:** `AdSetLearningRecord` — ad set ID, learning state, learning start date,
learning end date (null if still learning), metrics snapshot during learning, metrics
snapshot post-learning. Stored within the audit report flow.

### What We Drop

- The homegrown 7-day / 50-event heuristic in `LearningPhaseGuard`
- The `lastModifiedDays` and `optimizationEvents` fields from `CampaignLearningInput`
- Campaign-level learning phase checks

### What We Keep

- Gate behavior during active learning (smarter — only destructive actions, not diagnostics)
- The `gate()` method concept (recommendation → watch downgrade), but only for Learning state

---

## 2. Funnel Auto-Detection

### Problem

Single hardcoded funnel doesn't match click-to-WhatsApp or instant form campaigns.

### Design

Query `destination_type` at the **ad set level** (not campaign — one campaign can mix
destination types). Map to funnel shape:

**Website leads** (`destination_type = WEBSITE`):

```
Impressions → Clicks → Landing Page Views → Leads → Qualified → Closed
```

**Instant forms** (`destination_type = ON_AD`):

```
Impressions → Clicks → Leads (on-Facebook) → Qualified → Closed
```

Uses `onsite_conversion.lead_grouped` action type for on-Facebook leads. Verify availability
for specific campaign types as this action type may not appear if no leads were generated.

**Click-to-WhatsApp** (`destination_type` contains `WHATSAPP` — covers `WHATSAPP`,
`MESSAGING_MESSENGER_WHATSAPP`, and other multi-destination variants):

```
Impressions → Clicks → Conversations Started → First Reply → Qualified → Closed
```

Uses `onsite_conversion.messaging_conversation_started_7d` and
`onsite_conversion.messaging_first_reply` action types.

**ePD market fallback** (EU/EEA/UK/Japan): WhatsApp messaging metrics are unavailable.
Detect via the ad account's `timezone_name` or `currency` (EUR/GBP/JPY) mapped to known ePD
regions. Fall back to:

```
Impressions → Clicks → Qualified → Closed
```

**Edge case — `UNDEFINED` destination:** Some CTWA ads return `destination_type: UNDEFINED`
(known Meta bug). For these, check the creative's `call_to_action.type` — if
`WHATSAPP_MESSAGE`, treat as WhatsApp funnel.

**Implementation:**

- `detectFunnelShape(adSet)` — reads `destination_type`, returns `"website" | "instant_form" | "whatsapp"`
- `analyzeFunnel()` accepts funnel shape, picks correct stage template + benchmark set
- Support both ODAX (`OUTCOME_LEADS`, `OUTCOME_SALES`, `OUTCOME_ENGAGEMENT`) and legacy
  (`CONVERSIONS`, `LEAD_GENERATION`, `MESSAGES`) objective values
- Mixed campaigns: group ad sets by destination type, analyze each group with its funnel shape
- Report includes detected funnel shape per group
- Fallback: unknown destination_type defaults to website leads funnel

---

## 3. Creative-Level Performance

### Problem

The current diagnostician detects creative fatigue at campaign level but can't identify which
specific ads/creatives are performing or fatiguing.

### Design (launch scope — no PCD integration)

**Trigger:** Creative-level data is pulled when the campaign-level audit detects creative
fatigue, audience saturation, or when the operator explicitly requests a creative breakdown.
Not on every audit.

**Metrics per ad:**

- Spend, impressions, clicks, CTR, CPC, CPA, conversions
- ROAS (calculated from `action_values` array, not a native `revenue` field)
- Thumb stop ratio for video ads (calculated: `video_view / impressions * 100` —
  `video_view` is the action_type for 3-second views; thumb stop ratio is not a native metric)
- Impressions count as fatigue proxy (ad-level frequency is estimated/sampled and uses
  different reach deduplication than ad set level — not reliable for individual ad analysis)
- **Ad Relevance Diagnostics** (available at ad level with >500 impressions):
  - Quality Ranking — how ad quality compares to competitors
  - Engagement Rate Ranking — expected CTR vs competitors
  - Conversion Rate Ranking — expected CVR vs competitors

**Creative deduplication:**

- Image ads: group by `image_hash` (canonical dedup key within an ad account, content-based
  MD5 of resized image)
- Video ads: group by original `video_id` from `creative.video_data.video_id` (pre-clone ID).
  Meta clones videos per ad at delivery time. Check `source_video_id` if available as
  Advantage+ flows may return clone IDs in `video_data`
- Aggregate metrics across ads sharing the same visual creative

**Three outputs:**

1. **Creative ranking** — rank creatives by composite score weighted toward campaign
   optimization goal. Tag each with spend share. Surface top/bottom performers.

2. **Creative diagnosis** — enhanced with Ad Relevance Diagnostics:
   - Creative fatigue per creative: rising impressions + declining CTR + declining
     Engagement Rate Ranking
   - Spend concentration: one creative consuming >60% of campaign spend
   - Underperforming outlier: creative with CPA >2x campaign average
   - **Creative Limited** (warning): cost per result increasing — recommend adding new
     creatives alongside existing ones
   - **Creative Fatigue** (error): cost per result doubled or more vs historical — urgent
     refresh needed (aligns with Meta's internal 2x CPA threshold for fatigue classification)

3. **Creative recommendations:**
   - "Add fresh creatives alongside creative Y" — fatigue detected. **Do not pause fatigued
     ads** — Meta's evidence shows pausing disrupts delivery. Add new creatives first, then
     reduce budget on fatigued ones once replacements are delivering.
   - "Reduce budget on creative X" — underperforming outlier. Only recommend pausing for
     extreme cases (CPA >3x campaign average)
   - "Scale creative Z" — top performer with low spend share

**API call management:**

- Filter for active ads with impressions > 0
- Batch ad IDs in groups of ~50
- Use async report API for accounts with >100 active ads
- Monitor `X-FB-Ads-Insights-Throttle` headers, back off on throttling
- Asset fetching (image URLs, video nodes) deferred to post-launch PCD integration

### Deferred to Post-Launch

- PCD pipeline integration (auto-trigger creative generation from fatigue diagnosis)
- Asset fetching for PCD reference (AdCreative node + Video node reads)
- PAC ad placement variant handling

---

## 4. Trend Engine

### Problem

Single period comparison (current vs previous) can't distinguish noise from real trends.

### Design

**Layer 1: Rolling averages (30/60/90 day)**

For each metric (CPM, CTR, CPC, CPL, CPA, ROAS), compute aggregated averages over 30, 60,
and 90 day windows.

- "Where is this account sitting overall?"
- Compare against targets: "30-day average CPA is $85, target is $100"
- Compare across windows: "30-day CPA is $85 but 90-day is $65 — costs trending up"

Note: ROAS is calculated from `spend` and `action_values` (filtered by purchase/conversion
action types), not from a native `revenue` field.

**Layer 2: Week-on-week snapshots (4 weeks)**

Store weekly metric snapshots for the last 4 weeks (Monday-aligned via `time_increment=7`
with `since` set to a Monday).

- "What's the trajectory?"
- **Alert tier** (1-2 consecutive weeks declining): early warning, lower confidence
- **Confirmed tier** (3+ consecutive weeks declining): confirmed trend, high confidence
- Projected breach: extrapolate to estimate when a metric will cross the target threshold
- "At current WoW rate, you'll breach target CPA in ~N weeks"

**API calls (4 total, parallelizable):**

| Purpose        | Parameters                                                       | Returns          |
| -------------- | ---------------------------------------------------------------- | ---------------- |
| 30-day average | `time_range` = last 30 days, no `time_increment`                 | 1 aggregated row |
| 60-day average | `time_range` = last 60 days, no `time_increment`                 | 1 aggregated row |
| 90-day average | `time_range` = last 90 days, no `time_increment`                 | 1 aggregated row |
| 4-week WoW     | `time_range` = last 28 days (Monday-aligned), `time_increment=7` | 4 rows           |

Basic metrics only (impressions, spend, clicks, `actions`, `action_values`). No unique/reach
metrics that could cause timeouts. `time_increment` accepts integers 1-90 and string values
`"monthly"` and `"all_days"`.

Note: `date_preset=maximum` (not `lifetime`) returns up to 37 months of data. For trend
engine purposes, 90-day `time_range` is sufficient.

**Trend-aware recommendations:**

The recommendation engine currently sees single-period deltas. With trend data:

- "CPA spiked this week but 4-week trend is flat" → likely noise, lower confidence
- "CPA rose modestly this week but it's the 4th week in a row" → real problem, higher urgency
- "At current WoW rate, you'll breach target CPA in ~N weeks" → projected breach

**Output:** New `trends` section in the audit report alongside `periodDeltas`.

---

## 5. Budget Distribution Analysis

### Problem

Knowing what's wrong without knowing where the money is going limits recommendations.

### Design

**1. Cross-campaign balance**

For each campaign: spend share (% of total account spend), CPA, ROAS.

Flag imbalances:

- "Campaign A has 65% of spend but worst ROAS in the account"
- "Campaign B has 8% of spend but best CPA"
- Recommendation: reallocation with magnitude — "shift $X from A to B"

Guard rails:

- Don't recommend reallocation into campaigns in learning phase or with creative fatigue
- **Warn when source and target campaigns have different optimization goals** (e.g., REACH
  vs CONVERSIONS) — these compete in fundamentally different auctions. No "learning transfer"
  happens across campaigns.

**2. Per-campaign budget sizing**

Detect CBO vs ABO: check if campaign has nonzero `daily_budget` or `lifetime_budget`.
If either is set at campaign level, CBO is on. No `is_cbo` boolean field exists in the API.

| Budget Type | Valid Recommendations                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CBO**     | Campaign-level budget changes only. For ad set rebalancing, suggest ad set spend limits (`daily_min_spend_target`, `daily_spend_cap`). Warn about potential learning phase reset on child ad sets. |
| **ABO**     | Ad set-level budget increase/decrease directly.                                                                                                                                                    |

Three sizing signals (from trend engine WoW data):

- **Underspending winners**: CPA well below target + positive/stable trend + low spend share →
  budget increase (capped at 20% — below Meta's ~40% learning reset threshold)
- **Overspending losers**: CPA above target + negative trend + high spend share →
  budget decrease. Recommend adding fresh creatives before reducing budget (per Meta guidance).
- **Learning-constrained**: ad sets in Learning Limited → likely insufficient budget,
  recommend consolidation or increase

**Spend cap awareness:** Check campaign and account `spend_cap` before any increase
recommendation. If approaching cap, flag it. Don't recommend scaling past a cap.
Note: `spend_cap` value of `0` means no cap is set.

**Budget values:** API returns values in local currency minor units (e.g., cents for USD).
Currency offset is currency-dependent — not always /100 (e.g., Korean Won uses a different
offset). Use the ad account's `currency` field to determine the correct offset.

**Data source:** No new API calls. Campaign-level spend already pulled by the audit.

**Output:** New `budgetDistribution` section in audit report. Spend share data feeds into
recommendation engine for urgency weighting (action on 60% spend campaign = higher urgency
than action on 3% campaign).

---

## 6. Ad Set Frequency

### Problem

Frequency tracked at campaign level only. Campaign average can hide ad sets with extreme
frequency (campaign average 2.5 could mask one ad set at 5.0).

### Design

Pull frequency at ad set level — same Insights API call as learning phase ad set data.
Add `frequency` to the fields list. No extra API call. Frequency is estimated (sampled)
at all levels but is most meaningful at ad set level per Meta's internal guidance.

**Three uses:**

1. **Diagnostician input**: creative fatigue and saturation rules use ad set frequency
   instead of campaign average. Relative trends (rising/falling WoW) matter, not absolute
   thresholds — Meta has no canonical frequency number for fatigue.
2. **Learning phase context**: high frequency + Learning Limited = audience too narrow
   (expand targeting), not just underfunded (increase budget). Different recommendation.
3. **Budget distribution input**: low frequency + good CPA = room to scale.
   High frequency + rising CPA = diminishing returns, don't increase budget.

Campaign-level frequency stays as a summary metric in the report.

---

## 7. Saturation Detection

### Problem

The current `frequency > 3.5` hardcoded threshold has no basis in Meta's internal guidance.
Meta uses frequency as the primary saturation metric, supplemented by conversion rate
trajectory and audience reached ratio. There is no canonical frequency threshold — optimal
frequency varies by objective, vertical, and creative quality.

### Design

Replace single-threshold check with multi-signal detection using API-available data:

**Signal 1: Frequency + CTR trend** (primary — available via Insights API)

- Frequency rising WoW + CTR declining WoW from the trend engine
- No fixed threshold — direction and duration matter
- Alert tier: 1-2 weeks rising. Confirmed tier: 3+ weeks rising.
- This is closest to how Meta's delivery system evaluates creative exposure impact

**Signal 2: Conversion rate trajectory** (computable)

- Pull `actions + impressions` with `time_increment=7` over campaign lifetime
  (use `date_preset=maximum` for full history, capped at 37 months)
- Compare week 1 conversion rate vs current week
- Declining trajectory over 4+ weeks = campaign decay

**Signal 3: Audience reached ratio** (supplementary — computable, conditional)

- `reach` (from Insights API, `date_preset=maximum`) / `estimate_mau` (from
  `GET /<AD_SET_ID>/delivery_estimate` endpoint)
- Used as a supplementary confirmation signal, not a primary trigger
- `delivery_estimate` call is conditional — only when signals 1+2 suggest saturation
- Caveat: `delivery_estimate` may return unreliable values for complex targeting or DPA
  campaigns. Treat as directional, not precise.

**Revised diagnostician rules:**

| Pattern                 | Signals                                                                                                                               | Confidence |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Audience saturation** | Frequency rising 2+ weeks + CTR declining + audience reached ratio high (when checked)                                                | High       |
| **Creative fatigue**    | Frequency rising + CTR declining + CPA rising + Ad Relevance Diagnostics declining (Engagement Rate Ranking, Conversion Rate Ranking) | High       |
| **Campaign decay**      | Conversion rate declining over 4+ weeks vs week 1 baseline                                                                            | Medium     |

**Frequency cap awareness:** When saturation is detected, check if ad set has
`frequency_control_specs` set. If not, recommend adding a cap alongside creative/targeting
changes. Note: `frequency_control_specs` is only supported for campaigns with REACH
optimization goal — for other objectives, recommend creative refresh and audience expansion
instead.

---

## Recommendation Action Framework (revised)

The verification against Meta's internal guidance changes how we frame actions:

| Action                           | When                                                                          | Rationale                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add creative + reduce budget** | CPA > 2x target (daily data, 7+ days)                                         | Replaces "kill." Meta evidence: pausing disrupts delivery. Add fresh creatives first, reduce spend on fatigued ones once replacements deliver. |
| **Pause**                        | CPA > 3x target OR active financial loss                                      | Reserved for extreme cases only. Pausing = last resort.                                                                                        |
| **Review budget**                | CPA > 2x target (weekly data, lower confidence)                               | Softer signal from weekly snapshots.                                                                                                           |
| **Scale**                        | CPA < 0.8x target + no breaches + no diagnoses + stable/positive trend        | Budget increase capped at 20%.                                                                                                                 |
| **Refresh creative**             | Creative fatigue diagnosed (Ad Relevance Diagnostics + frequency/CTR signals) | Add new creatives alongside existing — don't remove fatigued ads immediately.                                                                  |
| **Expand targeting**             | Audience saturation confirmed + frequency rising                              | For Learning Limited + high frequency: audience too narrow.                                                                                    |
| **Restructure**                  | Audience saturation + audience reached ratio high                             | Broader targeting overhaul. Warn: resets learning.                                                                                             |
| **Hold**                         | Landing page drop diagnosed                                                   | Fix the landing page before changing ad spend.                                                                                                 |
| **Consolidate**                  | Multiple Learning Limited ad sets in same campaign                            | Merge into fewer ad sets to concentrate optimization events.                                                                                   |

---

## Audit Runner Integration

All 7 enhancements plug into the existing `AuditRunner` pipeline. The audit report gains
new sections:

```typescript
interface AuditReport {
  // Existing
  accountId: string;
  dateRange: DateRange;
  summary: AuditSummary;
  funnel: FunnelAnalysis[]; // Now array — one per funnel shape
  periodDeltas: MetricDelta[];
  insights: InsightOutput[];
  watches: WatchOutput[];
  recommendations: RecommendationOutput[];

  // New
  trends: TrendAnalysis; // 30/60/90 averages + 4-week WoW (alert + confirmed)
  budgetDistribution: BudgetAnalysis; // Cross-campaign balance + per-campaign sizing
  creativeBreakdown?: CreativeAnalysis; // Only when triggered by diagnosis
  adSetDetails: AdSetDetail[]; // Learning state, frequency, saturation signals
}
```

### Analysis Unit

Campaign level remains the default view. Ad set data is pulled for:

- Learning phase status via `learning_stage_info` (Section 1)
- Destination type / funnel detection (Section 2)
- Frequency (Section 6)
- Saturation signals (Section 7)

Creative (ad-level) data is pulled conditionally (Section 3), including Ad Relevance
Diagnostics for ads with >500 impressions.

### API Call Budget (per audit)

| Call                                                                        | When                                     | Count          |
| --------------------------------------------------------------------------- | ---------------------------------------- | -------------- |
| Campaign insights (current + previous)                                      | Always                                   | 2              |
| Account summary + account fields (`currency`, `timezone_name`, `spend_cap`) | Always                                   | 1              |
| CRM funnel data + benchmarks                                                | Always                                   | 2              |
| Trend engine (30/60/90 avg + WoW)                                           | Always                                   | 4              |
| Ad set insights (learning_stage_info + frequency + destination_type)        | Always                                   | 1              |
| Ad-level insights + Ad Relevance Diagnostics                                | On creative fatigue/saturation diagnosis | 0-1            |
| `delivery_estimate` (audience size)                                         | On saturation suspicion (conditional)    | 0-N per ad set |
| Conversion rate trajectory (lifetime with time_increment=7)                 | On campaign decay suspicion              | 0-1            |

Baseline: 10 calls per audit. Conditional: up to ~5 more depending on diagnoses.
Well within Meta's rate limits (190,000 + 400 × active_ads calls/hour for standard tier).

### Key API Corrections from Verification

- **Revenue**: no native `revenue` field. Use `action_values` array filtered by action type.
- **Learning phase**: use `learning_stage_info{status}`, not `effective_status`.
- **CBO detection**: no `is_cbo` field. Check campaign `daily_budget`/`lifetime_budget` > 0.
- **Lifetime data**: use `date_preset=maximum` (37-month cap), not `date_preset=lifetime`.
- **Budget currency**: offset is currency-dependent, not always /100. Use account `currency`.
- **Frequency caps**: `frequency_control_specs` only works with REACH optimization goal.
- **Video dedup**: check `source_video_id` if available; `video_data.video_id` may be clone.
