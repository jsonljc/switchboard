# Switchboard Agent Ecosystem — Design Spec

**Date:** 2026-04-12
**Status:** Draft
**Goal:** Define 4 agent families (9 agents total) with silo-first standalone value and opt-in synergy bridges when multiple agents are deployed together.

---

## 1. The Problem

Switchboard has a Sales Pipeline family (Speed-to-Lead, Sales Closer, Nurture Specialist) and a Performance Creative Director. But SMBs need more than sales — they need to attract leads (organic + paid), convert them (sales), retain them (reviews), and grow (content + SEO).

A marketplace with 5 agents is a feature. A multi-agent ecosystem where deploying more agents creates compound value is a platform.

---

## 2. Current State

### Fully Built Agents (5)

| #   | Agent                         | Location                               | Type                | Family         |
| --- | ----------------------------- | -------------------------------------- | ------------------- | -------------- |
| 1   | Speed-to-Lead                 | `packages/core/src/sales-pipeline/`    | Customer-facing     | Sales Pipeline |
| 2   | Sales Closer                  | `packages/core/src/sales-pipeline/`    | Customer-facing     | Sales Pipeline |
| 3   | Nurture Specialist            | `packages/core/src/sales-pipeline/`    | Customer-facing     | Sales Pipeline |
| 4   | Sales Pipeline Bundle         | Orchestration wiring                   | Bundle              | Sales Pipeline |
| 5   | Performance Creative Director | `packages/core/src/creative-pipeline/` | Internal (5 stages) | Paid Media     |

### Architecture Pattern

Agents are **native modules** in `packages/core/src/{agent-name}/`. No cartridge system — cartridges were deprecated and removed. Each agent module contains:

```
packages/core/src/{agent-name}/
  index.ts           — barrel exports
  role-prompts.ts    — system prompts with template interpolation
  {name}.ts          — core logic (orchestrator, pipeline, etc.)
  __tests__/         — co-located tests
```

Agents are registered as `AgentListing` records in the marketplace with `type: "switchboard_native"`. Business context comes from `AgentPersona` + `ScannedBusinessProfile` (from the website scanner built in SP2).

### Shared Data Models

| Model                | Purpose                                                | Used By        |
| -------------------- | ------------------------------------------------------ | -------------- |
| `Contact`            | Lead/customer record with attribution                  | Sales Pipeline |
| `Opportunity`        | Sales lifecycle (interested → won/lost)                | Sales Pipeline |
| `ConversationThread` | Per-contact conversation state                         | Sales Pipeline |
| `AgentTask`          | Universal work output + review flow                    | All agents     |
| `CreativeJob`        | Multi-stage creative pipeline state                    | PCD            |
| `AttributionChain`   | Ad campaign → lead tracking (fbclid, gclid, utmSource) | Contact model  |
| `TrustScoreRecord`   | Per-listing marketplace reputation                     | All agents     |

---

## 3. New Agents (4)

### 3.1 The Funnel

```
ATTRACT (Top of Funnel)
  ├── Community Manager ─── organic social ──── utm_source
  ├── SEO Specialist ────── organic search ──── utm_source
  └── Ad Optimizer ──────── paid media ─────── sourceAdId
        ▲
        │ creative assets
        PCD

CONVERT (Sales Pipeline — exists)
  ├── Speed-to-Lead ── qualify
  ├── Sales Closer ──── close
  └── Nurture ────────── re-engage

RETAIN & GROW
  └── Review & Reputation Manager ── solicit, respond, monitor
```

### 3.2 Agent Summaries

| #   | Agent                           | Family              | Type     | Complexity  | External APIs                          |
| --- | ------------------------------- | ------------------- | -------- | ----------- | -------------------------------------- |
| 6   | **Ad Optimizer**                | Paid Media          | Internal | Medium      | None for v1 (LLM recommendations)      |
| 7   | **Review & Reputation Manager** | Customer Experience | Internal | Low-Medium  | None for v1 (LLM drafts)               |
| 8   | **Community Manager**           | Organic Growth      | Internal | Medium-High | Meta Pages API (v2)                    |
| 9   | **SEO Specialist**              | Organic Growth      | Internal | High        | Google Search Console, DataForSEO (v2) |

