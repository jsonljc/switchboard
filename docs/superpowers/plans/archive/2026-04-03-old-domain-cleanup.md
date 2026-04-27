# Old Domain Code Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all remnants of the old med clinic / SMB multi-vertical direction so the codebase reflects the AI Workforce platform only.

**Architecture:** Layer-by-layer cleanup (schemas → core → db → backend → frontend → config), running `pnpm typecheck` after each phase to catch breakage incrementally. Each task produces a working build.

**Tech Stack:** TypeScript, Prisma, Fastify, Next.js, pnpm + Turborepo

**Test command:** `npx pnpm@9.15.4 typecheck`
**Full test:** `npx pnpm@9.15.4 test`

---

### Task 1: Delete old domain schema files

**Files:**

- Delete: `packages/schemas/src/skin.ts`
- Delete: `packages/schemas/src/crm-provider.ts`
- Delete: `packages/schemas/src/ads-operator.ts`
- Delete: `packages/schemas/src/revenue-growth.ts`
- Delete: `packages/schemas/src/campaign-plan.ts`
- Delete: `packages/schemas/src/lead-profile.ts`
- Delete: `packages/schemas/src/conversation-flow.ts`
- Delete: `packages/schemas/src/business-profile.ts`
- Delete: `packages/schemas/src/__tests__/business-profile.test.ts`
- Delete: `packages/schemas/src/__tests__/lead-profile.test.ts`
- Delete: `packages/schemas/src/__tests__/skin.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Delete the 8 schema files and 3 test files**

```bash
rm packages/schemas/src/skin.ts \
   packages/schemas/src/crm-provider.ts \
   packages/schemas/src/ads-operator.ts \
   packages/schemas/src/revenue-growth.ts \
   packages/schemas/src/campaign-plan.ts \
   packages/schemas/src/lead-profile.ts \
   packages/schemas/src/conversation-flow.ts \
   packages/schemas/src/business-profile.ts \
   packages/schemas/src/__tests__/business-profile.test.ts \
   packages/schemas/src/__tests__/lead-profile.test.ts \
   packages/schemas/src/__tests__/skin.test.ts
```

- [ ] **Step 2: Remove old exports from `packages/schemas/src/index.ts`**

Remove these lines:

```typescript
export * from "./crm-provider.js";
export * from "./skin.js";
export * from "./business-profile.js";
export * from "./lead-profile.js";
export * from "./campaign-plan.js";
export * from "./ads-operator.js";
export * from "./revenue-growth.js";
export * from "./conversation-flow.js";
```

- [ ] **Step 3: Verify schemas package compiles**

```bash
npx pnpm@9.15.4 --filter @switchboard/schemas typecheck
```

Expected: PASS (schemas has no internal deps on these files — they're leaf exports only)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: remove old domain schema files (skin, crm, ads, revenue-growth, lead, campaign, business-profile)"
```

---

### Task 2: Delete old core modules (skin/, profile/, agents/)

**Files:**

- Delete: `packages/core/src/skin/` (entire directory — loader.ts, resolver.ts, index.ts, **tests**/)
- Delete: `packages/core/src/profile/` (entire directory — loader.ts, resolver.ts, index.ts, **tests**/)
- Delete: `packages/core/src/agents/` (entire directory — strategist, optimizer, monitor, reporter, guardrail, shared, types, profile-builder, progressive-autonomy, alert-defaults, index.ts, **tests**/)
- Modify: `packages/core/src/index.ts` — remove re-exports of skin, profile, and agents modules

**Note:** `packages/core/src/governance/profile.ts` is about governance profiles (guarded/balanced/autonomous), NOT business profiles. It stays.

- [ ] **Step 1: Delete the three directories**

```bash
rm -rf packages/core/src/skin packages/core/src/profile packages/core/src/agents
```

- [ ] **Step 2: Remove re-exports from `packages/core/src/index.ts`**

Remove these lines:

```typescript
export * from "./skin/index.js";
export * from "./profile/index.js";
```

Also remove any re-exports from `./agents/index.js` if present.

- [ ] **Step 3: Verify core package compiles**

```bash
npx pnpm@9.15.4 --filter @switchboard/core typecheck
```

