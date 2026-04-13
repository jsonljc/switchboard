# Ad Optimizer Agent — Design Spec

**Date:** 2026-04-13
**Status:** Draft
**Goal:** Build a media strategist agent that connects to Meta Ads via OAuth, diagnoses funnel leakage through period-over-period analysis, manages campaign setup (but never publishes), dispatches conversions via CAPI, and learns from outcomes over time — all within Meta's learning phase constraints.

---

## 1. Problem Statement

SMBs waste money on ads because they don't know what's broken. They look at Ads Manager, see numbers, and don't know what to do. The ones who hire agencies pay $2-5K/month for someone to do exactly what this agent does: pull data, find problems, tell them what to fix.

Previous attempts at full ad automation (auto-create campaigns, auto-adjust budgets, auto-publish creatives) trigger Meta's fraud detection and get accounts banned. The industry learned this the hard way: Meta's API is read-friendly, write-hostile for AI agents — specifically around the **publish** action.

**The right approach:** Automate everything except the publish button. The agent builds, configures, analyzes, and recommends. The human clicks publish.

---

## 2. Design Principle: Everything Except Publish

The boundary is **publish**, not "write." The agent can write to Meta's API for setup and measurement — it just can't make ads go live.

| Step                     | Automated? | Details                                                                   |
| ------------------------ | ---------- | ------------------------------------------------------------------------- |
| Pull data                | Yes        | Meta Marketing API read endpoints                                         |
| Analyze funnel           | Yes        | Impressions → Clicks → Leads → Deals → Revenue                            |
| Compare periods          | Yes        | WoW and MoM deltas for CPM, CTR, CPC, CPL, CPA, ROAS                      |
| Diagnose root cause      | Yes        | Pattern matching: creative fatigue, audience saturation, landing page     |
| Recommend actions        | Yes        | Scale / Kill / Refresh / Restructure / Hold with specific steps           |
| Create campaign draft    | Yes        | API write: campaign + ad set + ad in PAUSED status                        |
| Set budgets/bids         | Yes        | API write: budget and bid strategy on PAUSED campaigns                    |
| Upload creative assets   | Yes        | API write: images/videos to ad account media library                      |
| Dispatch conversions     | Yes        | CAPI: server-side conversion events for offline/cross-device attribution  |
| **Publish (set ACTIVE)** | **Human**  | Buyer clicks publish in Ads Manager or approves in dashboard. 10 seconds. |
| **Pause running ads**    | **Human**  | Agent recommends "kill," buyer pauses in Ads Manager                      |

### Why This Boundary Works

- Meta's fraud detection targets **automated activation** (bots turning ads on/off), not automated setup
- Draft campaigns (`status: PAUSED`) are invisible to users and cost nothing
- CAPI writes are explicitly designed for server-to-server — Meta expects this
- The human publish step maintains the "human in the loop" that Meta requires

### API Scope

Request OAuth scopes: `ads_read`, `ads_management`, `business_management`

The agent uses `ads_management` for draft creation and CAPI dispatch, but **never calls the endpoint to set `status: ACTIVE`** on any campaign, ad set, or ad. This is enforced in code (see Section 4.2).

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

### 3.2 Attribution: Connecting Ads to CRM

Two data sources feed the funnel:

**Above the fold (Meta-tracked):**

- Impressions, clicks, LPV — from Meta Insights API
- On-platform leads — from Meta Leads API (lead forms on Meta)
- Pixel-tracked conversions — from Meta Pixel on buyer's website

**Below the fold (Agent-tracked):**

- Off-platform leads — Contact records with `sourceAdId` / `sourceCampaignId`
- Qualified leads — Contact.stage progression via Sales Pipeline agent
- Closed deals — Opportunity.stage = "won"
- Revenue — LifecycleRevenueEvent.amount

The bridge: `Contact.sourceAdId` and `Contact.sourceCampaignId` are **real columns** on the Contact model. They get populated by:

1. **Widget fbclid capture:** Chat widget reads `fbclid` from URL params, stores on Contact
2. **Meta Leads API:** Agent ingests lead form submissions, creates Contact with sourceAdId
3. **CAPI backfill:** When a Contact converts, agent dispatches conversion event to CAPI with the original fbclid for Meta attribution

This gives **true ROAS** (closed revenue / ad spend), not Meta's reported ROAS (which counts pixel events, not actual revenue).

### 3.3 Period-Over-Period Comparison

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

### 3.4 Metric Diagnosis

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

### 3.5 Three Output Types

Every finding is classified into one of three types:

| Type               | When                                      | What it contains                                           |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------- |
| **Insight**        | Informational — no action needed          | "Your CPM dropped 12% this week. Seasonal pattern."        |
| **Watch**          | Concerning trend — monitor, don't act yet | "CTR declining 3 days in a row. If it continues, refresh." |
| **Recommendation** | Action needed — specific steps for buyer  | "Kill Campaign X — CPA 2.3x target for 10 days."           |

Only Recommendations have actionable steps. Insights and Watches build context for the buyer without creating decision fatigue.

### 3.6 Recommendation Engine

Based on diagnosis, produce ranked Recommendations:

| Action               | When                                           | What buyer does                             |
| -------------------- | ---------------------------------------------- | ------------------------------------------- |
| **Scale**            | Campaign has CPA below target + stable metrics | Approve draft with 20-30% higher budget     |
| **Kill**             | CPA > 2x target for 7+ days                    | Pause campaign in Ads Manager               |
| **Refresh Creative** | Frequency > 3, CTR declining                   | Approve new creative draft (PCD synergy)    |
| **Restructure**      | Audience saturation > 70% reach                | Approve new ad set draft with new targeting |
| **Hold**             | Seasonal pattern or in learning phase          | Wait — metrics will recover                 |
| **Test**             | Winning campaign, budget headroom              | Approve duplicate ad set draft              |

Each Recommendation includes:

- Confidence score (0-1)
- Estimated impact ("saving ~$X/week" or "potential +Y% ROAS")
- Specific steps (campaign name, ad set name, exact changes)
- Urgency (immediate / this week / next review cycle)
- **Learning phase check** — if the recommendation would disrupt learning, downgrade to Watch

---

## 4. Learning Phase Guardrails

Meta's learning phase requires **50 optimization events within 7 days** of any significant change. During learning, performance is volatile and CPAs are higher. Changes that reset learning:

- Budget changes > 20%
- Bid strategy changes
- Targeting changes
- Creative changes
- Pausing and resuming

### 4.1 Rules (Hardcoded)

1. **Never recommend changes to campaigns in learning phase** — these become Watch items: "Campaign X is in learning (Day 3/7, 28/50 events). Performance is volatile — this is normal. Monitoring."

2. **Never recommend changes to campaigns performing well** — even if they've been running unchanged for months. "If it ain't broke, don't fix it" is valid strategy. These become Insights: "Campaign X has maintained 2.1x ROAS for 6 weeks. No changes recommended."

3. **Batch changes** — if multiple changes are needed, recommend them together in one batch so learning resets once, not repeatedly.

4. **Budget change cap** — never recommend budget increases > 20% per change. Multiple small increases > one large one.

5. **Wait periods** — after any change, enforce minimum 7-day wait before next recommendation for that campaign.

### 4.2 Learning Phase Detection

From Meta Insights API, check `effective_status` field:

- `ACTIVE` + `learning_phase` = in learning
- `ACTIVE` + no `learning_phase` = stable

Also compute from data: if campaign was modified in last 7 days AND has < 50 optimization events since modification → treat as learning regardless of API status.

---

## 5. CAPI (Conversions API) Integration

The agent dispatches server-side conversion events to Meta for attribution. This is a **write** operation but is explicitly designed for server-to-server use.

### 5.1 Event Flow