**Tier 1 (LLM-native, no external APIs):** Agents 6 and 7 are deliverable-producing agents like PCD — they take business context as input and produce strategic recommendations, drafts, and plans via LLM. Ship fast.

**Tier 2 (needs API integrations):** Agents 8 and 9 need real API connectors to publish posts or fetch SEO data. V1 can be LLM-only (generate content plans, drafts, audits). V2 adds live API integrations.

### 3.3 Agent Details

#### Ad Optimizer

**Revenue motion:** More conversions per dollar spent.

**Module:** `packages/core/src/ad-optimizer/`

**Inputs:** Business profile, PCD creative output (if deployed), monthly budget, target CPA/ROAS, connected ad account info.

**Outputs (via AgentTask):**

- Campaign structure recommendations (how to organize campaigns, ad sets, targeting)
- Budget allocation plan (how to split budget across campaigns)
- Creative testing plan (which PCD assets to A/B test, what to kill)
- Performance analysis (what's working, what's not, what to change)
- CAPI setup recommendations (conversion event mapping)

**Setup schema:** Monthly budget, target CPA, ad platforms (Meta, Google, TikTok), business goals.

**Synergy with PCD:** When both deployed, Ad Optimizer can read PCD's `CreativeJob` outputs to recommend which creatives to deploy. PCD's `pastPerformance` input can be populated from Ad Optimizer's analysis.

#### Review & Reputation Manager

**Revenue motion:** More reviews = more trust = more leads.

**Module:** `packages/core/src/review-manager/`

**Inputs:** Business profile, won deals (from Contact/Opportunity if Sales deployed), review platform preferences.

**Outputs (via AgentTask):**

- Review response drafts (positive: thank + reinforce, negative: empathize + resolve)
- Review solicitation messages (personalized ask for happy customers)
- Reputation summary report (score trends, sentiment breakdown, actionable insights)

**Setup schema:** Review platforms (Google, Facebook, Yelp), response tone, solicitation timing (days after purchase).

**Synergy with Sales:** When both deployed, `Opportunity.stage = "won"` can trigger review solicitation via the ConversionBus (`deal.won` event).

#### Community Manager

**Revenue motion:** Consistent social presence = top-of-mind = inbound leads.

**Module:** `packages/core/src/community-manager/`

**V1 (LLM-only) inputs:** Business profile, brand voice, content themes, posting frequency.

**V1 outputs (via AgentTask):**

- Weekly content calendar (topics, formats, timing)
- Post drafts per platform (Meta, Instagram) with brand voice
- Engagement response templates (how to reply to common comments/DMs)
- Hashtag and content strategy recommendations

**V2 addition:** Meta Pages API integration for actual publishing + analytics.

**Setup schema:** Social platforms, posting frequency, brand voice, content themes, UTM prefix.

#### SEO Specialist

**Revenue motion:** Free organic traffic. Every optimized page is a permanent lead magnet.

**Module:** `packages/core/src/seo-specialist/`

**V1 (LLM-only) inputs:** Website URL (uses website scanner), business profile, target keywords.

**V1 outputs (via AgentTask):**

- Keyword research report (terms, search volume estimates, difficulty, intent)
- Content briefs (topic, target keyword, outline, competitor analysis)
- On-page SEO audit (meta tags, headings, content gaps, internal linking)
- Priority recommendations (quick wins vs long-term plays)

**V2 addition:** Google Search Console + DataForSEO integration for real ranking data + content optimization scoring.

**Setup schema:** Website URL, target keywords, business location (for local SEO), content goals.

---

## 4. Silo-First, Synergy-Opt-In

### 4.1 Standalone Operation

Each agent works with just `AgentPersona` + `ScannedBusinessProfile`:

