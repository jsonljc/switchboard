---
name: Reports Backend v1
description: /reports deep-dive — PR-R1 through R6 shipped, R5 (pull-quote) next
type: project
originSessionId: 859925d1-b176-49bf-b708-23c06a03a1a0
---

Operator deep-dive surface at `/reports` — period rollup, pull-quote prose, PDF export.

**Why:** Launch-priority parallel to Phase B agent homes. Operators need performance reporting before they trust the system.

**Spec:** `docs/superpowers/specs/2026-05-05-reports-backend-v1-design.md` (PR #367)
**R4 spec:** `docs/superpowers/specs/2026-05-06-reports-backend-v1-pr-r4-design.md`
**R6 spec:** `docs/superpowers/specs/2026-05-06-reports-backend-v1-pr-r6-design.md`

## PR Breakdown (as of 2026-05-06)

| PR  | Scope                                                              | Status                        |
| --- | ------------------------------------------------------------------ | ----------------------------- |
| R1  | Schema + scaffolding + locked types                                | **MERGED** (PR #368)          |
| R2  | ~~Web analytics pixel~~                                            | **CUT** — deferred to Phase D |
| R3  | Live rollup (attribution, funnel, cost-vs-value, cache, API route) | **MERGED** (PR #370)          |
| R4  | Campaign rollup + managed comparison + operator page               | **MERGED** (PR #371)          |
| R5  | Pull-quote generator — last stub in period-rollup                  | Not started                   |
| R6  | Attribution accuracy + metrics upgrade                             | **MERGED** (PR #372)          |

## R6 key changes (2026-05-06)

- CTWA campaign attribution via `GET /{ad_id}?fields=campaign_id` — `getAdCampaignId()` on MetaAdsClient with in-memory cache
- Instant form `sourceCampaignId` bug fixed — campaignId propagated through inquiry workflow
- `assignedAgent` default changed from `"employee-a"` to `"alex"` — fixes managed comparison showing 0 Alex threads
- `clicks`/`cpc`/`ctr` renamed to `inlineLinkClicks`/`costPerInlineLinkClick`/`inlineLinkClickCtr` across 40 files — Meta's deprecated fields replaced with modern link-click metrics
- Follow-up: wire `resolveCampaignId` into `CtwaAdapter` construction in `apps/chat/src/main.ts`

## R4 key decisions (2026-05-06)

- Leads from Meta `conversions` count, not `ConversionRecord` join — covers CTWA/instant form/CAPI
- Revenue still joins via `sourceCampaignId` on LifecycleRevenueEvent
- Managed comparison is operator-only at `/operator/reports`, customers never see it
- Ads comparison always uses pre-Switchboard baseline (lazy-pulled on first view)
- Conversations comparison uses in-period cohort (`assignedAgent === "alex"` vs rest)
- CampaignStage (hot/warm/cool) removed — YAGNI
- Revenue lags spend — CPL is the actionable early metric

**How to apply:** R5 (pull-quote generator) is the natural next step. Chat wiring for CTWA campaign resolution is a tracked follow-up.