```
Contact created (with fbclid from widget)
  → Agent creates Contact with sourceAdId
  → When Contact.stage changes to "qualified":
    → Dispatch "Lead" event to CAPI
  → When Opportunity.stage = "won":
    → Dispatch "Purchase" event to CAPI with revenue amount
```

### 5.2 Event Types

Use Meta's standard event types for compatibility:

| CRM Event              | CAPI Event Type | Data                          |
| ---------------------- | --------------- | ----------------------------- |
| Contact created (lead) | `Lead`          | fbclid, email (hashed)        |
| Contact qualified      | `Lead`          | fbclid, email, phone (hashed) |
| Opportunity won        | `Purchase`      | fbclid, value, currency       |

### 5.3 Widget fbclid Capture

The chat widget is served in an iframe (`/widget/:token/embed`), so it **cannot** read `window.parent.location` (cross-origin restriction). Instead, the parent page's embed snippet extracts `fbclid` and passes it via `postMessage`:

```
Parent page: example.com/landing?fbclid=abc123
  → Embed snippet reads fbclid from own URL params
  → Posts message to widget iframe: { type: "sw:init", fbclid: "abc123" }
  → Widget stores fbclid in visitor session
  → When Contact is created → sourceAdId = fbclid lookup → Contact.sourceCampaignId
```

This requires updating the widget embed snippet (the `<script>` tag buyers paste on their site) to include the `postMessage` call, and updating the widget iframe JS to listen for `"sw:init"` messages.

### 5.4 Meta Leads API Ingestion

For lead ads (forms on Meta platform), the agent subscribes to the Leads API webhook:

1. Meta sends lead data to our webhook endpoint
2. Agent creates Contact with form fields + sourceAdId from the lead ad
3. Feeds into Sales Pipeline for qualification
4. When qualified/closed → CAPI dispatch for attribution

---

## 6. Architecture

### 6.1 Module Structure

**Location:** `packages/core/src/ad-optimizer/`

```
packages/core/src/ad-optimizer/
  index.ts                    — barrel exports
  meta-ads-client.ts          — Meta Marketing API wrapper (read + draft writes)
  meta-capi-client.ts         — Conversions API dispatcher
  meta-leads-ingester.ts      — Leads API webhook handler
  funnel-analyzer.ts          — Funnel breakdown + leakage detection
  period-comparator.ts        — WoW/MoM delta computation
  metric-diagnostician.ts     — Pattern → root cause mapping
  recommendation-engine.ts    — Ranked actions with confidence + impact
  learning-phase-guard.ts     — Learning phase detection + change gating
  audit-runner.ts             — Orchestrator: pull → analyze → diagnose → recommend
  __tests__/
    funnel-analyzer.test.ts
    period-comparator.test.ts
    metric-diagnostician.test.ts
    recommendation-engine.test.ts
    learning-phase-guard.test.ts
    audit-runner.test.ts
```

### 6.2 Meta Ads Client

Wrapper around Meta Marketing API. Uses buyer's OAuth token (stored encrypted in `DeploymentConnection` credentials via Facebook OAuth integration).

```typescript
interface MetaAdsClient {
  // === READ OPERATIONS ===

  getCampaignInsights(params: {
    accountId: string;
    dateRange: { since: string; until: string };
    fields: string[];
    breakdowns?: string[];
  }): Promise<CampaignInsight[]>;

  getAdSetInsights(params: {
    accountId: string;
    campaignId?: string;
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<AdSetInsight[]>;

  getAccountSummary(accountId: string): Promise<AccountSummary>;

  // === DRAFT WRITE OPERATIONS ===
  // All create campaigns/ad sets/ads with status: PAUSED

  createDraftCampaign(params: {
    accountId: string;
    name: string;
    objective: string;
    budget: { daily: number } | { lifetime: number };
    bidStrategy: string;
  }): Promise<{ id: string }>; // Always status: PAUSED

  createDraftAdSet(params: {
    accountId: string;
    campaignId: string;
    name: string;
    targeting: object;
    optimization_goal: string;
  }): Promise<{ id: string }>; // Always status: PAUSED

  uploadCreativeAsset(params: {
    accountId: string;
    file: Buffer;
    type: "image" | "video";
  }): Promise<{ id: string; url: string }>;
}
```

