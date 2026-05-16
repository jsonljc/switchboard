# Ad Optimizer MCP Gap Plan — Implementation

Spec: `docs/superpowers/specs/2026-05-04-ad-optimizer-mcp-gap-plan-design.md`

## Execution Order

```
           ┌─── Gap 2: Signal Health (3d, HIGH) ───┐
START ─────┤                                        ├─── Gap 4b: MCP signal+catalog tools (1d) ─── Gap 3: Help Center (1d)
           └─── Gap 4a: MCP intelligence (2d, HIGH)─┘
                         │
                   Gap 1: Catalog (2d, MEDIUM, can start after 4a)
```

Critical path: ~5 days (Gap 2 → Gap 4b → Gap 3). Gap 4a and Gap 1 run in parallel with Gap 2.

## Gap 2: Signal Health / CAPI Diagnostics (~3 days, HIGH priority)

**Problem:** `CoverageValidator` (`packages/ad-optimizer/src/onboarding/coverage-validator.ts`, 66 lines) only checks campaign destination_type coverage and whether recent leads exist. No pixel stats, no EMQ, no CAPI server event stats, no dedup checks.

**Available via MAPI (no blocker):**

- `GET /{pixel_id}?fields=name,last_fired_time,is_unavailable,automatic_matching_fields` — pixel metadata
- `GET /{pixel_id}/stats` — event counts by type
- `GET /{pixel_id}/stats?event_sources=["server"]` — CAPI-only event counts
- `GET /{pixel_id}/da_checks` — data availability checks
- `GET /{ad_account_id}/customconversions` — custom conversion health

**Partial blocker:** EMQ composite score + per-match-key coverage is NOT available via public MAPI (MCP-only, powered by internal Stefi framework). Workaround: compute server-to-browser ratio (target >90%) and dedup rate (target >50%) as proxy — these are the most actionable parts of EMQ anyway.

**MCP-only (cannot replicate):** CAPI Gateway onboarding status, upload frequency per channel. Skip for now.

**Meta's "Optimal CAPI Setup" thresholds:** server-to-browser >90%, EMQ >6.0, upload delay <1h, dedup rate >50%.

**Tasks:**

1. New: `packages/ad-optimizer/src/signal-health-checker.ts` — replaces/extends CoverageValidator:
   - `getPixelHealth(pixelId)` — last fired, is_unavailable, automatic matching fields
   - `getEventVolume(pixelId)` — per-event counts, browser vs server split
   - `getCAPIHealth(pixelId)` — server-to-browser ratio, dedup rate, event freshness
   - `getDaChecks(pixelId)` — signal sufficiency per optimization event
   - Returns `SignalHealthReport` with overall score (red/yellow/green) + per-signal breakdown
2. Integrate into `audit-runner.ts` — signal health pre-check before diagnostics. If pixel dead or ratio <50%, flag critical.
3. Add to daily check cron — surface stale pixels and broken CAPI. NOTE: `inngest-functions.ts` exists in BOTH `packages/ad-optimizer/src/` and `packages/core/src/ad-optimizer/` — verify which is canonical before adding crons.
4. Wire into `recommendation-engine.ts` — new action `fix_signal_health` with specific remediation per threshold breach:
   - Server-to-browser <90%: "Verify CAPI access token and pixel ID, re-run test event"
   - Dedup rate <50%: "Ensure event_id matches between browser pixel and CAPI"
   - Event freshness >1h: "Check CAPI dispatch latency, verify webhook/queue health"
   - Pixel not firing: "Pixel is dead — check website installation"
5. Co-located tests (`signal-health-checker.test.ts`).

## Gap 4a: Expose Intelligence via MCP (~2 days, HIGH priority, no dependencies)

Add 4 new read-only tools to `apps/mcp-server/src/tools/read.ts`:

| Tool                  | Input                                  | Calls                                                                     | Returns                                                         |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `get_diagnostics`     | `{ accountId, dateRange? }`            | `MetaAdsClient.getCampaignInsights()` → `comparePeriods()` → `diagnose()` | `Diagnosis[]` (9 patterns)                                      |
| `get_recommendations` | `{ accountId, targetCPA, targetROAS }` | Full pipeline: insights → deltas → diagnose → `generateRecommendations()` | `RecommendationOutput[]` (13 actions with confidence + urgency) |
| `get_funnel_analysis` | `{ accountId, dateRange? }`            | `analyzeFunnel()`                                                         | Funnel shape, stage metrics, CRM integration data               |
| `get_trend_report`    | `{ accountId, metric, dateRange? }`    | `detectTrends()` + `projectBreach()`                                      | Trend direction, projected breach date, tier                    |

**Tasks:**

1. Add Zod input schemas to `packages/schemas/` for each tool's input validation.
2. Add 4 tool definitions to `apps/mcp-server/src/tools/read.ts` — manual registration (auto-register only covers cartridge actions).
3. Wire handler implementations — import from `packages/ad-optimizer/` and call through to existing modules.
4. All read-only (no governance needed, no side-effect annotations).
5. Co-located tests.

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

**Tasks:**

1. New: `packages/ad-optimizer/src/meta-catalog-client.ts` — thin Graph API wrapper (follow `meta-ads-client.ts` pattern)
2. New: `packages/ad-optimizer/src/catalog-health-checker.ts` — list catalogs, check each feed for errors/warnings via uploads endpoint, flag >5% error rate or stale uploads (>24h). Returns `CatalogHealthReport`.
3. Add `catalog_management` to SCOPES in `packages/core/src/ad-optimizer/facebook-oauth.ts` (comma-separated string at line 5, NOT an array)
4. Add `createCatalogHealthCheckCron` to `inngest-functions.ts` (daily)
5. Export from `index.ts`, co-located tests for each new file

## Gap 4b: MCP Catalog + Signal Health Tools (~1 day, depends on Gaps 1-2)

| Tool                 | Input                               | Calls                             |
| -------------------- | ----------------------------------- | --------------------------------- |
| `get_signal_health`  | `{ accountId }` or `{ pixelId }`    | `SignalHealthChecker` from Gap 2  |
| `get_catalog_health` | `{ businessId }` or `{ catalogId }` | `CatalogHealthChecker` from Gap 1 |

**Tasks:**

1. Add Zod input schemas.
2. Add 2 tool definitions to `apps/mcp-server/src/tools/read.ts`.
3. Wire handler implementations.
4. Co-located tests.

## Gap 3: Help Center (~1 day, LOW priority)

**Blocker:** No public API. `ads_get_help_article` is confirmed MCP-only.

**Tasks:**

1. Build static error-code → remediation map in `packages/ad-optimizer/src/error-remediation-map.ts`. Curated map of common Ads API error codes → actionable remediation steps.
2. Wire into recommendation engine — when audit encounters a known error code, attach remediation text.
3. Co-located tests.

## Key Corrections (from original Obsidian spec)

1. `facebook-oauth.ts` path: original spec says `packages/ad-optimizer/`, actual is `packages/core/src/ad-optimizer/`. SCOPES is a comma-separated string at line 5, not an array at "line ~15".
2. "Budget rebalancing across sources": overstated in spec. It's advisory — `shift_budget_to_source` is a recommendation, not automated execution.
3. `inngest-functions.ts` exists in BOTH `packages/ad-optimizer/src/` AND `packages/core/src/ad-optimizer/`. Verify which is canonical before adding new crons.

## Pre-commit Checklist

- `pnpm typecheck` passes
- `pnpm test` passes (including new co-located tests)
- No `any` types, no `console.log`
- `.js` extensions in relative imports (except Next.js)
- Files under 400 lines (warn) / 600 lines (error)
- Follow existing patterns in each package
