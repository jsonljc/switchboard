# Ad Optimizer Agent — Design Spec

**Date:** 2026-04-13
**Status:** Draft
**Goal:** Build a read-only media strategist agent that connects to Meta Ads, diagnoses funnel leakage through period-over-period analysis, and produces actionable recommendations — without ever writing to the ad platform.

---

## 1. Problem Statement

SMBs waste money on ads because they don't know what's broken. They look at Ads Manager, see numbers, and don't know what to do. The ones who hire agencies pay $2-5K/month for someone to do exactly what this agent does: pull data, find problems, tell them what to fix.

Previous attempts at full ad automation (auto-create campaigns, auto-adjust budgets, auto-publish creatives) trigger Meta's fraud detection and get accounts banned. The industry learned this the hard way: Meta's API is read-friendly, write-hostile for AI agents.

**The right approach:** Automate the analysis (95% of the work), leave the 30-second publish step to the human.

---

## 2. Design Principle: Read-Only API, Human-Execute

| Step                | Automated? | Details                                                                      |
| ------------------- | ---------- | ---------------------------------------------------------------------------- |
| Pull data           | Yes        | Read-only Meta Marketing API (`ads_read` scope only)                         |
| Analyze funnel      | Yes        | Impressions → Clicks → Leads → Deals → Revenue                               |
| Compare periods     | Yes        | WoW and MoM deltas for CPM, CTR, CPC, CPL, CPA, ROAS                         |
| Diagnose root cause | Yes        | Pattern matching: creative fatigue, audience saturation, landing page issues |
| Recommend actions   | Yes        | Scale / Kill / Refresh / Restructure / Hold with specific steps              |
| Execute changes     | **Human**  | Buyer clicks in Ads Manager. 30 seconds per recommendation.                  |

### API Safety Rules (hardcoded, not configurable)

1. **Read-only OAuth scope** — request `ads_read` only, never `ads_management`. The agent cannot write even if trust score is 100.
2. **Rate limiting** — max 1 structured API pull per hour per account. Weekly audits: 1 call. Daily alerts: 1 call. Well under Meta's 200/hour limit.
3. **Batch, don't stream** — one call to `/act_{id}/insights` with breakdowns, not per-campaign iteration.
4. **No creative publishing** — PCD creates assets. Buyer uploads to Ads Manager manually.
5. **No budget changes via API** — recommendations say "change X to Y." Buyer does it.
6. **No campaign creation via API** — recommendations say "create campaign with these settings." Buyer does it.

---

## 3. The Analysis Framework

### 3.1 Funnel Breakdown

For each campaign, compute conversion rate at each stage:

```
Impressions → Clicks (CTR)
  → Landing Page Views (LPV rate)
    → Leads (Conversion rate)
      → Qualified (from Contact.stage via Sales Pipeline)
        → Closed (from Opportunity.stage = "won")
          → Revenue (from LifecycleRevenueEvent)
```

Find the stage with the biggest drop-off vs the account's own historical benchmark (not industry benchmarks — those are meaningless for individual SMBs).

### 3.2 Period-Over-Period Comparison

For each metric at campaign and ad set level:

| Metric    | Compute                                                      |
| --------- | ------------------------------------------------------------ |
| CPM       | Cost per 1000 impressions                                    |
| CTR       | Click-through rate                                           |
| CPC       | Cost per click                                               |
| CPL       | Cost per lead (using Meta's lead events or Contact creation) |
| CPA       | Cost per acquisition (using Opportunity.won)                 |
| ROAS      | Revenue / Ad Spend (using LifecycleRevenueEvent)             |
| Frequency | Average times a user saw the ad                              |

Compare: this week vs last week (WoW), this month vs last month (MoM). Flag any delta > 15%.

### 3.3 Metric Diagnosis

Map metric patterns to root causes:

| Pattern                         | Diagnosis                                             | Confidence |
| ------------------------------- | ----------------------------------------------------- | ---------- |
| CPM up + CTR stable             | Competition increase or seasonal demand               | Medium     |
| CPM stable + CTR down           | Creative fatigue (check frequency > 3)                | High       |
| CTR stable + CPL up             | Landing page conversion drop                          | High       |
| CPL stable + CPA up             | Lead quality issue (qualification rate dropping)      | Medium     |
| All metrics degrading           | Account-level issue or market shift                   | Low        |
| Frequency > 3.5 + CTR declining | Audience saturation — need fresh audience or creative | High       |
| Strong CTR + low conversions    | Audience-offer mismatch or landing page problem       | High       |

### 3.4 Recommendation Engine

Based on diagnosis, produce ranked actions:

| Action               | When                                           | What buyer does                            |
| -------------------- | ---------------------------------------------- | ------------------------------------------ |
| **Scale**            | Campaign has CPA below target + stable metrics | Increase daily budget by 20-30%            |
| **Kill**             | CPA > 2x target for 7+ days                    | Pause campaign                             |
| **Refresh Creative** | Frequency > 3, CTR declining                   | Upload new PCD creative to the ad set      |
| **Restructure**      | Audience saturation > 70% reach                | Create new ad set with different targeting |
| **Hold**             | Seasonal pattern detected                      | Wait — metrics will recover                |
| **Test**             | Winning campaign, budget headroom              | Duplicate ad set with creative variation   |

Each recommendation includes:

- Confidence score (0-1)
- Estimated impact ("saving ~$X/week" or "potential +Y% ROAS")
- Specific steps in Ads Manager (campaign name, ad set name, exact changes)
- Urgency (immediate / this week / next review cycle)

---

## 4. Architecture

### 4.1 Module Structure

**Location:** `packages/core/src/ad-optimizer/`

```
packages/core/src/ad-optimizer/
  index.ts                    — barrel exports
  meta-ads-client.ts          — Meta Marketing API read-only wrapper
  funnel-analyzer.ts          — Funnel breakdown + leakage detection
  period-comparator.ts        — WoW/MoM delta computation
  metric-diagnostician.ts     — Pattern → root cause mapping
  recommendation-engine.ts    — Ranked actions with confidence + impact
  audit-runner.ts             — Orchestrator: pull → analyze → diagnose → recommend
  __tests__/
    funnel-analyzer.test.ts
    period-comparator.test.ts
    metric-diagnostician.test.ts
    recommendation-engine.test.ts
    audit-runner.test.ts
```

### 4.2 Meta Ads Client

Read-only wrapper around Meta Marketing API. Uses the buyer's OAuth token (stored encrypted in `DeploymentConnection` credentials via the existing `meta-ads` integration).

```typescript
interface MetaAdsClient {
  // Pull campaign-level insights for a date range
  getCampaignInsights(params: {
    accountId: string;
    dateRange: { since: string; until: string };
    fields: string[]; // spend, impressions, clicks, cpm, ctr, cpc, actions, etc.
    breakdowns?: string[]; // age, gender, platform_position, etc.
  }): Promise<CampaignInsight[]>;

  // Pull ad set-level insights
  getAdSetInsights(params: {
    accountId: string;
    campaignId?: string;
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<AdSetInsight[]>;

  // Pull account-level spend summary
  getAccountSummary(accountId: string): Promise<AccountSummary>;
}

interface CampaignInsight {
  campaignId: string;
  campaignName: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  ctr: number;
  cpc: number;
  frequency: number;
  reach: number;
  actions: Array<{ actionType: string; value: number }>; // leads, purchases, etc.
}
```

**Rate limiting:** Built into the client — minimum 60 seconds between calls, max 1 call per endpoint per hour.

**Error handling:** Meta API errors (rate limit, token expired, account restricted) produce clear error messages in the audit report, not silent failures.

### 4.3 Funnel Analyzer

Takes campaign insights + CRM data (Contact, Opportunity) and computes the full funnel:

```typescript
interface FunnelStage {
  name: string;
  count: number;
  rate: number; // conversion rate from previous stage
  benchmark: number; // historical average rate for this account
  delta: number; // current rate vs benchmark
}

interface FunnelAnalysis {
  stages: FunnelStage[];
  leakagePoint: string; // stage with worst delta
  leakageMagnitude: number; // how bad is it
}
```

CRM data comes from the existing models:

- `Contact` — leads (filtered by `sourceAdId` or `sourceCampaignId`)
- `Opportunity` — qualified + closed deals
- `LifecycleRevenueEvent` — revenue attribution

### 4.4 Period Comparator

```typescript
interface PeriodMetrics {
  period: "current_week" | "previous_week" | "current_month" | "previous_month";
  metrics: Record<string, number>; // cpm, ctr, cpc, cpl, cpa, roas, frequency
}

interface MetricDelta {
  metric: string;
  current: number;
  previous: number;
  deltaPercent: number;
  direction: "up" | "down" | "stable";
  significant: boolean; // |delta| > 15%
}
```

### 4.5 Audit Runner

Orchestrates the full audit pipeline:

```
1. Pull current + previous period data from Meta Ads API
2. Pull CRM data for attribution (Contact + Opportunity by sourceAdId)
3. Compute funnel breakdown
4. Compute period deltas
5. Run metric diagnosis
6. Generate ranked recommendations
7. Assemble audit report
8. Create AgentTask with structured output
```

The audit runner is triggered:

- **Scheduled:** Weekly (Monday morning) via the existing scheduler
- **On-demand:** Buyer clicks "Run Audit" in the My Agent dashboard
- **Alert mode:** Daily lightweight check (account summary only, flag threshold breaches)

### 4.6 Output Format (AgentTask)

```typescript
interface AuditReport {
  accountId: string;
  dateRange: { since: string; until: string };
  summary: {
    totalSpend: number;
    totalLeads: number;
    totalRevenue: number;
    overallROAS: number;
    activeCampaigns: number;
  };
  funnel: FunnelAnalysis;
  periodDeltas: MetricDelta[];
  diagnoses: Array<{
    campaignId: string;
    campaignName: string;
    pattern: string;
    rootCause: string;
    confidence: number;
  }>;
  recommendations: Array<{
    action: "scale" | "kill" | "refresh_creative" | "restructure" | "hold" | "test";
    campaignId: string;
    campaignName: string;
    confidence: number;
    urgency: "immediate" | "this_week" | "next_cycle";
    estimatedImpact: string;
    steps: string[]; // specific Ads Manager steps
  }>;
}
```

---

## 5. Synergies

### 5.1 PCD (Performance Creative Director)

When diagnosis is "creative fatigue":

- Recommendation includes "Trigger PCD for fresh creative"
- If PCD is deployed in same org, auto-creates a `CreativeJob` task with:
  - `pastPerformance` pre-filled from the failing campaign's metrics
  - `targetAudience` from the campaign's targeting
  - `platforms: ["meta"]`

### 5.2 Sales Pipeline

Attribution report joins:

- `Contact.sourceAdId` → which ad brought this lead
- `Opportunity.stage` → did the lead close
- `LifecycleRevenueEvent.amount` → how much revenue

This gives **true ROAS** (closed revenue / ad spend), not Meta's reported ROAS (which counts conversions, not revenue).

### 5.3 Memory System

The compounding loop extracts patterns across audits:

- "Campaign type X consistently outperforms type Y for this business"
- "This account's CPM spikes every December"
- "Lookalike audiences decay after 3 weeks for this vertical"

These become deployment memory entries that improve future diagnoses.

---

## 6. Setup Schema

```typescript
{
  onboarding: {
    websiteScan: false,
    publicChannels: false,
    privateChannel: false,
    integrations: ["meta-ads"],
  },
  steps: [
    {
      id: "ad-config",
      title: "Ad Account Settings",
      fields: [
        { key: "monthlyBudget", type: "text", label: "Monthly Ad Budget ($)", required: true },
        { key: "targetCPA", type: "text", label: "Target Cost Per Acquisition ($)", required: false },
        { key: "targetROAS", type: "text", label: "Target ROAS (e.g., 3.0)", required: false },
        { key: "auditFrequency", type: "select", label: "Audit Frequency", required: true, options: ["weekly", "daily"], default: "weekly" },
      ],
    },
  ],
}
```

Meta Ads credentials (accessToken, accountId, pixelId) come through the `meta-ads` OAuth integration during onboarding — the credential fields and connection UI already exist in the dashboard.

---

## 7. Trust-Gated Capabilities

| Trust Level       | Capabilities                                                          |
| ----------------- | --------------------------------------------------------------------- |
| Supervised (0-29) | Weekly audit report only                                              |
| Guided (30-54)    | Weekly audit + daily anomaly alerts + attribution reports             |
| Autonomous (55+)  | Same analysis depth + proactive recommendations + PCD trigger synergy |

**Trust unlocks analysis frequency and depth, never write access.** Auto-execution of ad changes is permanently off the table.

The buyer approves or dismisses each recommendation via the dashboard. Approvals feed into trust score. Over time, the agent's recommendations become higher confidence because the memory system learns what works for this specific business.

---

## 8. Dashboard UX (My Agent page additions)

For agents with `family: "paid_media"` and Ad Optimizer type, the My Agent page shows:

**Audit Summary Card:**

- Last audit date, overall ROAS, total spend, total leads
- Health indicator (green/yellow/red based on target CPA/ROAS)

**Recommendations Queue:**

- Actionable cards with urgency badges
- Each card: problem description, diagnosis, specific Ads Manager steps
- Buttons: `[Mark as Done]` (approval → trust score) / `[Dismiss]` (rejection → trust score)

**Trend Charts:**

- CPM, CTR, CPA, ROAS over time (WoW view)
- Funnel visualization with leakage highlighting

---

## 9. What We Don't Build

- **Write access to Meta Ads API** — permanently read-only. No campaign creation, budget changes, or creative uploads via API.
- **Google Ads / TikTok connectors** — v2, after Meta is solid.
- **Custom attribution models** — last-click only for v1.
- **Lookalike audience management** — out of scope.
- **Creative A/B testing via API** — PCD produces creative, buyer manages A/B in Ads Manager.
- **Automated scheduling** — buyer controls when campaigns run.

---

## 10. Build Order

| Phase | What                                                                             | New Files                                             |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1     | Zod schemas for audit types (CampaignInsight, FunnelAnalysis, AuditReport, etc.) | `packages/schemas/src/ad-optimizer.ts`                |
| 2     | Meta Ads Client (read-only API wrapper with rate limiting)                       | `packages/core/src/ad-optimizer/meta-ads-client.ts`   |
| 3     | Funnel Analyzer + Period Comparator (pure computation, no API)                   | `funnel-analyzer.ts`, `period-comparator.ts`          |
| 4     | Metric Diagnostician + Recommendation Engine (LLM-assisted)                      | `metric-diagnostician.ts`, `recommendation-engine.ts` |
| 5     | Audit Runner (orchestrator) + AgentTask output                                   | `audit-runner.ts`                                     |
| 6     | Marketplace listing seed data + API route for on-demand audit                    | Seed + route                                          |
| 7     | Dashboard: audit summary card, recommendation queue, trend charts                | Dashboard components                                  |