- **Ad Optimizer:** business profile + budget → campaign recommendations
- **Review Manager:** business profile → review response drafts
- **Community Manager:** business profile + brand voice → content calendar + post drafts
- **SEO Specialist:** website URL + business profile → keyword research + content briefs

No agent requires any other agent to function.

### 4.2 Synergy Bridges

Bridges activate **automatically** when multiple agents are deployed in the same org:

| Bridge                  | Agents Required        | Data Flow                                  | How                                                                |
| ----------------------- | ---------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| **Creative → Campaign** | PCD + Ad Optimizer     | PCD outputs → Ad Optimizer reads           | Ad Optimizer queries `CreativeJob` by org                          |
| **Campaign → Creative** | Ad Optimizer + PCD     | Performance data → PCD's `pastPerformance` | Ad Optimizer writes perf summary, PCD reads on next brief          |
| **Won Deal → Review**   | Sales + Review Manager | `Opportunity.won` → solicitation trigger   | ConversionBus event: `deal.won`                                    |
| **Organic Attribution** | Community/SEO + Sales  | UTM-tagged links → `Contact.utmSource`     | Content agents generate UTM links, Sales captures on lead creation |
| **Ad Attribution**      | Ad Optimizer + Sales   | `Contact.sourceAdId` from click tracking   | Already exists in Contact model                                    |

### 4.3 Bridge Implementation

**No new infrastructure.** All bridges use existing patterns:

- **Query-based:** Agent A queries existing models (CreativeJob, Contact, Opportunity) filtered by `organizationId`. No new tables.
- **Event-based:** ConversionBus already exists. Add new event types (`deal.won`, `creative.approved`). Each is a one-line type extension + one-line subscriber registration.
- **Attribution:** Contact.attribution fields already exist (`sourceAdId`, `utmSource`, `utmCampaign`). Just populate them.

Bridges are built **incrementally** — when Agent N is built, add the bridges it needs. Not upfront.

---

## 5. Schema Changes

### 5.1 AgentListing — Add `family` field

```typescript
// packages/schemas/src/marketplace.ts
export const AgentFamily = z.enum([
  "sales_pipeline",
  "paid_media",
  "organic_growth",
  "customer_experience",
]);
```

Add to `AgentListingSchema`:

```typescript
family: AgentFamily.optional(),
```

This enables marketplace filtering by family ("Show me all Sales agents") and automatic bridge detection ("these two agents are in the same org — check for bridges").

### 5.2 Seed Data — Add setupSchema to all listings

All 7 existing listings need `metadata.setupSchema` populated with proper `OnboardingConfigSchema` + `SetupStepSchema` arrays. This is a prerequisite for the buyer experience flow (SP1-SP6) to work end-to-end.

---

## 6. Build Order

| Phase | Agent                                                       | Effort   | Why First                                                                 |
| ----- | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| **0** | Wire setupSchema into existing listings + add `family` enum | 1 day    | Prerequisite — unblocks buyer experience for existing agents              |
| **1** | Ad Optimizer                                                | 3-4 days | Builds on PCD (existing). Closes paid media family. No external APIs.     |
| **2** | Review & Reputation Manager                                 | 2-3 days | Simplest new agent. Validates synergy bridge pattern (deal.won → review). |
| **3** | Community Manager (v1)                                      | 3-4 days | LLM-only content generation. No API integrations in v1.                   |
| **4** | SEO Specialist (v1)                                         | 4-5 days | Most complex. Uses website scanner. LLM-only in v1.                       |

Each agent gets its own spec → plan → implementation cycle.

---

## 7. What We Don't Build

- **Cartridges** — deprecated pattern. Agents use native modules in `packages/core/`.
- **External API integrations (v1)** — Community Manager and SEO Specialist ship as LLM-only deliverable producers. API integrations (Meta Pages, Google Search Console, DataForSEO) are v2.
- **Cross-agent orchestration** — no "meta-agent" that coordinates between families. Each family runs independently. Synergy is passive (shared data), not active (agent-to-agent communication).
- **Upfront bridge infrastructure** — bridges built incrementally with each agent, not as a separate infrastructure project.
