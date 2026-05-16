# Ad Optimizer vs Meta Ads MCP — Strategic Analysis & Gap Plan

## Strategic Position (verified 2026-05-04)

Meta's Ads AI Connectors (MCP at mcp.facebook.com/ads) is a conversational data pipe — entity CRUD, performance reads, catalog management. Ad-optimizer is the automated intelligence layer: scheduled diagnostics, recommendation engine, governance guardrails, CRM-to-ads attribution. Meta explicitly endorses this split: "MAPI remains essential for automated infrastructure."

**Why:** Meta's "better together" narrative leaves the intelligence layer to 3P tools. Ad-optimizer owns the opinionated brain; MCP owns the data pipe. No need to migrate transport from MAPI to MCP.

**How to apply:** Keep MAPI as transport. Don't compete on CRUD. Position ad-optimizer as the intelligence layer MCP left empty. Fill 3 capability gaps and expose existing intelligence via Switchboard's MCP server.

## Verified Capabilities (all confirmed against codebase 2026-05-04)

| Capability                           | Key File(s)                                                                                                                                                                                                                                 | Detail                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9 diagnostic patterns                | `packages/ad-optimizer/src/metric-diagnostician.ts`                                                                                                                                                                                         | RULES array: creative_fatigue, competition_increase, landing_page_drop, lead_quality_issue, audience_saturation, audience_offer_mismatch, lead_quality_degradation, ctwa_drive_by_clickers, account_level_issue           |
| 13-action recommendation engine      | `recommendation-engine.ts` (generates 10), `audit-runner.ts` (generates 3 via V2 guard), `recommendation-sink.ts` (presents all 13)                                                                                                         | Actions: scale, pause, refresh_creative, restructure, hold, test, review_budget, add_creative, expand_targeting, consolidate, shift_budget_to_source, switch_optimization_event, harden_capi_attribution                  |
| Funnel analysis (3 shapes)           | `funnel-analyzer.ts`, `funnel-detector.ts`                                                                                                                                                                                                  | website (6 stages), instant_form (5 stages), whatsapp (6 stages with Conversations Started / First Reply)                                                                                                                 |
| Period comparison                    | `period-comparator.ts`                                                                                                                                                                                                                      | 7 metrics (cpm, ctr, cpc, cpl, cpa, roas, frequency), 15% significance threshold, 1% stable threshold                                                                                                                     |
| Trend projection + breach prediction | `trend-engine.ts`                                                                                                                                                                                                                           | `detectTrends()` counts consecutive same-direction weeks → tier (stable/alert/confirmed). `projectBreach()` linear extrapolation from last 2 points, returns weeks until breach.                                          |
| Learning phase guard V1 + V2         | `learning-phase-guard.ts`                                                                                                                                                                                                                   | V1: binary (learningPhase OR <7 days + <50 events), gates ALL recs. V2: 4-state (learning/learning_limited/success/unknown), only gates destructive actions (pause/restructure). V2 has `diagnoseLearningLimited()`.      |
| CAPI dispatch                        | `outcome-dispatcher.ts` (deterministic event_id via SHA-256 of contactId+kind+bookingId+occurredAt joined by \x1F), `meta-capi-client.ts` + `meta-capi-dispatcher.ts` (PII hashing: SHA-256 on email lowercase trimmed + phone digits only) | 7-day staleness guard in dispatcher                                                                                                                                                                                       |
| Lead ingestion                       | `lead-intake/ctwa-adapter.ts` (93 lines), `lead-intake/instant-form-adapter.ts` (111 lines)                                                                                                                                                 | Both submit via `PlatformIngress.submit()` with `intent: "lead.intake"`. Legacy `meta-leads-ingester.ts` for raw webhook parsing.                                                                                         |
| Source comparison (trueROAS)         | `analyzers/source-comparator.ts`                                                                                                                                                                                                            | `compareSources()` computes per-source cpl, costPerQualified, costPerBooked, closeRate, trueRoas. `findShiftCandidates()` in recommendation-engine triggers shift_budget_to_source when best source trueRoas >= 2x worst. |
| Budget analysis                      | `budget-analyzer.ts`                                                                                                                                                                                                                        | `analyzeBudgetDistribution()` detects overspending_underperformer and underspending_winner. Advisory only — recommends, does not auto-execute.                                                                            |
| Inngest crons                        | `inngest-functions.ts` (in BOTH `packages/ad-optimizer/src/` and `packages/core/src/ad-optimizer/`)                                                                                                                                         | Weekly audit: `0 9 * * 1` (Mon 9am). Daily check: `0 8 * * *`. Also thin dispatchers at `0 6 * * 1` and `0 8 * * *` that fan out per-deployment events.                                                                   |
| Governance hard block                | `meta-ads-client.ts` `updateCampaignStatus()`                                                                                                                                                                                               | `throw new Error("SAFETY: Agent cannot activate campaigns.")` on `status === "ACTIVE"`. Can pause/delete/archive.                                                                                                         |
| CRM funnel + benchmarks              | `crm-data-provider/real-provider.ts`                                                                                                                                                                                                        | `RealCrmDataProvider` aggregates per-source funnel projections (received→qualified→booked→showed→paid→revenue). `getBenchmarks()` queries historical means.                                                               |
| Spend attribution                    | `analyzers/spend-attributor.ts`                                                                                                                                                                                                             | Attributes spend by source via destination_type matching + lead-share fallback                                                                                                                                            |

## Capability Overlap Analysis

### What overlaps (~20% — paralleled, not replaced)

