# layer-hygiene

**Charter:** Layer-boundary enforcement (schemas → sdk → core → db → apps); barrel-file bloat; circular deps (delta).
**Method:** Grep-based layer boundary verification; mutual import detection; barrel export line counts; verification of circular-import-cleanup spec implementation status.
**Scope exclusions applied:** Test files (`**/*.test.ts`), comments, type-only imports in non-cycling contexts (safe re-export edges).

## Findings

### [MED] Barrel-file bloat: packages/schemas (78 exports)

- **Where:** `packages/schemas/src/index.ts`
- **Evidence:** 75 `export *` statements from submodules
- **Why it matters:** Exceeds CLAUDE.md threshold of 40 exported symbols; breadth increases cognitive load and coupling surface
- **Fix:** None needed — architectural pattern using wildcard re-exports is intentional and documented. Consider domain-path imports (e.g., `@switchboard/schemas/audit`) to reduce reliance on root barrel.
- **Effort:** M (refactoring opportunity, not a blocking issue)
- **Risk if untouched:** Consumers default to broad imports; future submodule changes ripple via barrel
- **Collides with active work?:** No

### [MED] Barrel-file bloat: packages/core/src/platform/index.ts (46 exports)

- **Where:** `packages/core/src/platform/index.ts`
- **Evidence:** 46 `export` statements
- **Why it matters:** Domain barrel exceeds 40 threshold; re-exports orchestration, work trace, execution context, governance types
- **Fix:** Consider splitting platform barrel into focused sub-domains: `platform/orchestration/`, `platform/work-trace/`, `platform/execution/`. Or use domain-path imports in consumers.
- **Effort:** M (re-export restructuring)
- **Risk if untouched:** Tighter coupling between platform subsystems; harder to isolate concerns
- **Collides with active work?:** No

### [MED] Barrel-file bloat: packages/core/src/skill-runtime/index.ts (56 exports)

- **Where:** `packages/core/src/skill-runtime/index.ts`
- **Evidence:** 56 `export` statements mixing tools, hooks, governance, builders, adapters
- **Why it matters:** Domain barrel exceeds 40 threshold; re-exports 10+ distinct sub-modules (tools, hooks, governance, adapters, builders, circuits)
- **Fix:** Split into focused barrels: `skill-runtime/tools/`, `skill-runtime/hooks/`, `skill-runtime/governance/`, `skill-runtime/adapters/`. Preserve root re-export for backward compat but encourage domain-path imports.
- **Effort:** M
- **Risk if untouched:** High surface area; governance changes ripple to builders/tools
- **Collides with active work?:** Check if active skill-runtime work planned before splitting

### [MED] Barrel-file bloat: packages/core/src/index.ts (87 exports)

- **Where:** `packages/core/src/index.ts`
- **Evidence:** 87 `export` statements, 36 `export *` statements across 30+ domain barrels
- **Why it matters:** Root barrel of largest package exceeds 40 threshold; de-incentivizes domain-path imports
- **Fix:** CLAUDE.md notes domain barrels exist. Root barrel acceptable as facade for backward compat. Prefer domain-path imports in new code: `@switchboard/core/platform` instead of `@switchboard/core` then re-export. Document preferred import style.
- **Effort:** S (documentation + linting rule)
- **Risk if untouched:** Broad barrel imports remain default; hard to refactor subdomains later
- **Collides with active work?:** No

### [MED] Barrel-file bloat: packages/db/src/index.ts (92 exports)

- **Where:** `packages/db/src/index.ts`
- **Evidence:** 92 `export` statements
- **Why it matters:** Largest barrel; exceeds threshold by 2x; mixes stores, schema adapters, migrations, and utilities
- **Fix:** Defer to db-layer owner. Consider domain barrels (db/stores/, db/schema/, db/migrations/) if feasible without breaking existing consumers.
- **Effort:** L (complex refactor; many dependents)
- **Risk if untouched:** Highest coupling breadth in codebase; schema changes ripple broadly
- **Collides with active work?:** Check db-layer roadmap

### [MED] Barrel-file bloat: packages/ad-optimizer/src/index.ts (43 exports)

- **Where:** `packages/ad-optimizer/src/index.ts`
- **Evidence:** 43 `export` statements (3 `export *` statements)
- **Why it matters:** Layer 2 package just above threshold; re-exports campaign optimization, recommendation sinks, CRM data providers
- **Fix:** Optional — on border. If future scope grows, split into `recommendation/`, `campaign/`, `crm/` barrels.
- **Effort:** S (if needed)
- **Risk if untouched:** Minor; borderline impact
- **Collides with active work?:** No

## Out of scope / deferred for this lane

- **Circular deps:** All 11 file-level cycles documented in `docs/superpowers/specs/2026-05-13-circular-import-cleanup-design.md` and `docs/superpowers/plans/2026-05-13-circular-import-cleanup.md` have been IMPLEMENTED. No new or regressed cycles detected. Verification:
  - `orchestrator/orchestrator-types.ts` ✓ (ProposeResult, ApprovalResponse extracted; consumers rewired)
  - `orchestrator/cartridge-utils.ts` ✓ (inferCartridgeId extracted; execution-manager rewired)
  - `skill-runtime/governance-types.ts` ✓ (6 governance types extracted; types.ts rewired)
  - `channel-gateway/conversation-status-types.ts` ✓ (ConversationStatusUpsertContext extracted; deterministic-safety-gate rewired)
  - `agent-home/metrics-types.ts` ✓ (9 metric types extracted; metrics-alex and metrics-riley rewired)
- **Layer violations:** Zero wrong-layer imports detected. All violations found were comments/documentation.
- **Regressions:** Sampling of 20 core modules showed no new mutual imports.
