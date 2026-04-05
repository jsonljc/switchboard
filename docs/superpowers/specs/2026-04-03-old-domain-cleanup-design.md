# Old Domain Code Cleanup

**Date**: 2026-04-03
**Status**: Approved
**Context**: Switchboard pivoted from multi-vertical SMB platform (clinic/gym/commerce) to AI Workforce platform. The new employee system is implemented but old domain code remains.

---

## Goal

Remove all remnants of the old med clinic / SMB multi-vertical direction from the codebase. After cleanup, only AI Workforce infrastructure should remain.

## Approach

Layer-by-layer cleanup (bottom-up), running `pnpm typecheck` after each phase to catch breakage incrementally.

## Phase 1: Schemas

Remove from `packages/schemas/src/`:

- `skin.ts` — SkinManifest, vertical system
- `crm-provider.ts` — CrmContact, CrmDeal, CrmActivity
- `ads-operator.ts` — AdsOperatorConfig
- `revenue-growth.ts` — diagnostic cycles, interventions, constraint engine
- `campaign-plan.ts` — CampaignPlan
- `lead-profile.ts` — LeadProfile
- `conversation-flow.ts` — old FlowConfig
- `business-profile.ts` — audit for employee-system usage; remove HIPAA, BookingConfig, CadenceStepDef; keep any base fields still referenced

Remove corresponding exports from `index.ts` and test files.

## Phase 2: Database

Remove old Prisma models from `packages/db/prisma/schema.prisma`:

- CrmContact, CrmDeal, CrmActivity, RevenueEvent
- AdsOperatorConfig, CadenceInstance, RevenueAccount
- RevGrowthDiagnosticCycle, RevGrowthIntervention, RevGrowthWeeklyDigest
- ConnectorHealthLog, AlertRule, ScheduledReport

Fix remaining models:

- ConversationThread: remove `assignedAgent` default of "lead-responder"
- ContactLifecycle: remove "treated" stage reference
- OutcomeEvent: remove "booked" type reference

Remove old Prisma stores that reference deleted models.
Create migration to drop tables.

## Phase 3: Backend

- Delete `apps/chat/src/clinic/` (12 files)
- Delete `apps/chat/src/interpreter/skin-aware-interpreter.ts` + tests
- Delete `apps/mcp-server/src/tools/crm.ts`, `payments.ts`, update index
- Delete old API routes in `apps/api/` serving deleted domain data
- Delete `packages/agents/dist/` (stale compiled artifacts)
- Delete `cartridges/` directory (already out of workspace)
- Fix any broken imports in remaining chat/api code

## Phase 4: Frontend

- Delete pages: `/crm`, `/crm/[contactId]`, `/performance`
- Delete component directories: `crm/`, `revenue-growth/`, `pilot-report/`, `performance/`
- Delete hooks: `use-leads`, `use-pipeline`, `use-revenue-growth`, `use-pilot-report`, `use-spend`
- Delete API proxy routes: `crm/`, `revenue-growth/`, `pipeline/`, `reports/clinic/`, `campaign-attribution/`
- Delete: `lib/skin-catalog.ts`, `components/agents/agent-action-map.ts`
- Delete onboarding steps: `step-business-type.tsx`, `step-booking-platform.tsx`, `step-baseline.tsx`, `step-agent-selection.tsx`, `step-agent-style.tsx`
- Update onboarding page to remove SKIN_CATALOG / old agent references
- Clean `api-client-types.ts` and `query-keys.ts` of old domain types
- Update navigation (`staff-nav.tsx`, `owner-tabs.tsx`) to remove `/crm` and `/performance` links
- Clean `monthly-scorecard.tsx` of leads/bookings references or delete if fully old-domain

## Phase 5: Config & Artifacts

- `.env.example`: remove SKIN_ID, PROFILE_ID, LEAD_BOT_MODE, old ad platform vars, BOOKING_WEBHOOK_SECRET
- `turbo.json`: remove SKIN_ID, PROFILE_ID from globalEnv
- `docker-compose.yml`: remove old ad/stripe env var passthrough
- Delete any remaining `dist/` or `coverage/` artifacts from deleted packages

## Verification

After all phases:

1. `pnpm typecheck` passes
2. `pnpm lint` passes
3. `pnpm test` passes (tests for deleted code are also deleted)
4. No references to clinic, med spa, SKIN_CATALOG, old agent names, old cartridge names in active code
5. Employee system (employee-sdk, memory, Creative employee) still works — e2e smoke test passes

## What Stays

- Governance engine (policy engine, lifecycle orchestrator, competence tracker)
- Event loop, agent router, handler registry, action executor
- Knowledge pipeline (chunker, ingestion, retrieval)
- LLM adapter, model router, structured output
- Channel adapters (Telegram, WhatsApp, Slack)
- Credential encryption
- Employee-sdk, memory package, Creative employee
- Employee Prisma models and API routes
- Dashboard employee/workforce UI
