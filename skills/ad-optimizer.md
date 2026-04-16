---
name: ad-optimizer
slug: ad-optimizer
version: 1.0.0
description: >
  Weekly campaign audit — analyzes ad performance across current and previous
  periods, diagnoses issues (creative fatigue, audience saturation, funnel leaks),
  and produces prioritized recommendations for budget reallocation, campaign
  scaling, and underperformer management.
author: switchboard
parameters:
  - name: CAMPAIGN_INSIGHTS
    type: object
    required: true
    description: Current period campaign performance data from Meta Ads API.
    schema:
      campaigns: { type: array, required: true }
      aggregated: { type: object, required: true }

  - name: PREVIOUS_INSIGHTS
    type: object
    required: true
    description: Previous period campaign data for comparison.
    schema:
      aggregated: { type: object, required: true }

  - name: ACCOUNT_SUMMARY
    type: object
    required: true
    description: Account-level summary metrics.
    schema:
      accountId: { type: string, required: true }
      totalSpend: { type: number, required: true }
      totalLeads: { type: number, required: true }

  - name: CRM_FUNNEL
    type: object
    required: true
    description: CRM funnel data (leads, qualified, closed, revenue).
    schema:
      leads: { type: number, required: true }
      qualified: { type: number, required: true }
      closed: { type: number, required: true }
      revenue: { type: number, required: true }

  - name: BENCHMARKS
    type: object
    required: true
    description: Industry/account benchmarks for funnel stages.
    schema:
      leadToQualified: { type: number, required: true }
      qualifiedToClosed: { type: number, required: true }

  - name: DEPLOYMENT_CONFIG
    type: object
    required: true
    description: Deployment settings including targetCPA, targetROAS, monthlyBudget.
    schema:
      targetCPA: { type: number, required: true }
      targetROAS: { type: number, required: true }
      monthlyBudget: { type: number, required: true }

tools:
  - ads-analytics

minimumModelTier: premium

output:
  fields:
    - name: recommendations
      type: array
      required: true
      description: Prioritized list of campaign recommendations.
      items:
        type: object
    - name: summary
      type: string
      required: true
      description: One-paragraph audit summary.
    - name: confidence
      type: enum
      values: [high, medium, low]
      required: true
      description: Overall confidence in the audit findings.
---

# Ad Optimizer — Weekly Campaign Audit

You are analyzing ad campaign performance for a business. Your job is to diagnose issues and produce actionable recommendations.

## Input Data

You have been provided with:

- **CAMPAIGN_INSIGHTS**: Current period campaign metrics
- **PREVIOUS_INSIGHTS**: Previous period for comparison
- **ACCOUNT_SUMMARY**: Account-level overview
- **CRM_FUNNEL**: Lead-to-close funnel data
- **BENCHMARKS**: Performance benchmarks
- **DEPLOYMENT_CONFIG**: Business targets (targetCPA: {{DEPLOYMENT_CONFIG.targetCPA}}, targetROAS: {{DEPLOYMENT_CONFIG.targetROAS}})

## Process

Follow these steps in order. Use tools for deterministic analysis. Apply your judgment for recommendations.

### Step 1: Compare periods

Use `ads-analytics.compare-periods` to compute metric deltas between current and previous period.

Pass the aggregated metrics from CAMPAIGN_INSIGHTS as `current` and from PREVIOUS_INSIGHTS as `previous`. Each should have: cpm, ctr, cpc, cpl, cpa, roas, frequency.

### Step 2: Diagnose issues

Use `ads-analytics.diagnose` with the deltas from Step 1.

The tool returns pattern-based diagnoses: creative_fatigue, competition_increase, landing_page_drop, lead_quality_issue, audience_saturation, audience_offer_mismatch, account_level_issue.

### Step 3: Analyze funnel

Use `ads-analytics.analyze-funnel` with CAMPAIGN_INSIGHTS, CRM_FUNNEL, and BENCHMARKS.

This identifies where the conversion funnel is leaking relative to benchmarks.

### Step 4: Check learning phase

For each campaign in CAMPAIGN_INSIGHTS, use `ads-analytics.check-learning-phase` to determine if it's in Meta's learning phase.

Campaigns in learning should have recommendations held — note them as "watch" items, not action items.

### Step 5: Produce recommendations

Based on the diagnoses, funnel analysis, and learning phase status, produce prioritized recommendations.

**Recommendation types** (use these exact types):

- `kill` — Pause campaign immediately. CPA > 2x target for 7+ days.
- `scale` — Increase budget. CPA well below target, no issues detected.
- `refresh_creative` — New creative needed. Creative fatigue or audience saturation detected.
- `restructure` — Expand targeting. Audience saturation detected.
- `hold` — Pause changes. Landing page or external issues detected.

**For each recommendation include:**

- `type`: one of the types above
- `action`: human-readable description
- `confidence`: high | medium | low
- `reasoning`: why this recommendation was made

**Rules:**

- Campaigns performing well (CPA ≤ target AND ROAS ≥ target) with no diagnoses → skip, note as stable
- Campaigns in learning phase → convert recommendations to watch items
- Prioritize: kill > hold > refresh_creative > restructure > scale

## Output

Respond with a single JSON object:

```json
{
  "recommendations": [{ "type": "...", "action": "...", "confidence": "...", "reasoning": "..." }],
  "proposedWrites": [],
  "summary": "One paragraph summarizing the audit findings.",
  "confidence": "high | medium | low"
}
```

Set confidence based on data completeness: high if all campaigns have data, medium if some are missing, low if significant data gaps.
