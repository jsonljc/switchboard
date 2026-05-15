# cartridge-sdk-removal-readiness

**Charter:** Wind-down inventory for packages/cartridge-sdk. Classify consumers HARD/SOFT/TRIVIAL; propose removal order.

**Method:** `rg -l '@switchboard/cartridge-sdk'` to enumerate 29 consumer files; examined each for import type (type-only vs runtime values), production vs test context, and migration path. Cross-referenced with Layer 3 dependency rules in CLAUDE.md (core depends on cartridge-sdk). Verified that all Cartridge/ExecuteResult/CartridgeInterceptor/CartridgeContext types are re-exported from @switchboard/schemas in cartridge-types.ts, and guarded runtime code (GuardedCartridge) is already defined in core/execution-guard.ts.

**Scope exclusions applied:**

- Standard test spec mask (_.test.ts, **tests**/_) — these are SOFT-BLOCKERs but trivial to migrate
- Self-references (packages/cartridge-sdk/src/parse-params.ts is a comment example, not a real import)

## Consumer inventory

### HARD-BLOCKER (production code path; requires migration before deletion)

**None.** All production imports in Layer 3+ are type-only. The orchestrator (core) uses types for interfaces, but the actual Cartridge implementations come from external cartridge packages (not from cartridge-sdk itself).

### SOFT-BLOCKER (test/fixture only; trivial migration)

All 29 consumers below fall into this category. The vast majority import test helpers (TestCartridge, createTestManifest) or type-only interfaces.

**Type-only imports (migrate to @switchboard/schemas):**

- `packages/core/src/execution-guard.ts:1-6` — imports Cartridge, CartridgeContext, CartridgeInterceptor, ExecuteResult (types only; used for GuardedCartridge<T> wrapper)
- `packages/core/src/storage/interfaces.ts:13` — imports Cartridge, CartridgeInterceptor (types only; CartridgeRegistry interface)
- `packages/core/src/storage/in-memory.ts:14` — imports Cartridge, CartridgeInterceptor (types only; constructor parameters)
- `packages/core/src/orchestrator/propose-helpers.ts:7` — imports Cartridge (types only; function parameter)
- `packages/core/src/orchestrator/plan-pipeline.ts:9` — imports ExecuteResult (types only; parameter signature)
- `packages/core/src/orchestrator/propose-pipeline.ts` — imports ExecuteResult (types only)
- `packages/core/src/orchestrator/lifecycle.ts` — imports ExecuteResult (types only)
- `packages/core/src/orchestrator/orchestrator-types.ts` — imports ExecuteResult (types only)
- `packages/core/src/orchestrator/runtime-orchestrator.ts` — imports ExecuteResult (types only)
- `packages/core/src/orchestrator/execution-manager.ts:9-10` — imports ExecuteResult (types only; function signatures)
- `packages/core/src/orchestrator/circuit-breaker-wrapper.ts:1` — imports ExecuteResult (types only)
- `packages/core/src/platform/platform-lifecycle.ts:8` — imports ExecuteResult (types only)
- `packages/core/src/runtime-adapters/types.ts:2` — imports ExecuteResult (types only; interface field)

**Test fixtures (migrate to internal test helpers or @switchboard/schemas):**

- `packages/core/src/__tests__/orchestrator-lifecycle.test.ts` — imports TestCartridge, createTestManifest
- `packages/core/src/__tests__/orchestrator-auth.test.ts` — same
- `packages/core/src/__tests__/orchestrator-plan.test.ts` — same
- `packages/core/src/__tests__/orchestrator-guardrails.test.ts` — same
- `packages/core/src/__tests__/governance-profiles.test.ts` — same
- `packages/core/src/__tests__/orchestrator-propose.test.ts` — same
- `packages/core/src/__tests__/semver-registry.test.ts` — same
- `packages/core/src/__tests__/storage.test.ts:1` — imports Cartridge (types only; mock interface)
- `packages/core/src/__tests__/execution-guard.test.ts:1` — imports Cartridge, CartridgeContext, ExecuteResult + GuardedCartridge helper
- `packages/core/src/orchestrator/__tests__/plan-pipeline.test.ts` — imports ExecuteResult (types only)
- `packages/core/src/orchestrator/__tests__/helpers.ts` — imports ExecuteResult (types only; test utility)
- `packages/core/src/orchestrator/__tests__/circuit-breaker-wrapper.test.ts` — imports ExecuteResult (types only)
- `packages/core/src/platform/__tests__/cartridge-mode.test.ts:1` — imports ExecuteResult (types only; test fixture)
- `apps/api/src/__tests__/test-server.ts` — imports TestCartridge, createTestManifest (test harness setup)
- `apps/mcp-server/src/__tests__/mcp-server.test.ts` — imports TestCartridge, createTestManifest (test harness setup)

