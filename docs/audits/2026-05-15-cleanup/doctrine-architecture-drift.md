# doctrine-architecture-drift

**Charter:** Verify that `docs/DOCTRINE.md` and `docs/ARCHITECTURE.md` accurately reflect current code state.

**Method:** Read both docs in full; verify key claims against current code structure and implementation; cross-reference with git history.

**Scope exclusions applied:** None applicable.

## DOCTRINE.md verification

| Section                                         | Status                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invariant 1 (One control plane)                 | STILL-TRUE — All governed actions enter through `PlatformIngress.submit()`; ingress-boundary tests pass                                                                               |
| Invariant 2 (One lifecycle spine)               | **DRIFT** — Doc states "ApprovalManager still manages approval lifecycle" but ApprovalManager was deleted 2026-04-19 (commit 7cd24569); PlatformLifecycle now owns approval lifecycle |
| Invariant 3 (One persistence truth)             | STILL-TRUE — WorkTrace written on every PlatformIngress submission                                                                                                                    |
| Invariant 4 (Governance runs once)              | STILL-TRUE — GovernanceGate.evaluate() called once in PlatformIngress.submit() line 204                                                                                               |
| Invariant 5 (Deployment context resolved once)  | STILL-TRUE — DeploymentResolver called at ingress line 176                                                                                                                            |
| Invariant 6 (Idempotency at ingress)            | STILL-TRUE — PlatformIngress.submit() line 94-96 checks idempotencyKey before any work                                                                                                |
| Invariant 7 (Dead-letter for async)             | NOT VERIFIED — see deploy-infra-parity lane: actually STILL-OPEN, 0 of 14 Inngest functions have onFailure                                                                            |
| Invariant 8 (Human override first-class)        | STILL-TRUE — PlatformLifecycle.respondToApproval handles approve/reject/patch with binding integrity                                                                                  |
| Invariant 9 (Tools strict/auditable/idempotent) | NOT VERIFIED — out of scope here                                                                                                                                                      |
| Invariant 10 (Channel is ingress)               | NOT VERIFIED — out of scope here                                                                                                                                                      |
| Legacy Bridge §104-119 ApprovalManager          | **DRIFT** — file deleted; registry entry stale                                                                                                                                        |
| Legacy Bridge §104 LifecycleOrchestrator        | STILL-TRUE                                                                                                                                                                            |
| Legacy Bridge §105 ExecutionService             | STILL-TRUE                                                                                                                                                                            |
| Legacy Bridge §107 CartridgeMode                | STILL-TRUE                                                                                                                                                                            |
| Legacy Bridge §109 ProposePipeline              | STILL-TRUE                                                                                                                                                                            |
| Legacy Bridge §111 ExecutionManager             | STILL-TRUE                                                                                                                                                                            |
| Legacy Bridge §116 data-flow/                   | STILL-TRUE                                                                                                                                                                            |
| Legacy Bridge §117 enrichment/                  | STILL-TRUE (confirmed deleted in Phase 5)                                                                                                                                             |

## ARCHITECTURE.md verification

| Section                        | Status                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 packages/schemas            | STILL-TRUE                                                                                                                                        |
| §2 packages/cartridge-sdk      | STILL-TRUE                                                                                                                                        |
| §3a-l packages/core subsystems | **DRIFT** at §3e and §3k — references deleted ApprovalManager                                                                                     |
| §3g Audit System               | STILL-TRUE                                                                                                                                        |
| §4 packages/db                 | STILL-TRUE                                                                                                                                        |
| §5-9 Cartridges                | **DRIFT** — describes 5 cartridges in detail (customer-engagement, digital-ads, crm, payments, revenue-growth) but no cartridge directories found |
| §11-14 Applications            | MOSTLY-TRUE — but route table claims 27 routes, lists 12; actual count 66                                                                         |
| §10 (missing)                  | **DRIFT** — Document jumps from §9 to §11; no §10                                                                                                 |

## Findings

### [CRITICAL] ApprovalManager documentation drift — approval lifecycle migrated but docs not updated

- **Where:** `docs/DOCTRINE.md` (§2, §3, Legacy Bridge Registry §110); `docs/ARCHITECTURE.md` (§3e and §3k)
- **Evidence:**
  - DOCTRINE.md: "Current gap: Approval lifecycle is still managed by ApprovalManager in the old orchestrator" (§2)
  - DOCTRINE.md: "Envelopes remain only for the legacy approval lifecycle managed by ApprovalManager" (§3)
  - ARCHITECTURE.md §3e: "Approval Manager (`orchestrator/approval-manager.ts`): Responds to approvals..."
  - Reality: `packages/core/src/orchestrator/approval-manager.ts` DELETED (commit 7cd24569, 2026-04-19); `packages/core/src/platform/platform-lifecycle.ts:72` now contains `respondToApproval`