| Ad-Optimizer Capability             | Meta MCP Equivalent                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| MetaAdsClient — raw Graph API calls | ads_get_ad_entities (52 fields), ads_create_campaign/ad_set/ad, ads_update_entity |
| OAuth flow (facebook-oauth.ts)      | OAuth via mcp.facebook.com/ads                                                    |
| Campaign status updates             | ads_activate_entity, ads_pause_entity                                             |
| Draft creation as PAUSED            | MCP also creates PAUSED by default                                                |

### What MCP does NOT provide (~80% — the value layer)

| Ad-Optimizer Capability                                             | MCP Equivalent                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 9 diagnostic patterns (creative fatigue, audience saturation, etc.) | None — MCP returns raw data only                                       |
| 13-action recommendation engine with CPA thresholds                 | None                                                                   |
| Funnel analysis (6-stage, 3 funnel shapes)                          | None                                                                   |
| Period comparison + trend projection + breach prediction            | None                                                                   |
| Learning phase guard (V1 + V2 state machine)                        | None                                                                   |
| CAPI dispatch with deterministic event_id + PII hashing             | Partial (ads_signals_event_parameter is codeless config, not dispatch) |
| Lead ingestion (CTWA adapter, Instant Form adapter)                 | None                                                                   |
| Source comparison (CTWA vs Instant Form trueROAS)                   | None                                                                   |
| Budget rebalancing across sources                                   | None                                                                   |
| Weekly audit cron + daily health check via Inngest                  | None                                                                   |
| Governance safety guard (hard block on activation)                  | MCP allows activation — ad-optimizer is stricter                       |
| CRM funnel integration + conversion benchmarks                      | None                                                                   |

### What MCP has that ad-optimizer lacks (gaps to fill)

| MCP Capability                                                             | Ad-Optimizer Gap                            |
| -------------------------------------------------------------------------- | ------------------------------------------- |
| Catalog management — create catalogs, add product data, troubleshoot feeds | Zero catalog support                        |
| Signal health/quality (read-only) — pixel health, event quality insights   | CoverageValidator is basic; MCP's is richer |
| Help Center search — Meta Business Help Center articles                    | Not present                                 |

## Current MCP Server Tools (15 manual + auto-registered)

**Read tools** (`apps/mcp-server/src/tools/read.ts`): get_campaign, search_campaigns, simulate_action, get_approval_status, list_pending_approvals, get_action_status, get_session_status

**Side-effect tools** (`side-effect.ts`): pause_campaign, resume_campaign, adjust_budget, modify_targeting

**Governance tools** (`governance.ts`): request_undo, emergency_halt, get_audit_trail, get_governance_status

**Auto-register** (`auto-register.ts`): generates MCP tools from CartridgeRegistry manifest actions for any actionType not covered by manual side-effect tools. Derives destructiveHint from baseRiskCategory.

**Key gap:** ZERO ad-optimizer intelligence exposed. No diagnostics, recommendations, funnel, or trend tools.

## Ad-Optimizer Schemas Already in packages/schemas/

- `ad-optimizer-shared.ts`: FunnelShapeSchema, LearningStateSchema, LearningPhaseStatusSchema
- `ad-optimizer.ts`: OutputTypeSchema, AdRecommendationActionSchema (13 values), UrgencySchema, CampaignInsightSchema, AdSetInsightSchema, AccountSummarySchema, FunnelStageSchema, FunnelAnalysisSchema, MetricDeltaSchema, CAPIEventSchema, InsightOutputSchema, WatchOutputSchema, RecommendationOutputSchema, AuditReportSchema
- `ad-optimizer-v2.ts`: MetricSnapshotSchema, TrendTierSchema, WeeklySnapshotSchema, MetricTrendSchema, TrendAnalysisSchema, CampaignBudgetEntrySchema, BudgetImbalanceSchema, BudgetAnalysisSchema, CreativeEntrySchema, CreativeDiagnosisSchema, CreativeAnalysisSchema, AdSetDetailSchema, SaturationSignalSchema

All re-exported from `packages/schemas/src/index.ts`.

## OAuth Scopes (CORRECTED)

File: `packages/core/src/ad-optimizer/facebook-oauth.ts` (NOT `packages/ad-optimizer/`)
SCOPES (line 5, comma-separated string): `ads_read,ads_management,business_management,pages_manage_metadata,leads_retrieval`
Gap 1 requires adding `catalog_management` to this string.

## MCP 3P Developer Access (as of 2026-05-04)

| Integration Method                               | Description                                                         | Status                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Method A** (consumer)                          | Advertiser connects via Claude Web/ChatGPT with Meta's 2P App ID    | **Live** — open beta                                          |
| **Method B** (developer, own app + MCP OAuth)    | Developer registers 3P app, authenticates via MCP OAuth             | **NOT YET AVAILABLE** — gated behind `ads_mcp_server_3p_capa` |
| **Method C** (developer, own app + access token) | Developer uses 3P app with user access token + required permissions | **NOT YET AVAILABLE** — gated behind `ads_mcp_server_3p_capa` |

- **Testing access:** Available via test app ID `1306742011503771` (contact: Li Li, AXP team)
- **3P tools available today:** Only 4 of ~20+ tools: `get_ad_accounts`, `get_opportunity_score`, `get_errors_tool`, `get_help_article`
- **Open beta plan:** Remove `ads_mcp_server_3p_capa` capability gate. No confirmed date — FAQ says "mid-to-late May 2026".
- **Rate limits:** 500 hits/min/user at server level, plus tool-level limits.

## Open Questions

1. When will Methods B/C actually open? Monitor the `ads_mcp_server_3p_capa` capability gate status weekly.
2. Is server-to-browser ratio + dedup rate sufficient as EMQ proxy, or pursue 3P MCP access for real composite score?
3. Catalog health checker: per-business or per-ad-account? Some clients share catalogs across accounts.
4. Does `ads_read` OAuth scope cover `/{pixel_id}/stats` and da_checks, or is `ads_management` needed?