**Publish guard (hardcoded, not configurable):**

```typescript
// In meta-ads-client.ts — this is the safety boundary
private async updateCampaignStatus(id: string, status: string) {
  if (status === "ACTIVE") {
    throw new Error("SAFETY: Agent cannot activate campaigns. Human must publish via Ads Manager.");
  }
  // ... allow PAUSED, DELETED, ARCHIVED
}
```

**Rate limiting:** Built into client — minimum 60 seconds between calls, max 1 call per endpoint per hour. Well under Meta's 200/hour/account limit.

**Error handling:** Meta API errors (rate limit, token expired, account restricted) produce clear error messages in the audit report, not silent failures.

### 6.3 CAPI Client

```typescript
interface MetaCAPIClient {
  dispatchEvent(params: {
    pixelId: string;
    accessToken: string;
    event: {
      eventName: "Lead" | "Purchase";
      eventTime: number;
      userData: {
        fbclid?: string;
        email?: string; // SHA-256 hashed
        phone?: string; // SHA-256 hashed
      };
      customData?: {
        value?: number;
        currency?: string;
      };
    };
  }): Promise<{ eventsReceived: number }>;
}
```

### 6.4 Funnel Analyzer

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

CRM data comes from existing models:

- `Contact` — leads (filtered by `sourceAdId` or `sourceCampaignId`)
- `Opportunity` — qualified + closed deals
- `LifecycleRevenueEvent` — revenue attribution

### 6.5 Learning Phase Guard

```typescript
interface LearningPhaseStatus {
  campaignId: string;
  inLearning: boolean;
  daysSinceChange: number;
  eventsAccumulated: number;
  eventsRequired: number; // 50
  estimatedExitDate: Date | null;
}

interface LearningPhaseGuard {
  // Check if a campaign is in learning phase
  check(campaignId: string, insights: CampaignInsight): LearningPhaseStatus;

  // Gate a recommendation — returns Watch if in learning, passes through if not
  gate(recommendation: Recommendation, status: LearningPhaseStatus): Recommendation | Watch;

  // Check if campaign is performing well (don't touch)
  isPerformingWell(
    campaignId: string,
    insights: CampaignInsight[],
    targetCPA: number,
    targetROAS: number,
  ): boolean;
}
```

### 6.6 Period Comparator

```typescript
interface PeriodMetrics {
  period: "current_week" | "previous_week" | "current_month" | "previous_month";
  metrics: Record<string, number>;
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

### 6.7 Audit Runner

Orchestrates the full audit pipeline:

```
1. Pull current + previous period data from Meta Ads API
2. Pull CRM data for attribution (Contact + Opportunity by sourceAdId)
3. Ingest latest leads from Meta Leads API
4. Compute funnel breakdown
5. Compute period deltas
6. Check learning phase status for each campaign
7. Run metric diagnosis
8. Generate classified outputs (Insight / Watch / Recommendation)
9. Apply learning phase guard (downgrade Recommendations to Watches if needed)
10. Assemble audit report
11. Create AgentTask with structured output
12. Dispatch CAPI events for any new conversions
```

The audit runner is triggered:

- **Scheduled:** Weekly (Monday morning) via Inngest cron
- **On-demand:** Buyer clicks "Run Audit" in the My Agent dashboard
- **Alert mode:** Daily lightweight check (account summary only, flag threshold breaches)

### 6.8 Output Format (AgentTask)

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
    campaignsInLearning: number;
  };
  funnel: FunnelAnalysis;
  periodDeltas: MetricDelta[];
  insights: Array<{
    campaignId: string;
    campaignName: string;
    message: string;
    category: string;
  }>;
  watches: Array<{
    campaignId: string;
    campaignName: string;
    pattern: string;
    message: string;
    checkBackDate: string; // when to re-evaluate
  }>;
  recommendations: Array<{
    action: "scale" | "kill" | "refresh_creative" | "restructure" | "hold" | "test";
    campaignId: string;
    campaignName: string;
    confidence: number;
    urgency: "immediate" | "this_week" | "next_cycle";
    estimatedImpact: string;
    steps: string[];
    learningPhaseImpact: string; // "will reset learning" or "no impact"
    draftId?: string; // if a PAUSED draft was auto-created
  }>;
}
```