Expected: PASS (nothing in core's remaining modules imports from skin/profile/agents)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: remove old core skin, profile, and agents modules"
```

---

### Task 3: Remove old Prisma models and stores

**Files:**

- Modify: `packages/db/prisma/schema.prisma` — remove 15 old models (CrmContact, ContactAlias, RevenueEvent, CrmDeal, CrmActivity, AlertRule, ScheduledReport, AlertHistory, AdsOperatorConfig, CadenceInstance, RevenueAccount, RevGrowthDiagnosticCycle, RevGrowthIntervention, RevGrowthWeeklyDigest, ConnectorHealthLog)
- Modify: `packages/db/prisma/schema.prisma` — fix ConversationThread `assignedAgent` default, ContactLifecycle stages, OutcomeEvent types
- Delete: `packages/db/src/storage/prisma-crm-provider.ts`
- Delete: `packages/db/src/storage/__tests__/prisma-crm-provider.test.ts`
- Delete: `packages/db/src/storage/prisma-cadence-store.ts`
- Delete: `packages/db/src/storage/prisma-revenue-account-store.ts`
- Delete: `packages/db/src/storage/prisma-diagnostic-cycle-store.ts`
- Delete: `packages/db/src/storage/prisma-intervention-store.ts`
- Delete: `packages/db/src/storage/prisma-weekly-digest-store.ts`
- Delete: `packages/db/src/storage/prisma-connector-health-log-store.ts`
- Delete: `packages/db/src/storage/__tests__/prisma-connector-health-log-store.test.ts`
- Delete: `packages/db/src/ads-operator-config/store.ts`
- Delete: `packages/db/src/ads-operator-config/__tests__/store.test.ts`
- Delete: `packages/db/src/storage/prisma-business-config-store.ts`
- Modify: `packages/db/src/index.ts` — remove exports for deleted stores
- Modify: `packages/db/src/storage/index.ts` — remove exports for deleted stores

- [ ] **Step 1: Remove old models from schema.prisma**

Open `packages/db/prisma/schema.prisma` and delete these model blocks (lines 462-771):

- CrmContact (462-498)
- ContactAlias (500-511)
- RevenueEvent (513-528)
- CrmDeal (530-550)
- CrmActivity (552-570)
- AlertRule (574-593)
- ScheduledReport (595-614)
- AlertHistory (616-628)
- AdsOperatorConfig (632-648)
- CadenceInstance (652-671)
- RevenueAccount (675-694)
- RevGrowthDiagnosticCycle (696-716)
- RevGrowthIntervention (718-742)
- RevGrowthWeeklyDigest (744-757)
- ConnectorHealthLog (759-771)

- [ ] **Step 2: Fix old defaults in kept models**

In ConversationThread model: change `assignedAgent` default from `"lead-responder"` to remove the default or set to empty string.

In ContactLifecycle model: remove `"treated"` from stage comments/enum if present. Keep: `lead`, `qualified`, `booked`, `churned`.

In OutcomeEvent model: keep `booked` if it's generic enough (appointment booking is a valid AI employee concept), but remove clinic-specific comments.

- [ ] **Step 3: Delete old store files**

```bash
rm packages/db/src/storage/prisma-crm-provider.ts \
   packages/db/src/storage/__tests__/prisma-crm-provider.test.ts \
   packages/db/src/storage/prisma-cadence-store.ts \
   packages/db/src/storage/prisma-revenue-account-store.ts \
   packages/db/src/storage/prisma-diagnostic-cycle-store.ts \
   packages/db/src/storage/prisma-intervention-store.ts \
   packages/db/src/storage/prisma-weekly-digest-store.ts \
   packages/db/src/storage/prisma-connector-health-log-store.ts \
   packages/db/src/storage/__tests__/prisma-connector-health-log-store.test.ts \
   packages/db/src/storage/prisma-business-config-store.ts \
   packages/db/src/ads-operator-config/store.ts \
   packages/db/src/ads-operator-config/__tests__/store.test.ts
```

Remove `packages/db/src/ads-operator-config/` directory if empty after deletion.

- [ ] **Step 4: Remove old store exports**

From `packages/db/src/index.ts`, remove lines exporting:

- `PrismaCrmProvider`
- `PrismaCadenceStore`, `CadenceStore`, `CadenceInstanceRecord`
- `PrismaInterventionStore`
- `PrismaDiagnosticCycleStore`
- `PrismaRevenueAccountStore`
- `PrismaWeeklyDigestStore`
- `PrismaAdsOperatorConfigStore`
- `PrismaConnectorHealthLogStore`
- `PrismaBusinessConfigStore` (if exported)

From `packages/db/src/storage/index.ts`, remove lines exporting:

- `PrismaInterventionStore`
- `PrismaDiagnosticCycleStore`
- `PrismaRevenueAccountStore`
- `PrismaWeeklyDigestStore`

- [ ] **Step 5: Regenerate Prisma client and verify**

```bash
cd packages/db && npx pnpm@9.15.4 db:generate && cd ../..
npx pnpm@9.15.4 --filter @switchboard/db typecheck
```

- [ ] **Step 6: Create Prisma migration**

```bash
cd packages/db && npx prisma migrate dev --name remove-old-domain-models && cd ../..
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: remove old Prisma models and stores (CRM, ads, revenue-growth, cadence, alerts)"
```

---

### Task 4: Clean up backend — chat app

**Files:**

- Delete: `apps/chat/src/clinic/` (entire directory — 12 files)
- Delete: `apps/chat/src/interpreter/skin-aware-interpreter.ts`
- Delete: `apps/chat/src/interpreter/__tests__/skin-aware-interpreter.test.ts`
- Delete: `apps/chat/src/__tests__/clinic-read-handler.test.ts`
- Delete: `apps/chat/src/__tests__/clinic-interpreter.test.ts`
- Delete: `apps/chat/src/__tests__/clinic-integration.test.ts`
- Delete: `apps/chat/src/__tests__/campaign-loading.test.ts`
- Delete: `apps/chat/src/__tests__/diagnostic-formatter.test.ts`
- Delete: `apps/chat/src/__tests__/diagnostic-integration.test.ts`
- Delete: `apps/chat/src/__tests__/welcome-message.test.ts` (references ResolvedSkin)
- Modify: `apps/chat/src/message-pipeline.ts` — remove `handleReadIntent` import from clinic/read-handler
- Modify: `apps/chat/src/bootstrap.ts` — remove clinic model-router-factory and clinic interpreter imports, remove SkinLoader/ProfileResolver usage
- Modify: `apps/chat/src/runtime.ts` — remove ResolvedSkin/ResolvedProfile references

- [ ] **Step 1: Delete clinic directory and related test files**

```bash
rm -rf apps/chat/src/clinic
rm apps/chat/src/interpreter/skin-aware-interpreter.ts \
   apps/chat/src/interpreter/__tests__/skin-aware-interpreter.test.ts \
   apps/chat/src/__tests__/clinic-read-handler.test.ts \
   apps/chat/src/__tests__/clinic-interpreter.test.ts \
   apps/chat/src/__tests__/clinic-integration.test.ts \
   apps/chat/src/__tests__/campaign-loading.test.ts \
   apps/chat/src/__tests__/diagnostic-formatter.test.ts \
   apps/chat/src/__tests__/diagnostic-integration.test.ts \
   apps/chat/src/__tests__/welcome-message.test.ts
```

- [ ] **Step 2: Fix `message-pipeline.ts`**

Remove the `handleReadIntent` import (line 10) and any code paths that call it. Replace with a no-op or remove the branch entirely.

- [ ] **Step 3: Fix `bootstrap.ts`**

Remove imports of `SkinLoader`, `ProfileResolver`, and their usage. Remove dynamic imports of `./clinic/model-router-factory.js` and `./clinic/interpreter.js`. Remove `resolvedSkin`/`resolvedProfile` variables and any code that depends on them.

- [ ] **Step 4: Fix `runtime.ts`**

Remove `ResolvedSkin`, `ResolvedProfile` type imports and any fields/parameters that use them.

- [ ] **Step 5: Fix any other broken imports**

Run `npx pnpm@9.15.4 --filter @switchboard/chat typecheck` and fix any remaining broken imports iteratively.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: remove clinic-specific code and skin/profile system from chat app"
```

---

### Task 5: Clean up backend — API routes and MCP server

**Files:**

- Delete: `apps/api/src/routes/alerts.ts`
- Delete: `apps/api/src/routes/cartridges.ts`
- Delete: `apps/api/src/routes/interpreters.ts`
- Delete: `apps/api/src/routes/organizations.ts`
- Delete: `apps/api/src/routes/lifecycle.ts`
- Delete: `apps/mcp-server/src/tools/crm.ts`
- Delete: `apps/mcp-server/src/tools/payments.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` — remove imports and registrations for deleted routes
- Modify: `apps/api/src/app.ts` — remove `lifecycleDeps` stub if present
- Modify: `apps/mcp-server/src/tools/index.ts` — remove CRM and payments imports/references
- Delete: old API test files for deleted routes (check `apps/api/src/__tests__/` for api-alerts, api-cartridges, api-lifecycle, api-organizations, api-interpreters test files)

- [ ] **Step 1: Delete old API route files and their tests**

```bash
rm apps/api/src/routes/alerts.ts \
   apps/api/src/routes/cartridges.ts \
   apps/api/src/routes/interpreters.ts \
   apps/api/src/routes/organizations.ts \
   apps/api/src/routes/lifecycle.ts
```

Delete matching test files from `apps/api/src/__tests__/` (they may already be deleted from a prior commit — check first).

- [ ] **Step 2: Update `apps/api/src/bootstrap/routes.ts`**

Remove these imports and their `app.register()` calls:

- `interpretersRoutes` (line 14, 50)
- `cartridgesRoutes` (line 15, 51)
- `organizationsRoutes` (line 17, 53)
- `alertsRoutes` (line 20, 56)
- `lifecycleRoutes` (line 35, 70)

- [ ] **Step 3: Clean `apps/api/src/app.ts`**

Remove `lifecycleDeps: null` declaration (line 52) and `app.decorate("lifecycleDeps", null)` (line 291) if present.

- [ ] **Step 4: Delete old MCP tools and update index**

```bash
rm apps/mcp-server/src/tools/crm.ts apps/mcp-server/src/tools/payments.ts
```

Edit `apps/mcp-server/src/tools/index.ts`:

- Remove all imports from `./crm.js` and `./payments.js`
- Remove their entries from tool definition arrays, side-effect tool sets, read tool sets, and action type maps
- Remove their re-exports

- [ ] **Step 5: Verify API and MCP server compile**

```bash
npx pnpm@9.15.4 --filter @switchboard/api typecheck
npx pnpm@9.15.4 --filter @switchboard/mcp-server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: remove old API routes (alerts, cartridges, interpreters, organizations, lifecycle) and MCP tools (CRM, payments)"
```

---

### Task 6: Clean up backend — delete stale artifacts and cartridges

**Files:**

- Delete: `packages/agents/dist/` (stale compiled artifacts)
- Delete: `cartridges/` (entire directory — 5 old cartridge packages)
- Delete: `packages/create-switchboard-cartridge/` (cartridge generator, if still exists)

- [ ] **Step 1: Delete stale directories**

```bash
rm -rf packages/agents/dist cartridges
```

Check if `packages/create-switchboard-cartridge/` exists and delete if so:

```bash
rm -rf packages/create-switchboard-cartridge
```

- [ ] **Step 2: Verify nothing references deleted dirs**

```bash
npx pnpm@9.15.4 typecheck
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: delete stale cartridge directories and compiled artifacts"
```

---

### Task 7: Clean up frontend — delete old pages, components, hooks, and API proxies

**Files:**

- Delete: `apps/dashboard/src/app/crm/` (entire directory)
- Delete: `apps/dashboard/src/app/performance/` (entire directory)
- Delete: `apps/dashboard/src/app/__tests__/growth-page.test.ts`
- Delete: `apps/dashboard/src/components/crm/` (entire directory)
- Delete: `apps/dashboard/src/components/revenue-growth/` (entire directory)
- Delete: `apps/dashboard/src/components/pilot-report/` (entire directory)
- Delete: `apps/dashboard/src/components/performance/` (entire directory)
- Delete: `apps/dashboard/src/components/agents/agent-action-map.ts`
- Delete: `apps/dashboard/src/components/mission-control/monthly-scorecard.tsx`
- Delete: `apps/dashboard/src/hooks/use-leads.ts`
- Delete: `apps/dashboard/src/hooks/use-pipeline.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-pipeline.test.ts`
- Delete: `apps/dashboard/src/hooks/use-revenue-growth.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-revenue-growth.test.ts`
- Delete: `apps/dashboard/src/hooks/use-pilot-report.ts`
- Delete: `apps/dashboard/src/hooks/use-spend.ts`
- Delete: `apps/dashboard/src/lib/skin-catalog.ts`
- Delete: `apps/dashboard/src/app/api/dashboard/crm/` (entire directory)
- Delete: `apps/dashboard/src/app/api/dashboard/revenue-growth/` (entire directory)
- Delete: `apps/dashboard/src/app/api/dashboard/reports/clinic/` (entire directory)
- Delete: `apps/dashboard/src/app/api/dashboard/reports/pilot/` (entire directory)
- Delete: `apps/dashboard/src/app/api/dashboard/campaign-attribution/` (entire directory)
- Delete: `apps/dashboard/src/app/api/dashboard/pipeline/` (entire directory)
- Delete: `apps/dashboard/src/app/api/dashboard/organizations/` (entire directory)

- [ ] **Step 1: Delete old pages**

```bash
rm -rf apps/dashboard/src/app/crm apps/dashboard/src/app/performance
rm -f apps/dashboard/src/app/__tests__/growth-page.test.ts
```

- [ ] **Step 2: Delete old component directories**

```bash
rm -rf apps/dashboard/src/components/crm \
       apps/dashboard/src/components/revenue-growth \
       apps/dashboard/src/components/pilot-report \
       apps/dashboard/src/components/performance
rm -f apps/dashboard/src/components/agents/agent-action-map.ts \
      apps/dashboard/src/components/mission-control/monthly-scorecard.tsx
```

- [ ] **Step 3: Delete old hooks**

```bash
rm -f apps/dashboard/src/hooks/use-leads.ts \
      apps/dashboard/src/hooks/use-pipeline.ts \
      apps/dashboard/src/hooks/__tests__/use-pipeline.test.ts \
      apps/dashboard/src/hooks/use-revenue-growth.ts \
      apps/dashboard/src/hooks/__tests__/use-revenue-growth.test.ts \
      apps/dashboard/src/hooks/use-pilot-report.ts \
      apps/dashboard/src/hooks/use-spend.ts
```

- [ ] **Step 4: Delete old API proxy routes and skin-catalog**

```bash
rm -rf apps/dashboard/src/app/api/dashboard/crm \
       apps/dashboard/src/app/api/dashboard/revenue-growth \
       apps/dashboard/src/app/api/dashboard/reports/clinic \
       apps/dashboard/src/app/api/dashboard/reports/pilot \
       apps/dashboard/src/app/api/dashboard/campaign-attribution \
       apps/dashboard/src/app/api/dashboard/pipeline \
       apps/dashboard/src/app/api/dashboard/organizations
rm -f apps/dashboard/src/lib/skin-catalog.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove old dashboard pages, components, hooks, and API proxies (CRM, revenue-growth, performance, pipeline)"
```

---

### Task 8: Clean up frontend — fix remaining imports and navigation

**Files:**

- Modify: `apps/dashboard/src/components/layout/staff-nav.tsx` — remove CRM and Performance nav links
- Modify: `apps/dashboard/src/components/layout/owner-tabs.tsx` — remove CRM tab
- Modify: `apps/dashboard/src/lib/query-keys.ts` — remove old domain query key groups (spend, cartridges, alerts, scheduledReports, reports, campaigns, crm, revenueGrowth, pipeline)
- Modify: `apps/dashboard/src/lib/api-client-types.ts` — remove old domain types (AlertRule, CreateAlertInput, AlertHistoryEntry, ScheduledReportEntry, OperatorSummary, CampaignAttribution, PilotReportData, CreateScheduledReportInput, RevGrowth\* types)
- Modify: `apps/dashboard/src/components/mission-control/owner-today.tsx` — remove references to deleted components (pipeline-funnel, monthly-scorecard) if imported
- Delete old onboarding steps: `step-business-type.tsx`, `step-booking-platform.tsx`, `step-baseline.tsx`, `step-agent-selection.tsx`, `step-agent-style.tsx`, `step-budget.tsx`, `step-connection.tsx`, `step-governance-simple.tsx`, `step-operator.tsx`, `step-telegram.tsx`, `step-tone-language.tsx`, `step-all-set.tsx`, `step-business-basics.tsx`
- Modify: `apps/dashboard/src/app/onboarding/page.tsx` — remove old wizard steps and SKIN_CATALOG references

- [ ] **Step 1: Update navigation**

In `staff-nav.tsx`: remove `{ href: "/crm", label: "CRM" }` and `{ href: "/performance", label: "Performance" }` from NAV array.

In `owner-tabs.tsx`: remove `{ href: "/crm", label: "CRM", icon: Users }` from tabs array.

- [ ] **Step 2: Clean query-keys.ts**

Remove these key groups: `spend`, `cartridges`, `alerts`, `scheduledReports`, `reports`, `campaigns`, `crm`, `revenueGrowth`, `pipeline`.

- [ ] **Step 3: Clean api-client-types.ts**

Remove these type definitions: `AlertRule`, `CreateAlertInput`, `AlertHistoryEntry`, `ScheduledReportEntry`, `OperatorSummary`, `CampaignAttribution`, `PilotReportData`, `CreateScheduledReportInput`, `RevGrowthScorerOutput`, `RevGrowthConstraint`, `RevGrowthIntervention`, `RevGrowthDiagnosticResult`, `RevGrowthConnectorHealth`, `RevGrowthDigest`.

- [ ] **Step 4: Delete old onboarding step components**

```bash
rm -f apps/dashboard/src/components/onboarding/step-business-type.tsx \
      apps/dashboard/src/components/onboarding/step-booking-platform.tsx \
      apps/dashboard/src/components/onboarding/step-baseline.tsx \
      apps/dashboard/src/components/onboarding/step-agent-selection.tsx \
      apps/dashboard/src/components/onboarding/step-agent-style.tsx \
      apps/dashboard/src/components/onboarding/step-budget.tsx \
      apps/dashboard/src/components/onboarding/step-connection.tsx \
      apps/dashboard/src/components/onboarding/step-governance-simple.tsx \
      apps/dashboard/src/components/onboarding/step-operator.tsx \
      apps/dashboard/src/components/onboarding/step-telegram.tsx \
      apps/dashboard/src/components/onboarding/step-tone-language.tsx \
      apps/dashboard/src/components/onboarding/step-all-set.tsx \
      apps/dashboard/src/components/onboarding/step-business-basics.tsx
```

- [ ] **Step 5: Fix onboarding page**

Update `apps/dashboard/src/app/onboarding/page.tsx`:

- Remove imports of deleted step components
- Remove `SKIN_CATALOG` reference
- Remove old state: `vertical`, `selectedAgents` with old agent names
- Keep any employee-oriented onboarding steps (StepAdPlatform may need review — keep if relevant to Creative employee connections, otherwise delete)

- [ ] **Step 6: Fix any remaining broken imports**

Run `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck` and fix iteratively. Common issues:

- `owner-today.tsx` may import deleted components (pipeline-funnel, monthly-scorecard)
- Components importing from deleted hooks or types

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: clean up dashboard navigation, types, onboarding, and query keys"
```

---

### Task 9: Clean up config files

**Files:**

- Modify: `.env.example`
- Modify: `turbo.json`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Clean `.env.example`**

Remove these env vars:

- `META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID`, `META_PIXEL_ID`
- `GOOGLE_ADS_ACCESS_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `TIKTOK_ADS_ACCESS_TOKEN`, `TIKTOK_ADS_ADVERTISER_ID`
- `HUBSPOT_ACCESS_TOKEN`
- `SKIN_ID`, `PROFILE_ID`
- `LEAD_BOT_MODE`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `BOOKING_WEBHOOK_SECRET`

Keep any section headers/comments that are still relevant (e.g., database, Redis, API keys for Claude).

- [ ] **Step 2: Clean `turbo.json`**

Remove `"SKIN_ID"` and `"PROFILE_ID"` from the `globalEnv` array.

- [ ] **Step 3: Clean `docker-compose.yml`**

Remove from api service environment:

- `META_ADS_ACCESS_TOKEN=${META_ADS_ACCESS_TOKEN:-}`
- `META_ADS_ACCOUNT_ID=${META_ADS_ACCOUNT_ID:-}`
- `STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}`

Remove from chat service environment:

- `META_ADS_ACCESS_TOKEN=${META_ADS_ACCESS_TOKEN:-}`
- `META_ADS_ACCOUNT_ID=${META_ADS_ACCOUNT_ID:-}`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove old domain env vars and config references"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS across all packages

- [ ] **Step 2: Full test suite**

```bash
npx pnpm@9.15.4 test
```

Expected: PASS (deleted tests should not run, remaining tests should pass)

- [ ] **Step 3: Grep audit for remnants**

```bash
grep -r "clinic\|med.spa\|SKIN_CATALOG\|lead-responder\|sales-closer\|nurture\|revenue-tracker\|ad-optimizer\|cartridge\|Radiance\|Bright Smile\|paying.patient" --include="*.ts" --include="*.tsx" packages/ apps/ employees/ | grep -v node_modules | grep -v "dist/" | grep -v ".test." | head -30
```

Any hits should be investigated — they may be in comments, type names, or string literals that were missed.

- [ ] **Step 4: Verify employee system works**

```bash
npx pnpm@9.15.4 --filter @switchboard/creative-employee test
```

The Creative employee e2e smoke test should still pass.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A && git commit -m "chore: final cleanup pass — verify all old domain references removed"
```
