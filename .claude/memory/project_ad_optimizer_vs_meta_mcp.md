---
name: Ad Optimizer vs Meta Ads MCP — strategic positioning and gap plan
description: Analysis of how ad-optimizer complements (not competes with) Meta's Ads MCP Server. 80% unique value, 3 gaps to fill, 6 intelligence tools to expose via Switchboard MCP server. Verified 2026-05-04 with detailed implementation plan.
type: project
originSessionId: a5c91809-5452-441a-bae6-14081ea15f5b
---

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
| Governance hard block                | `meta-ads-client.ts` `updateCampaignStatus()`                                                                                                                                                                                               | `throw new Error("SAFETY: Agent cannot activate campaigns. Human must publish via Ads Manager.")` on `status === "ACTIVE"`. Can pause/delete/archive.                                                                     |
| CRM funnel + benchmarks              | `crm-data-provider/real-provider.ts`                                                                                                                                                                                                        | `RealCrmDataProvider` aggregates per-source funnel projections (received→qualified→booked→showed→paid→revenue). `getBenchmarks()` queries historical means for leadToQualified, qualifiedToBooked, bookedToPaid rates.    |
| Spend attribution                    | `analyzers/spend-attributor.ts`                                                                                                                                                                                                             | Attributes spend by source via destination_type matching + lead-share fallback                                                                                                                                            |

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

## Gap 1: Catalog Management (~2 days, MEDIUM priority)

**Problem:** Zero catalog code in ad-optimizer. MCP has catalog CRUD + feed diagnostics.

**MAPI endpoints (all available, no blocker):**

- `POST /{business_id}/owned_product_catalogs` — create catalog
- `POST /{catalog_id}/products` — add products
- `POST /{catalog_id}/product_feeds` — create feed (scheduled URL fetch or direct upload)
- `GET /{catalog_id}/product_feeds` — list feeds + diagnostics
- `GET /{product_feed_id}/uploads` — upload history with error counts
- `GET /{product_feed_id}/rules` — feed transformation rules
- `POST /{catalog_id}/product_sets` — create product sets
- `GET /{catalog_id}/products?filter=...` — search/filter products

**Implementation:**

1. New: `packages/ad-optimizer/src/meta-catalog-client.ts` — thin Graph API wrapper (follow `meta-ads-client.ts` pattern)
2. New: `packages/ad-optimizer/src/catalog-health-checker.ts` — list catalogs, check each feed for errors/warnings via uploads endpoint, flag >5% error rate or stale uploads (>24h)
3. Add `catalog_management` to SCOPES in `packages/core/src/ad-optimizer/facebook-oauth.ts`
4. Add `createCatalogHealthCheckCron` to `inngest-functions.ts` (daily)
5. Export from `index.ts`, co-located tests for each new file

## Gap 2: Signal Health / CAPI Diagnostics (~3 days, HIGH priority)

**Problem:** `CoverageValidator` (`onboarding/coverage-validator.ts`, 66 lines) only checks campaign destination_type coverage and whether recent leads exist. No pixel stats, no EMQ, no CAPI server event stats, no dedup checks.

**Available via MAPI (no blocker):**

- `GET /{pixel_id}?fields=name,last_fired_time,is_unavailable,automatic_matching_fields` — pixel metadata
- `GET /{pixel_id}/stats` — event counts by type
- `GET /{pixel_id}/stats?event_sources=["server"]` — CAPI-only event counts
- `GET /{pixel_id}/da_checks` — data availability checks
- `GET /{ad_account_id}/customconversions` — custom conversion health

**Partial blocker:** EMQ composite score + per-match-key coverage is NOT available via public MAPI (MCP-only, powered by internal Stefi framework). Workaround: compute server-to-browser ratio (target >90%) and dedup rate (target >50%) as proxy — these are the most actionable parts of EMQ anyway.

**MCP-only (cannot replicate):** CAPI Gateway onboarding status, upload frequency per channel. Skip for now.

**Meta's "Optimal CAPI Setup" thresholds:** server-to-browser >90%, EMQ >6.0, upload delay <1h, dedup rate >50%.

**Implementation:**

1. New: `packages/ad-optimizer/src/signal-health-checker.ts` — replaces/extends CoverageValidator:
   - `getPixelHealth(pixelId)` — last fired, is_unavailable, automatic matching fields
   - `getEventVolume(pixelId)` — per-event counts, browser vs server split
   - `getCAPIHealth(pixelId)` — server-to-browser ratio, dedup rate, event freshness
   - `getDaChecks(pixelId)` — signal sufficiency per optimization event
   - Returns `SignalHealthReport` with overall score (red/yellow/green) + per-signal breakdown