---

## 7. Memory System Integration

The compounding loop extracts patterns across audits into deployment memory:

### 7.1 Signals the Agent Learns

| Signal                            | Memory Category | Example                                                      |
| --------------------------------- | --------------- | ------------------------------------------------------------ |
| Campaign type performance         | `pattern`       | "Lookalike audiences decay after 3 weeks for this business"  |
| Seasonal CPM patterns             | `pattern`       | "CPM spikes every December for this account"                 |
| Creative lifespan                 | `pattern`       | "Video creatives last 18 days avg before fatigue"            |
| Best-performing audience segments | `pattern`       | "25-34 female, metro areas consistently 2x ROAS"             |
| Buyer response patterns           | `preference`    | "Buyer always approves scale recommendations, ignores kill"  |
| Recommendation accuracy           | `fact`          | "Scale recommendations have 80% success rate for this buyer" |

### 7.2 How Memory Improves Diagnoses

- **Pattern memory** informs diagnosis confidence: "CTR dropped, but this business's creatives typically last 14 days and it's been 12 — likely fatigue (high confidence based on history)"
- **Preference memory** adjusts recommendation presentation: "Buyer prefers conservative changes — recommend 15% budget increase instead of 25%"
- **Accuracy memory** calibrates future confidence scores: "Past scale recommendations worked 4/5 times → boost confidence for similar recommendations"

### 7.3 Feedback Loop

1. Agent produces Recommendation
2. Buyer approves → trust score +3 → memory records "recommendation type X accepted"
3. Next audit checks outcome: did the change improve metrics?
4. If yes → memory confidence boost. If no → memory records failure pattern.
5. Future recommendations factor in this learning.

---

## 8. Synergies

### 8.1 PCD (Performance Creative Director)

When diagnosis is "creative fatigue":

- Recommendation includes "Trigger PCD for fresh creative"
- If PCD is deployed in same org, auto-creates a `CreativeJob` task with:
  - `pastPerformance` pre-filled from the failing campaign's metrics
  - `targetAudience` from the campaign's targeting
  - `platforms: ["meta"]`
- PCD produces creative → agent uploads to ad account media library → creates draft ad in PAUSED → buyer approves

### 8.2 Sales Pipeline

Attribution report joins:

- `Contact.sourceAdId` → which ad brought this lead
- `Opportunity.stage` → did the lead close
- `LifecycleRevenueEvent.amount` → how much revenue

This gives **true ROAS** (closed revenue / ad spend), not Meta's reported ROAS.

### 8.3 Customer Experience (Chat Widget)

- Widget captures `fbclid` from landing page URL params
- Stores on visitor session, carries through to Contact creation
- Enables end-to-end attribution: ad click → chat → lead → sale → revenue

---

## 9. Authentication: Facebook OAuth

The agent uses Facebook OAuth (not manual access tokens). During onboarding:

1. Buyer clicks "Connect Facebook Ads" button
2. Facebook OAuth flow requests scopes: `ads_read`, `ads_management`, `business_management`
3. Buyer selects which ad account(s) to grant access to
4. OAuth tokens stored encrypted in `DeploymentConnection` (credential _storage_ pattern exists; the OAuth exchange, callback, and refresh logic are **new** — no OAuth flow exists in the codebase today)
5. Agent uses long-lived user token (60-day expiry, auto-refreshed)

### 9.0 Implementation Note