### TRIVIAL (dead export, safe to delete)

- **ActionBuilder, action** — Exported by cartridge-sdk but zero real-world callers outside internal cartridge-sdk tests.
- **ExecuteResultBuilder, failResult** — Used only in cartridge-sdk internal tests; real cartridge implementations define their own result shapes.
- **validateConnection, CartridgeConnectionConfig** — Never imported outside cartridge-sdk.
- **validateManifest, validateCartridge, ValidationResult** — Only used in cartridge-sdk's own test suite.
- **CartridgeTestHarness, HarnessReport, HarnessOptions** — Only used in cartridge-sdk tests.
- **SERVICE_REGISTRY, getServiceById, getServiceByCartridge** — Never called outside cartridge-sdk.
- **parseParams, ParamValidationError** — Only documented in internal comments; zero callers outside cartridge-sdk tests.

## Findings

### [CRITICAL] Types are duplicated between cartridge-sdk and @switchboard/schemas

- **Where:** packages/cartridge-sdk/src/cartridge.ts re-exports from @switchboard/schemas; packages/schemas/src/cartridge-types.ts defines Cartridge, CartridgeContext, CartridgeInterceptor, ExecuteResult
- **Evidence:** All 13 type-only imports in core/src could be satisfied by adding one line: `export * from "./cartridge-types.js";` is already in packages/schemas/src/index.ts
- **Why it matters:** cartridge-sdk is a pure re-export wrapper for interface types. Removing it requires only updating import statements in 13 files, not code logic changes.
- **Fix:** Search-replace all `import type { X } from "@switchboard/cartridge-sdk"` → `import type { X } from "@switchboard/schemas"` in 13 files
- **Effort:** S (13 import statements, no logic change)
- **Risk if untouched:** Layer violation — core depends on cartridge-sdk only for types already available in Layer 1 (schemas)
- **Collides with active work?:** No

### [HIGH] Test fixtures (TestCartridge, createTestManifest) block cartridge-sdk deletion

- **Where:** 8 test files in packages/core/src/**tests**/ + 2 in apps/{api,mcp-server}
- **Evidence:** 14 import statements of TestCartridge/createTestManifest; all in .test.ts files only
- **Why it matters:** TestCartridge is defined in cartridge-sdk/src/testing.ts and is the canonical test double for all cartridge interfaces. Creating an internal in-memory test double would reduce external coupling.
- **Fix:** Move TestCartridge + createTestManifest logic into packages/core/src/test-helpers/mock-cartridge.ts, update 10 import statements
- **Effort:** M (116 lines from testing.ts need to be moved, some deps rewritten, 10 imports updated)
- **Risk if untouched:** Prevents cartridge-sdk removal; blocks cleanup of pendingRemoval status
- **Collides with active work?:** No

### [HIGH] GuardedCartridge wrapper is a hard dependency of core's orchestration