- **Why it matters:** Developers reading DOCTRINE.md believe approval lifecycle is unmigrated debt when it is actually complete. The docs misrepresent current architecture and may mislead Phase 2 planning or audit conclusions.
- **Fix:** Update DOCTRINE.md §2, §3, Legacy Bridge Registry §110 to reflect that PlatformLifecycle owns approval lifecycle. Update ARCHITECTURE.md §3e to reference PlatformLifecycle. Mark Phase 2 as complete.
- **Effort:** S
- **Risk if untouched:** Doctrine misrepresents implementation; misleads planning
- **Collides with active work?:** no

### [HIGH] Cartridge documentation unclear — five cartridges described as implemented, but no cartridge code directories exist

- **Where:** `docs/ARCHITECTURE.md` §5–9 (~150 lines)
- **Evidence:** Detailed descriptions of customer-engagement, digital-ads, crm, payments, revenue-growth (specific action counts, named classes, external API integrations). But:
  - No `/Users/jasonli/switchboard/cartridges/` directory
  - No `/Users/jasonli/switchboard/packages/customer-engagement/` etc.
  - References exist only in code examples/tests (tool-registry, planning tests)
- **Why it matters:** Readers cannot verify claims; cannot find implementation; may spend time searching for nonexistent code
- **Fix:** Either (a) clarify cartridges are aspirational/abstract, (b) move sections to a separate "Cartridge Design Specification" document, or (c) remove cartridge sections if obsolete
- **Effort:** M (depends on owner intent)
- **Risk if untouched:** Doc misleads about codebase contents
- **Collides with active work?:** no

### [HIGH] ARCHITECTURE.md §3 references deleted ApprovalManager

- **Where:** `docs/ARCHITECTURE.md` §3e
- **Evidence:** Cited file path `orchestrator/approval-manager.ts` does not exist
- **Why it matters:** Reader cannot follow file path; section invalid
- **Fix:** Update §3e to reference PlatformLifecycle
- **Effort:** S
- **Collides with active work?:** no

### [MED] ARCHITECTURE.md missing §10 with no explanation

- **Where:** `docs/ARCHITECTURE.md` — between §9 (Revenue Optimization) and §11 (apps/api)
- **Evidence:** No §10 exists; no note explaining the gap
- **Why it matters:** Reader assumes error or that intermediate section was deleted
- **Fix:** Either restore §10 (if forgotten) or add a note explaining the gap
- **Effort:** S
- **Collides with active work?:** no

### [MED] ARCHITECTURE.md route table incomplete — claims 27 routes, documents 12

- **Where:** `docs/ARCHITECTURE.md` §11 (lines 493-514)
- **Evidence:** Table shows 12 route paths; actual count in `apps/api/src/routes/*.ts` is 66 route files
- **Why it matters:** 54 routes undocumented; misleads about API surface
- **Fix:** Either expand table, or rephrase as "key routes" not comprehensive, or rely on OpenAPI/Swagger elsewhere
- **Effort:** M
- **Collides with active work?:** no

### [LOW] DOCTRINE.md §3 envelope-bridge reference outdated

- **Where:** `docs/DOCTRINE.md` §3
- **Evidence:** "Envelopes remain only for the legacy approval lifecycle managed by ApprovalManager" — ApprovalManager deleted
- **Fix:** Clarify what envelopes remain and for what purpose
- **Effort:** S
- **Collides with active work?:** no

### [LOW] DOCTRINE.md last-updated date stale

- **Where:** `docs/DOCTRINE.md` line 4
- **Evidence:** "Last updated: 2026-04-18" — pre-dates ApprovalManager deletion (2026-04-19) and multiple subsequent changes
- **Fix:** Update timestamp to reflect actual last review/update
- **Effort:** S
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- Verification of async dead-letter paths (Invariant 7) — handled by deploy-infra-parity lane
- Verification of tool audit/idempotency (Invariant 9)
- Verification of channel-to-ingress flow (Invariant 10)
- Comprehensive verification of all 66 API routes
- Detailed examination of ARCHITECTURE.md non-package sections (Infrastructure, CI/CD, Marketplace)
