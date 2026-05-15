# dead-code

**Charter:** Orphan files, unreferenced exports, dead handlers. Two sub-audits: Store call-sites + general orphans.
**Method:** For (a): rg-based grep search for each Store class name in packages/apps to find import statements and instantiations; dynamic imports traced through bootstrap files. For (b): spot checks on dead handler files, dead routes, and export-reference analysis; depcheck not available so manual export scanning across key packages.
**Scope exclusions applied:**

- packages/cartridge-sdk (owned by cartridge-sdk-removal-readiness lane per charter)
- `.next/`, `node_modules/`, `dist/` directories
- Test files (\*.test.ts)
- Generated files (\*.d.ts)

## (a) Store call-site audit

### [HIGH] PrismaCredentialResolver: orphan / never instantiated

- **Where:** `packages/db/src/storage/prisma-credential-resolver.ts:31` (class definition), `packages/db/src/storage/index.ts:11` (exported), `packages/db/src/index.ts:42` (re-exported)
- **Evidence:** Exported from index.ts but zero references to `new PrismaCredentialResolver(...)` across packages/apps. Defined as resolver for cartridge-specific credentials but no call site wires it into dependency injection.
- **Why it matters:** Dead code bloats the export surface; class interface and docstrings suggest it was planned but never wired to execution path. Increases maintainability burden (future changes must account for a path that's never used).
- **Fix:** Either (1) wire into ConnectionCredentialResolver DI at bootstrap, or (2) remove export from db/index.ts and storage/index.ts, delete the class.
- **Effort:** S (remove) / M (wire)
- **Risk if untouched:** Low — interface is complete and tests cover class logic; no runtime breakage risk. Main risk is confusion during refactors ("why is this here?").
- **Collides with active work?:** no

### Status of remaining 14 Stores

All have ≥1 external caller (PASS): PrismaEnvelopeStore, PrismaPolicyStore, PrismaIdentityStore, PrismaApprovalStore, PrismaCompetenceStore, PrismaConnectionStore, PrismaGovernanceProfileStore, PrismaLedgerStorage, PrismaSessionStore, PrismaRunStore, PrismaPauseStore, PrismaToolEventStore, PrismaRoleOverrideStore, PrismaLifecycleStore. Caller counts range 1–3; instantiation sites are bootstrap files (`apps/api/src/app.ts`, `apps/api/src/bootstrap/*`) and `apps/chat/src/managed/*`.

## (b) General orphan sweep

### [HIGH] Unreferenced export: PrismaCredentialResolver

- **Where:** `packages/db/src/index.ts:42` (re-export), `packages/db/src/storage/index.ts:11` (storage-level export)
- **Evidence:** 0 imports or instantiations across packages/apps; defined but never used in production code
- **Why it matters:** Public API surface bloat; confuses consumers about which resolvers are wired; maintenance tax on unused interface
- **Fix:** Remove from exports (or wire into DI if intentional); confirm against historical commits (may be pre-planned but not yet integrated)
- **Effort:** S
- **Risk if untouched:** None runtime; semantic debt only
- **Collides with active work?:** no

## Delta against `.audit/08-launch-blocker-sequence.md`

The launch-blocker audit (2026-04-29) mentions:

> "Orphaned Stores in db layer (zero callers)" — POST-LAUNCH priority

Current status: 14 of 15 stores now have ≥1 external caller. The 1 orphan (PrismaCredentialResolver) was not listed in the prior audit, indicating it may have been added or overlooked. This finding escalates it to HIGH in the current audit as a removal or wiring candidate.

## Out of scope / deferred for this lane

- **cartridge-sdk dead exports** — owned by cartridge-sdk-removal-readiness lane (Batch B sibling). Audit spotted no cartridge-sdk-only store orphans.
- **Dashboard type-safety debt** — separate lane (type-safety).
- **Circular-dependency cleanup** — covered by layer-hygiene lane (Batch A).
- **Feature flags** — no active GrowthBook/FF\_\* patterns found in codebase; all governance uses policy-engine.
- **E2E test framework** — outside scope per design spec.