- **Where:** packages/core/src/execution-guard.ts (guardian of the orchestrator's execute() gate); used by storage/in-memory.ts and orchestrator/execution-manager.ts
- **Evidence:** GuardedCartridge is already defined in core (not imported from cartridge-sdk); imports only types from cartridge-sdk
- **Why it matters:** GuardedCartridge is the core's own guard implementation, unrelated to removal. Replacing the type imports with schemas imports causes no functional change.
- **Fix:** Change execution-guard.ts imports from `@switchboard/cartridge-sdk` to `@switchboard/schemas`
- **Effort:** S (one import statement)
- **Risk if untouched:** None — this file already belongs in core; it's correctly scoped
- **Collides with active work?:** No

### [HIGH] Layer 3 (core) over-imports for test infrastructure

- **Where:** All 8 core test files importing TestCartridge; all 2 app test files importing TestCartridge
- **Evidence:** TestCartridge is a 116-line testing harness with manifest builder, designed to satisfy cartridge interface for test mocks
- **Why it matters:** Each test that uses TestCartridge is tightly coupled to cartridge-sdk's test infrastructure, which violates the Layer 3 rule: "core → schemas + cartridge-sdk + sdk" but should prefer a thin in-core test double.
- **Fix:** Create packages/core/src/test-helpers/create-test-cartridge.ts with minimal manifest builder (reuses @switchboard/schemas CartridgeManifest type)
- **Effort:** M (extract 50–80 lines of logic from cartridge-sdk testing.ts, adapt to schemas-only imports)
- **Risk if untouched:** Requires external test library; blocks full cartridge-sdk removal
- **Collides with active work?:** No

### [MED] App packages (api, mcp-server, chat) have unused cartridge-sdk dependency

- **Where:** apps/api/package.json, apps/mcp-server/package.json, apps/chat/package.json list @switchboard/cartridge-sdk
- **Evidence:** Only apps/api and apps/mcp-server actually import it (in test files only); apps/chat lists it but never uses it
- **Why it matters:** Unused dependencies inflate bundle size and add transitive dependency risk
- **Fix:** Remove @switchboard/cartridge-sdk from apps/chat/package.json; verify removal doesn't break build (apps/api + mcp-server will still use it for test harness until TestCartridge is migrated)
- **Effort:** S (one line per package.json, verify no breakage)
- **Risk if untouched:** Cleaner dep tree, but not a blocker for cartridge-sdk removal
- **Collides with active work?:** No

### [MED] cartridge-sdk exports never used (ActionBuilder, ExecuteResultBuilder, etc.)

- **Where:** packages/cartridge-sdk/src/{action-builder.ts, result-builder.ts, validation.ts, service-registry.ts}
- **Evidence:** Zero real-world consumers outside internal tests; each export exists only in exported index.ts and internal test suites
- **Why it matters:** Dead code increases maintenance burden; if no external consumer relies on ActionBuilder, it should be removed from the public API (or moved to test-only export)
- **Fix:** Delete or move to internal test directory: action-builder.ts, result-builder.ts, executeResultBuilder export, service-registry exports
- **Effort:** M (clean up index.ts, remove unused files, verify no external consumer breakage)
- **Risk if untouched:** Exposes unused API surface; inflates cartridge-sdk's footprint unnecessarily
- **Collides with active work?:** No

### [LOW] parse-params export exists for documentation but zero callers

- **Where:** packages/cartridge-sdk/src/parse-params.ts (line 1 is a comment with example usage)
- **Evidence:** The file is exported in index.ts but zero files actually call it; only an example in JSDoc
- **Why it matters:** Utility function useful for cartridge authors to validate action parameters; removal would harm DX if external cartridges use it (unlikely, but possible)
- **Fix:** Audit git history for external usage; if no external consumer found, move to test-only or example directory, remove from public export
- **Effort:** M (search external integrations, decide keep/move/remove)
- **Risk if untouched:** Low — used only in examples, but better to confirm before deletion
- **Collides with active work?:** No

## Suggested removal order

1. **Replace type imports (cartridge-sdk → schemas) in 13 core files** — Effort S. Unblocks later steps. No functional change; purely import path updates.
   - packages/core/src/execution-guard.ts
   - packages/core/src/storage/interfaces.ts
   - packages/core/src/storage/in-memory.ts
   - packages/core/src/orchestrator/\*.ts (propose-helpers, plan-pipeline, propose-pipeline, lifecycle, orchestrator-types, runtime-orchestrator, circuit-breaker-wrapper, execution-manager)
   - packages/core/src/platform/platform-lifecycle.ts
   - packages/core/src/runtime-adapters/types.ts

2. **Create test double (InMemoryCartridge/TestCartridge → core/test-helpers)** — Effort M. Creates zero-dependency test cartridge usable by all core tests.
   - Create packages/core/src/test-helpers/create-test-cartridge.ts with minimal builder
   - Reuse @switchboard/schemas CartridgeManifest type
   - Update 10 test imports (core + apps test files)

3. **Update app test imports to use core's test-helpers** — Effort S. Enables removal of cartridge-sdk from app dependencies.
   - apps/api/src/**tests**/test-server.ts
   - apps/mcp-server/src/**tests**/mcp-server.test.ts
   - Remove @switchboard/cartridge-sdk from their package.json

4. **Prune unused cartridge-sdk exports** — Effort M. Clean up before final deletion.
   - Delete or move to test-only: ActionBuilder, ExecuteResultBuilder, validateManifest, etc.
   - Remove from index.ts
   - Verify no external consumer breakage (search git log + package downloads)

5. **Audit parse-params usage and plan migration** — Effort M. Low risk but worth confirming.

6. **Remove @switchboard/cartridge-sdk from packages/core/package.json** — Effort S. Final step.

## Out of scope / deferred for this lane

- **Cartridge implementations in external packages** — This audit focuses only on Switchboard monorepo consumers. External cartridges (e.g., ad-optimizer, creative-pipeline if they define Cartridge subclasses) are out of scope.
- **API surface stability** — No published API contract found; can remove exports as needed.