This is the first OAuth integration in Switchboard. Required new components:

- **OAuth route** (`apps/api/src/routes/oauth/facebook.ts`): authorization URL generator + callback handler
- **Token exchange**: short-lived → long-lived via `GET /oauth/access_token`
- **Account selector**: after OAuth, query `GET /me/adaccounts` and let buyer pick
- **Token refresh job**: Inngest cron or middleware check before API calls
- **Connection status management**: mark `inactive` on revocation, surface re-auth prompt

### 9.1 Token Refresh

Meta's user access tokens expire after 60 days. The agent:

1. Exchanges short-lived token for long-lived on initial OAuth
2. Stores expiry timestamp in connection metadata
3. On each API call, checks expiry — if < 7 days remaining, auto-refreshes
4. If refresh fails (user revoked access), marks connection as `inactive` and alerts buyer

---

## 10. Schema Changes

### 10.1 Contact Attribution (No Schema Migration Needed)

Contact already has an `attribution Json?` field storing `AttributionChainSchema` (defined in `packages/schemas/src/lifecycle.ts`), which includes `fbclid`, `sourceAdId`, `sourceCampaignId`, `utmSource`, `utmMedium`, `utmCampaign`. The existing message pipeline already writes `sourceAdId`/`sourceCampaignId` into this field.

**No new columns needed.** The funnel analyzer queries `Contact.attribution` JSON for ad attribution data. `LifecycleRevenueEvent` also has real `sourceAdId` and `sourceCampaignId` columns for revenue-level attribution.

The widget fbclid capture (Section 5.3) writes `fbclid` into the same `attribution` JSON field on Contact creation.

### 10.2 Ad Optimizer Schemas (Zod)

Add to `packages/schemas/src/ad-optimizer.ts`:

- `CampaignInsightSchema`
- `AdSetInsightSchema`
- `AccountSummarySchema`
- `FunnelAnalysisSchema`
- `MetricDeltaSchema`
- `LearningPhaseStatusSchema`
- `AuditReportSchema`
- `CAPIEventSchema`

---

## 11. Setup Schema

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
        { key: "pixelId", type: "text", label: "Meta Pixel ID (for CAPI)", required: false, hint: "Found in Events Manager → Data Sources" },
      ],
    },
  ],
}
```

Meta Ads credentials come through the Facebook OAuth integration during onboarding — the credential storage in `DeploymentConnection` already exists.

---

## 12. Trust-Gated Capabilities

| Trust Level       | Capabilities                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| Supervised (0-29) | Weekly audit report + insights only. No draft creation. No CAPI.                 |
| Guided (30-54)    | Weekly audit + daily alerts + CAPI dispatch + draft campaign creation (PAUSED)   |
| Autonomous (55+)  | Full analysis + proactive recommendations + PCD synergy + auto-draft all changes |

**Trust unlocks automation depth, never publish access.** The agent can never set `status: ACTIVE`. That's the human's job, always.

The buyer approves or dismisses each recommendation via the dashboard. Approvals feed into trust score. Over time, the agent's recommendations become higher confidence because the memory system learns what works for this specific business.

---

## 13. Dashboard UX (My Agent page additions)

For agents with `family: "paid_media"` and Ad Optimizer type, the My Agent page shows:

**Audit Summary Card:**

- Last audit date, overall ROAS, total spend, total leads
- Health indicator (green/yellow/red based on target CPA/ROAS)
- Campaigns in learning phase (count + names)

**Output Feed (Insight / Watch / Recommendation):**

- Insights: informational cards, no action buttons
- Watches: amber cards with "Check back on [date]"
- Recommendations: actionable cards with urgency badges
  - Each card: problem description, diagnosis, specific steps, learning phase impact
  - Buttons: `[Approve & Publish]` (buyer goes to Ads Manager) / `[Dismiss]`
  - If draft exists: link to the PAUSED campaign in Ads Manager

**Trend Charts:**

- CPM, CTR, CPA, ROAS over time (WoW view)
- Funnel visualization with leakage highlighting
- Learning phase timeline per campaign

---

## 14. Scheduling (Inngest)

> **Note:** This is the first cron-triggered Inngest function in Switchboard. Existing PCD pipeline is event-driven only. These functions live in `packages/core/src/ad-optimizer/inngest-functions.ts` and are registered in `apps/api/src/bootstrap/inngest.ts` alongside the creative pipeline functions.

```typescript
// Weekly audit cron
inngest.createFunction(
  { id: "ad-optimizer-weekly-audit", name: "Ad Optimizer Weekly Audit" },
  { cron: "0 9 * * 1" }, // Monday 9 AM
  async ({ event, step }) => {
    const deployments = await step.run("list-deployments", () =>
      listActiveDeployments({ agentType: "ad-optimizer" }),
    );
    for (const deployment of deployments) {
      await step.run(`audit-${deployment.id}`, () => runAudit(deployment));
    }
  },
);

