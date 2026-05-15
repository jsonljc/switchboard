# file-size-splits

**Charter:** Files >400 (warn) / >600 (error); propose split boundaries for >600.
**Method:** Enumerated all `.ts`, `.tsx`, and `.css` files via `find ... -exec wc -l` excluding node_modules/dist/.next. Analyzed file structure by reading first 100 lines and identifying distinct domains. CSS modules assessed by visual grouping of rules. Test files examined for subject clustering.
**Scope exclusions applied:**

- Riley-related paths: `packages/core/src/**/riley*`, `packages/core/src/**/recommendation*`, `packages/schemas/src/recommendation*`
- Local-readiness spec/plan docs in `docs/superpowers/specs/` and `docs/superpowers/plans/`

## Files >600 LOC (error threshold) — split needed

### [CRITICAL] `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css`: 1350 LOC

- **Where:** `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css:1-1350`
- **Evidence:** Large editorial design system scoped to /reports page; includes page-level theme variables, typography ramp, color palette, component styling, and responsive grid rules all bundled in one file.
- **Why it matters:** CLAUDE.md error threshold crossed by 750 LOC; visual rule coupling + maintenance friction; changes to one feature re-bundle entire page style.
- **Fix:** Split into 3-4 semantic modules: reports-theme.module.css, reports-page-layout.module.css, reports-components.module.css. Use CSS @import for re-export.
- **Effort:** M
- **Risk if untouched:** Merge conflicts on simultaneous feature work; difficult to locate specific rule; cognitive overhead during review.
- **Collides with active work?:** No

### [CRITICAL] `apps/dashboard/src/app/globals.css`: 1193 LOC

- **Where:** `apps/dashboard/src/app/globals.css:1-1193`
- **Evidence:** Root design system CSS: Tailwind directives, global CSS variables (surfaces, text, interactive, semantic, borders), button + form resets, base typography, utility overrides, and theme aliases.
- **Why it matters:** CLAUDE.md error threshold exceeded by 593 LOC; single point of failure for app-wide styling; changes here ripple across all pages.
- **Fix:** Split into 4–5 layered modules: globals-base.css, globals-components.css, globals-utilities.css, globals-theme-mercury.css. Import chain: base → components → utilities → theme.
- **Effort:** M
- **Risk if untouched:** High noise in code review; hard to isolate semantic changes from visual tweaks; global CSS variable collisions difficult to detect.
- **Collides with active work?:** No

### [HIGH] `packages/db/prisma/seed-marketplace.ts`: 972 LOC

- **Where:** `packages/db/prisma/seed-marketplace.ts:1-972`
- **Evidence:** Single seed script bundling agent definitions (6 agents), marketplace task category fixtures, and marketplace-specific seeding logic.
- **Why it matters:** CLAUDE.md error threshold crossed by 372 LOC; difficult to add/modify one agent without scrolling through 900 lines.
- **Fix:** Split into fixtures/agents/ directory with one file per agent + fixtures/marketplace-tasks.fixture.ts. New seed-marketplace.ts orchestrates seedAgents(), seedTasks(), seedDemoData().
- **Effort:** M
- **Risk if untouched:** Onboarding friction; merge conflicts on simultaneous agent additions; test fixtures cannot be reused independently.
- **Collides with active work?:** No

### [HIGH] `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`: 941 LOC

- **Where:** `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css:1-941`
- **Evidence:** Editorial design system for activity ledger page bundling theme aliases, paper + ink palette, spacing scale, section ramps, row + drawer + header component styles, filter chips, pagination.
- **Why it matters:** CLAUDE.md error threshold crossed by 341 LOC; heavy visual coupling.
- **Fix:** Split into activity-theme.module.css and activity-components.module.css. Optionally extract shared Mercury theme into ../shared/mercury-theme.module.css.
- **Effort:** M
- **Risk if untouched:** Visual regression risk on row state transitions; palette inconsistencies across Mercury pages.
- **Collides with active work?:** No

### [HIGH] `packages/schemas/src/__tests__/schemas.test.ts`: 940 LOC

- **Where:** `packages/schemas/src/__tests__/schemas.test.ts:1-940`
- **Evidence:** Monolithic test file covering 23+ Zod schema validation subjects (Principal, RiskInput, Identity, Role, Policy, Action, Approval, Delegation, Composite, Governance, Audit, Messages, Conversation).
- **Why it matters:** Test subjects are orthogonal domains; changes to one schema's validation cause re-running entire 940-line suite.
- **Fix:** Split into per-schema test files under `__tests__/schemas/`: principal.test.ts, risk.test.ts, identity.test.ts, policy.test.ts, action.test.ts, approval.test.ts, governance.test.ts, messaging.test.ts.
- **Effort:** M
- **Risk if untouched:** Test suite slow feedback loop; hard to identify which schema changed behavior.
- **Collides with active work?:** No