2. Integrate into `audit-runner.ts` — signal health pre-check before diagnostics. If pixel dead or ratio <50%, flag critical.
3. Add to daily check cron — surface stale pixels and broken CAPI.
4. Wire into `recommendation-engine.ts` — new action `fix_signal_health` with specific remediation per threshold breach.
5. Co-located tests.

## Gap 3: Help Center Search (~1 day, LOW priority)

**Blocker:** No public API. `ads_get_help_article` is confirmed MCP-only.

**Recommendation:** Skip API dependency. Build static error-code → remediation map instead. Help center search adds zero value to automated pipeline — crons don't look up articles.

## Gap 4: Expose Intelligence via Switchboard MCP Server

**4a: Wire existing intelligence (~2 days, HIGH priority, no dependencies)**

Add 4 new read-only tools to `apps/mcp-server/src/tools/read.ts`:

| Tool                  | Input                                  | Calls                                                                     | Returns                                                         |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `get_diagnostics`     | `{ accountId, dateRange? }`            | `MetaAdsClient.getCampaignInsights()` → `comparePeriods()` → `diagnose()` | `Diagnosis[]` (9 patterns)                                      |
| `get_recommendations` | `{ accountId, targetCPA, targetROAS }` | Full pipeline: insights → deltas → diagnose → `generateRecommendations()` | `RecommendationOutput[]` (13 actions with confidence + urgency) |
| `get_funnel_analysis` | `{ accountId, dateRange? }`            | `analyzeFunnel()`                                                         | Funnel shape, stage metrics, CRM integration data               |
| `get_trend_report`    | `{ accountId, metric, dateRange? }`    | `detectTrends()` + `projectBreach()`                                      | Trend direction, projected breach date, tier                    |

All read-only (no governance needed). Add Zod input schemas to `packages/schemas/`. Manual registration (auto-register only covers cartridge actions).

**4b: Wire new capabilities (~1 day, depends on Gaps 1-2)**

| Tool                 | Input                               | Calls                             |
| -------------------- | ----------------------------------- | --------------------------------- |
| `get_signal_health`  | `{ accountId }` or `{ pixelId }`    | `SignalHealthChecker` from Gap 2  |
| `get_catalog_health` | `{ businessId }` or `{ catalogId }` | `CatalogHealthChecker` from Gap 1 |

## Execution Order

```
           ┌─── Gap 2: Signal Health (3d, HIGH) ───┐
START ─────┤                                        ├─── Gap 4b: MCP signal+catalog tools (1d) ─── Gap 3: Help Center (1d)
           └─── Gap 4a: MCP intelligence (2d, HIGH)─┘
                         │
                   Gap 1: Catalog (2d, MEDIUM, can start after 4a)
```

Critical path: ~5 days (Gap 2 → Gap 4b → Gap 3). Gap 4a and Gap 1 run in parallel with Gap 2.

## Corrections to Original Obsidian Spec

1. `facebook-oauth.ts` path: spec says `packages/ad-optimizer/`, actual is `packages/core/src/ad-optimizer/`. SCOPES is a comma-separated string at line 5, not an array at "line ~15".
2. "Budget rebalancing across sources": overstated in spec. It's advisory — `shift_budget_to_source` is a recommendation, not automated execution.
3. `inngest-functions.ts` exists in BOTH `packages/ad-optimizer/src/` AND `packages/core/src/ad-optimizer/`. Verify which is canonical before adding new crons.

## MCP 3P Developer Access (as of 2026-05-04)

- Method A (consumer via Claude/ChatGPT): **Live** — open beta
- Methods B/C (developer 3P app): **Not yet available** — gated behind `ads_mcp_server_3p_capa`
- Open beta plan: remove capability gate, "mid-to-late May 2026" but no firm date
- Only 4 of ~20+ tools available to 3P: `get_ad_accounts`, `get_opportunity_score`, `get_errors_tool`, `get_help_article`
- Rate limits: 500 hits/min/user at server level + tool-level limits
- Testing access: test app ID `1306742011503771` (contact: Li Li, AXP team)

## Open Questions

1. When will Methods B/C open? Monitor `ads_mcp_server_3p_capa` gate weekly.
2. Is server-to-browser ratio + dedup rate sufficient as EMQ proxy, or pursue 3P MCP access for real composite score?
3. Catalog health checker: per-business or per-ad-account? Some clients share catalogs across accounts.
4. Does `ads_read` OAuth scope cover `/{pixel_id}/stats` and da_checks, or is `ads_management` needed? (Likely `ads_read` sufficient — needs verification against a real pixel.)

## Source Documents

- Full spec: Obsidian vault `Second Brain/artifacts/2026-05-04-ads-optimizer-vs-meta-mcp-analysis.md`
- Meta Ads AI Connectors FAQ (Sydney Levitan, May 1 2026)
- Ads CLI Developer Docs: developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/ads-cli-overview