// Daily anomaly check
inngest.createFunction(
  { id: "ad-optimizer-daily-check", name: "Ad Optimizer Daily Check" },
  { cron: "0 8 * * *" }, // Daily 8 AM
  async ({ event, step }) => {
    // Lightweight: account summary only, flag threshold breaches
  },
);
```

---

## 15. What We Don't Build

- **Publish via API** — permanently human-only. The agent can never set `status: ACTIVE`.
- **Google Ads / TikTok connectors** — v2, after Meta is solid.
- **Custom attribution models** — last-click only for v1.
- **Lookalike audience management** — out of scope.
- **Creative A/B testing orchestration** — PCD produces creative, agent creates drafts, buyer manages in Ads Manager.
- **Automated scheduling** — buyer controls when campaigns run.
- **Auto-pause running campaigns** — recommendations say "kill," buyer pauses.

---

## 16. Build Order

| Phase | What                                                                                       | New Files                                                                                               |
| ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1     | Zod schemas (CampaignInsight, FunnelAnalysis, AuditReport, LearningPhaseStatus, CAPIEvent) | `packages/schemas/src/ad-optimizer.ts`                                                                  |
| 2     | Meta Ads Client (read + draft writes, publish guard, rate limiting)                        | `packages/core/src/ad-optimizer/meta-ads-client.ts`                                                     |
| 3     | Meta CAPI Client (conversion dispatch)                                                     | `packages/core/src/ad-optimizer/meta-capi-client.ts`                                                    |
| 4     | Funnel Analyzer + Period Comparator (pure computation, no API)                             | `funnel-analyzer.ts`, `period-comparator.ts`                                                            |
| 5     | Learning Phase Guard (detection + change gating)                                           | `learning-phase-guard.ts`                                                                               |
| 6     | Metric Diagnostician + Recommendation Engine (with 3 output types)                         | `metric-diagnostician.ts`, `recommendation-engine.ts`                                                   |
| 7     | Audit Runner (orchestrator) + AgentTask output                                             | `audit-runner.ts`                                                                                       |
| 8     | Meta Leads API ingestion + widget fbclid capture (postMessage)                             | `meta-leads-ingester.ts`, widget embed changes                                                          |
| 9     | Inngest cron functions (weekly audit + daily check)                                        | `packages/core/src/ad-optimizer/inngest-functions.ts` + register in `apps/api/src/bootstrap/inngest.ts` |
| 10    | Facebook OAuth integration + token refresh (first OAuth flow in codebase)                  | `apps/api/src/routes/oauth/facebook.ts` + connection handler                                            |
| 11    | Marketplace listing seed data                                                              | Seed data                                                                                               |
| 12    | Dashboard: audit summary card, output feed, trend charts                                   | Dashboard components                                                                                    |

> **Dependency note:** Phase 10 (OAuth) is required for live API calls in phases 2-3, but those phases can be built and tested against mocked tokens. Phase 10 should be completed before integration testing.