### [HIGH] `packages/core/src/orchestrator/propose-pipeline.ts`: 818 LOC

- **Where:** `packages/core/src/orchestrator/propose-pipeline.ts:1-818`
- **Evidence:** ProposePipeline class orchestrates the full action-proposal flow: idempotency, span tracing, proposal inner logic, identity, policy, approval routing, notification building, cartridge execution.
- **Why it matters:** Difficult to unit-test sub-flows in isolation; modifications to approval routing or notification logic require navigating the full pipeline.
- **Fix:** Extract distinct phases: proposeIdentity(), proposePolicy(), proposeApproval(), proposeExecution() (150–180 LOC per phase). Extract notification building into ProposalNotificationBuilder.
- **Effort:** L
- **Risk if untouched:** Approval routing bugs hard to isolate; new policy features require understanding entire flow.
- **Collides with active work?:** No

### [HIGH] `apps/api/src/app.ts`: 815 LOC

- **Where:** `apps/api/src/app.ts:1-815`
- **Evidence:** Bootstrap module wiring Fastify app: FastifyInstance decoration with 40+ properties, middleware registration, route registration, error handling, graceful shutdown, Sentry. Acknowledged debt in line 1–7 comment.
- **Why it matters:** Single point of failure for app startup; hard to test middleware order.
- **Fix:** bootstrap/decorate-stores.ts, bootstrap/middleware-chain.ts, app.ts (new main).
- **Effort:** L
- **Risk if untouched:** Store-wiring pattern grows ad-hoc.
- **Collides with active work?:** No

### [HIGH] `apps/api/src/routes/__tests__/whatsapp-management.test.ts`: 776 LOC

- **Where:** `apps/api/src/routes/__tests__/whatsapp-management.test.ts:1-776`
- **Evidence:** Aggregated route test covering 18 cases across 3 endpoint branches: /account, /phone-numbers, /templates. Acknowledged debt in line 1–4 comment.
- **Why it matters:** Test subjects are orthogonal routes; shared harness; hard to run one route's tests in isolation.
- **Fix:** Split into 3 test files + shared-harness.ts.
- **Effort:** M
- **Risk if untouched:** Slow test feedback when debugging one endpoint.
- **Collides with active work?:** No

### [HIGH] `packages/core/src/channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts`: 753 LOC

- **Where:** Same; 9-matrix gate tests with verbose mock setup.
- **Why it matters:** Test cases are independent scenarios; verbose mock setup repeated.
- **Fix:** Split into deterministic-gate-success.test.ts + deterministic-gate-failclosed.test.ts + shared-gate-fixtures.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`: 729 LOC

- **Where:** Same; tests approval response, patch application, expiration, delegation, execution modes.
- **Fix:** Split into platform-lifecycle-approval.test.ts + platform-lifecycle-execution.test.ts + shared-platform-fixtures.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `apps/api/src/routes/marketplace.ts`: 723 LOC

- **Where:** Same; routes covering agent listings, deployments, tasks, trust scores.
- **Fix:** Split into marketplace/listings-routes.ts, deployments-routes.ts, tasks-routes.ts, schemas.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `apps/api/src/__tests__/provision-end-to-end.test.ts`: 723 LOC

- **Fix:** Split into provision-end-to-end.test.ts (A1–A4) + provision-e2e-channels.test.ts (A5–A8) + shared-e2e-harness.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `apps/api/src/__tests__/provision-fixes.test.ts`: 676 LOC

- **Fix:** Split into provision-fixes-webhook.test.ts + provision-fixes-subscribed-apps.test.ts + shared-fixes-harness.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts`: 673 LOC

