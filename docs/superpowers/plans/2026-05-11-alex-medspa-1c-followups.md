# Phase 1c follow-ups

## Regulatory-review handoff

- **Owner:** TBD before pilot launch.
- **Scope:** Review SG/MY disclosure copy in `packages/core/src/consent/disclosure-copy.ts`; review SG/MY revocation keyword seeds in `packages/core/src/consent/revocation-keywords/`. Conservative seeds shipped in 1c; expansion belongs to a Phase 1c.5 (or rolled into 1b-1.5).
- **Target:** 2 weeks after 1c merge.

## Pilot-tenant consent state authoring

- Authoring grants/revocations via `POST /api/admin/consent/*`. No dashboard UI in 1c.
- First 5–10 grants seeded manually for the pilot tenant before enforce-mode promotion.

## Phase 1d `messageClass: "proactive"` call site

- 1d proactive sender calls `evaluateConsentGate({ messageClass: "proactive" })` directly. No further bootstrap change required from 1c.

## Disclosure-detection hardening

- v1 substring match is fragile against punctuation/whitespace/markdown drift.
- If pilot data shows missed disclosure stamps despite skill instruction, harden detection (regex with whitespace tolerance, or sentinel marker injected by skill output) in Phase 2/3.

## Multi-match revocation analytics

- v1 captures `matches[0]` only. Phase 3 analytics may want full multi-match context.

## Cross-deployment Contact governance

- v1 stamp is immutable. If a future product surface lets a Contact interact with deployments at different jurisdictions, reconcile then.

## Re-grant ergonomics

- v1 requires admin `clearConsent` to start a fresh cycle. If pilot shows frequent operator friction, add a `recordRegrant` method that explicitly clears revocation in one call.

## ConsentService per-call deployment binding (NEW from Task 13)

- v1 limit: `createConsentService` takes `deploymentId`, `orgId`, `clinicType` at construction time. Bootstrap (`apps/api/src/bootstrap/skill-mode.ts` + `apps/chat/src/gateway/gateway-bridge.ts`) constructs single per-process instances with placeholder values (`deploymentId: "system:consent-service"`, `orgId: "system"`, `clinicType: "medical"`).
- For the pilot envelope (one governed deployment per tenant) this is acceptable. Verdicts emitted by the service carry the placeholder `deploymentId`, which is correct in single-tenant contexts but wrong if a tenant ever runs multiple governed deployments.
- Phase 2 refactor: change `ConsentService` methods to accept verdict-context (`deploymentId`, `orgId`, `clinicType`) per call, supplied by the caller (`PdpaConsentGateHook` from `ctx`, gateway revocation gate from its config, admin endpoint from the request's deployment context). Drop the constructor-time bindings.
- Tracked as the most material design gap in the 1c implementation.

## Chat-process ConsentService duplication (NEW from Task 13)

- The api process (`bootstrapSkillMode`) and the chat process (`createGatewayBridge`) each construct their own `ConsentService` instance against the same Prisma database. This is intentional: in-memory dependencies (posture cache, etc.) cannot cross process boundaries.
- After the Phase 2 refactor of `ConsentService` to be deployment-agnostic at construction, this duplication remains but is benign — both instances are equivalent because all state lives in Prisma.

## TracePersistenceHook documentation drift (NEW from review)

- Several comments in `apps/api/src/bootstrap/skill-mode.ts` and `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts` reference "TracePersistenceHook" and "before TracePersistenceHook" in their rationale. The hook exists at `packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts` but is never registered in the production hook array. Either register it (and update the hook-ordering test to include it) or sweep the comments to stop referencing a non-existent hook. Captured for cleanup; not a 1c regression.