- **Fix:** Split into lifecycle-service.test.ts + lifecycle-revisions.test.ts + shared-lifecycle-stores.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/core/src/orchestrator/__tests__/propose-helpers.test.ts`: 655 LOC

- **Fix:** Split into per-helper test files (propose-guardrails, propose-policy, propose-spend, propose-context) + shared-propose-fixtures.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `apps/api/src/bootstrap/inngest.ts`: 654 LOC

- **Where:** Bootstrap module wiring Inngest client + function registration. Line 1–7 comment acknowledges debt.
- **Fix:** bootstrap/inngest-stores.ts, inngest-functions-registry.ts, inngest.ts (new main).
- **Effort:** L
- **Collides with active work?:** No

### [HIGH] `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`: 651 LOC

- **Fix:** Split into audit-runner.test.ts (new main) + shared-audit-fixtures.ts.
- **Effort:** S
- **Collides with active work?:** No

### [HIGH] `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`: 650 LOC

- **Fix:** Split into prisma-contact-store.test.ts (new main) + shared-contact-fixtures.ts.
- **Effort:** S
- **Collides with active work?:** No

### [HIGH] `apps/api/src/bootstrap/skill-mode.ts`: 648 LOC

- **Where:** Wiring SkillExecutor + tool registry + governance gates + consent service + Phase 3b qualification hook. Line 1–8 comment acknowledges debt.
- **Fix:** bootstrap/skill-mode-executor.ts, skill-mode-lifecycle.ts, skill-mode.ts (new main).
- **Effort:** L
- **Collides with active work?:** No

### [HIGH] `packages/core/src/engine/policy-engine.ts`: 632 LOC

- **Where:** PolicyEngine evaluating policies, forbidden behavior, trust, action restrictions, spending limits.
- **Fix:** Extract policy-checks.ts (pure check functions) + policy-engine.ts (orchestrator).
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts`: 622 LOC

- **Fix:** Split into whatsapp-window-gate.test.ts + whatsapp-window-gate-failclosed.test.ts + shared-gate-fixtures.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `apps/chat/src/__tests__/whatsapp.test.ts`: 614 LOC

- **Fix:** Split into whatsapp-message-parser.test.ts + whatsapp-webhook.test.ts + shared-whatsapp-fixtures.ts.
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/core/src/platform/platform-lifecycle.ts`: 613 LOC

- **Where:** PlatformLifecycle class — respondToApproval, executeAfterApproval, undo recipes, audit ledger. Acknowledged debt in line 1–5 comment.
- **Fix:** platform-lifecycle.ts (new main, respondToApproval logic) + platform-lifecycle-execution.ts (executeAfterApproval).
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/db/prisma/seed.ts`: 612 LOC

- **Fix:** seed/seed-identity.ts, seed/seed-org.ts, seed.ts (new main).
- **Effort:** M
- **Collides with active work?:** No

### [HIGH] `packages/core/src/approval/__tests__/lifecycle-service.test.ts`: 612 LOC

- **Fix:** Split + shared-lifecycle-stores.ts.
- **Effort:** S
- **Collides with active work?:** No

### [HIGH] `packages/core/src/memory/__tests__/context-builder.test.ts`: 604 LOC

- **Fix:** Split into context-builder.test.ts + context-builder-metrics.test.ts.
- **Effort:** S
- **Collides with active work?:** No

## Files 400–600 LOC (warn threshold) — flag only

(81 files. Top entries below; full list captured in /tmp/audit-file-sizes.txt during the run.)

- `apps/api/src/__tests__/cross-tenant-isolation.test.ts` — 594
- `apps/mcp-server/src/__tests__/mcp-server.test.ts` — 590
- `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` — 586 (**Collides: yes** — Riley scope exclusion)
- `apps/mcp-server/src/__tests__/api-governance-adapter.test.ts` — 580
- `packages/core/src/__tests__/engine-policy.test.ts` — 575
- `packages/ad-optimizer/src/audit-runner.ts` — 575
- `packages/core/src/skill-runtime/skill-loader.test.ts` — 574
- `packages/core/src/audit/__tests__/list-entries.test.ts` — 571
- `apps/dashboard/src/app/(auth)/(mercury)/activity/fixtures.data.ts` — 569
- `apps/api/src/routes/organizations.ts` — 569
- `packages/core/src/orchestrator/execution-manager.ts` — 567
- `apps/dashboard/src/app/(auth)/(mercury)/contacts/pipeline.module.css` — 564
- `packages/db/src/stores/prisma-work-trace-store.ts` — 560
- (~68 more files between 400–559 LOC — see `_pre-dispatch.md` for the partial list)

## Out of scope / deferred for this lane

- **Riley-related paths** per spec exclusion: 1 file flagged with Collides:yes (`riley-cockpit-page.test.tsx` — 586 LOC).
- **Local-readiness docs-only branches** — no code splits applicable.
- **Generated files** (via pnpm db:generate, .next/ builds) — excluded by find command.

## Summary metrics

- **CRITICAL (>1000 LOC):** 2 files (reports.module.css, globals.css)
- **HIGH (600–1000 LOC):** 24 files (mix of source, test, seed, config, routes)
- **MED (400–600 LOC):** 81 files flagged
