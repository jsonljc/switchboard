# Operator-Direct Ingress Migration Pattern — Design

**Date:** 2026-05-15
**Status:** Spec — pending user review
**Source:** Wave 2 Phase 1 of the architecture cleanup audit (synthesis at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit.md`, Phase 0 triage at `docs/audits/2026-05-15-cleanup/_phase-0-triage.md`).

## Goal

Define the canonical migration pattern for moving an **operator-initiated**, **synchronous**, **business-state-mutating** route from a direct service call to `PlatformIngress.submit()`. Apply the pattern to the 3 unblocked Phase 1 routes (`dashboard-opportunities.ts`, `recommendations.ts`, `admin-consent.ts`) as Phase 1b — `lifecycle-disqualifications.ts` is blocked by PR #444 and deferred.

This is the load-bearing prerequisite for the larger **Design A — Mutating Route Contract** in Wave 2 Phase 3A. The "operator-direct" classification is one of four route shapes that contract will recognize.

## Constraints

- **Doctrine invariants** (recap from `docs/DOCTRINE.md` and `CLAUDE.md`):
  - Mutating actions enter through `PlatformIngress.submit()`.
  - WorkTrace is canonical persistence.
  - Governance runs once.
  - Idempotency at ingress.
- **No new mutating bypass paths** — even temporarily.
- **No new execution mode unless necessary.** Three modes exist (`cartridge-mode`, `skill-mode`, `workflow-mode`); we prefer reuse over a fourth.
- **No design for the broader 90-route contract here** — that's Design A. This pattern covers operator-direct routes only.

## Current state (code-grounded)

After reading `packages/core/src/platform/platform-ingress.ts`, the three mode files, `apps/api/src/bootstrap/contained-workflows.ts`, and `apps/api/src/routes/actions.ts`:

- **`type: "user"` actors are already supported** — used in `actions.ts`, `execute.ts`, `governance.ts`, `dashboard-opportunities.ts`, `convergence-e2e.test.ts`, and others. No change needed at PlatformIngress.
- **The closest existing exemplar is `actions.ts`** — a generic operator-facing ingress entry point. It demonstrates user-actor intents flowing through PlatformIngress for arbitrary `{ intent, parameters }`. It does NOT, however, register the intents — that's the gap.
- **`WorkflowMode` is too heavy for a single synchronous service call.** Its `WorkflowHandler` interface returns `{ outcome: "queued" | "completed" | "failed" | "pending_approval"; summary; outputs?; error? }` and accepts `WorkflowRuntimeServices` for orchestrating child work. For `transitionOpportunityStage` (one synchronous call, no children), this works mechanically but adds ceremony.
- **No existing "operator-direct" execution mode.** Operator routes currently either flow through `actions.ts` (generic) or bypass ingress entirely (the 4 routes Phase 1 is migrating).

## The 5 decisions

### Decision 1 — Execution mode: reuse `WorkflowMode` with a thin handler

**Choice:** Use `WorkflowMode` with a single-step `WorkflowHandler` that just invokes the existing service function and returns `outcome: "completed"`. **Do not introduce a new "operator-direct" mode.**

**Rationale:** A new mode would add a 4th execution path with its own governance hooks, audit shape, and test surface. We don't have enough distinct operator-direct intents (3 from Phase 1, ~5–10 from the eventual Mutating Route Contract) to justify it. `WorkflowMode` works correctly for single-step intents; the "workflow" name is a misnomer here but the semantics fit.

**Re-evaluate at:** if we reach >15 operator-direct intents, or if we need an operator-direct-specific governance treatment (e.g., always auto-approve, no policy lookup), then carve out a thin `OperatorDirectMode` that subclasses or sits beside `WorkflowMode`.

### Decision 2 — Actor shape: keep `{ id: principalId, type: "user" }`

**Choice:** Routes pass `{ id: principalIdFromAuth, type: "user" }` to `platformIngress.submit()`. No change to the existing actor type.

**Rationale:** Already supported and tested. `principalIdFromAuth` is the existing convention for user-typed actors in API routes.

**Edge case:** if `principalIdFromAuth` is unset (rare in production with auth middleware; possible in dev-mode test paths), fall back to `"unknown"` and tag the audit ledger entry with `actor.degraded: true` for visibility. Apply this fallback in a shared route helper, not per-route.

### Decision 3 — Governance gate: low-risk constraint with explicit `autoApprove: true`

**Choice:** Each operator-direct intent registers an `IntentRegistration` with risk constraints `{ category: "low", autoApprove: true }`. The governance gate evaluates and short-circuits to "approved" without requiring policy lookup or approval routing.

**Rationale:** Operator-direct intents are user-initiated actions on data the operator already has scoped access to (the org's own opportunities, consents, recommendations). The governance gate's value here is the **audit trail + WorkTrace persistence**, not approval gating. Forcing every stage transition through approval would break product UX. If future policy demands approval for some operator action (e.g., `closed_won` on opportunities >$X), it can be added per-intent without changing the pattern.

**Cross-check:** confirm `GovernanceGate.evaluate` short-circuits cleanly when `autoApprove: true` — needs verification during implementation (1 test case). If not, the intent registration grows a small auto-approve helper.

### Decision 4 — Intent registration site: new `bootstrap/operator-intents.ts`

**Choice:** Create a new bootstrap file `apps/api/src/bootstrap/operator-intents.ts` that registers all operator-direct intents (Phase 1: 5 intents from 3 routes; future: more from Design A). Call from `apps/api/src/app.ts` alongside `bootstrapContainedWorkflows` and `bootstrapSkillMode`.

**Rationale:**
- `bootstrap/contained-workflows.ts` is workflow-orchestration-specific (mode dispatch, child work). Adding operator intents there muddies its scope.
- `bootstrap/skill-mode.ts` is skill-runtime-specific.
- A dedicated bootstrap clarifies that operator-direct intents are a distinct category.

**Out of scope here:** whether `operator-intents.ts` eventually becomes the place where Design A's broader Mutating Route Contract is wired. That's a Design A decision.

### Decision 5 — Idempotency key sourcing: client-provided `Idempotency-Key` header, fallback to absent

**Choice:** Routes read the `Idempotency-Key` HTTP header. If present, pass through to `platformIngress.submit({ idempotencyKey })`. If absent, omit (`undefined`) — PlatformIngress treats absence as "do not dedup."

**Rationale:**
- Aligns with the existing `actions.ts` convention.
- Doesn't break clients that don't send the header yet (operator UI mostly doesn't, today).
- The eventual Mutating Route Contract (Design A) will mandate the header on all mutating routes via shared middleware. For Phase 1b, the migration just enables the path; mandate comes later.

**Spec for the helper:** define `getIdempotencyKey(request)` in `apps/api/src/utils/idempotency-key.ts` returning `string | undefined`. Used by all 3 migrated routes and re-used by Design A.

## Reference implementation pattern

For each operator-direct intent migration, three artifacts:

### Artifact 1 — Intent registration

In `apps/api/src/bootstrap/operator-intents.ts`:

```ts
intentRegistry.register({
  intent: "operator.transition_opportunity_stage",
  mode: "workflow",
  riskCategory: "low",
  autoApprove: true,
  parameters: TransitionOpportunityStageParametersSchema,
});
```

`TransitionOpportunityStageParametersSchema` is a Zod schema living in `packages/schemas/src/operator-intents.ts` (or similar). The exact path is a Design A decision; for Phase 1b, the schemas can live in `apps/api/src/routes/operator-intents-schemas.ts` and migrate to `@switchboard/schemas` when Design A canonicalizes.

### Artifact 2 — Workflow handler

```ts
const operatorTransitionOpportunityStageHandler: WorkflowHandler = {
  async execute(workUnit) {
    const params = TransitionOpportunityStageParametersSchema.parse(workUnit.parameters);
    try {
      const result = await transitionOpportunityStage(
        { orgId: workUnit.organizationId, ...params, actor: workUnit.actor },
        { opportunityStore }, // injected at bootstrap
      );
      return { outcome: "completed", summary: "Opportunity stage transitioned", outputs: { result } };
    } catch (err) {
      if (err instanceof OpportunityNotFoundError) {
        return { outcome: "failed", summary: "Opportunity not found", error: { code: "OPPORTUNITY_NOT_FOUND", message: err.message } };
      }
      throw err;
    }
  },
};
```

Register in the workflow `handlers` Map alongside existing workflows.

### Artifact 3 — Route migration

```ts
app.patch("/api/dashboard/opportunities/:id/stage", async (request, reply) => {
  const orgId = requireOrganizationScope(request, reply);
  if (!orgId) return;
  if (!app.platformIngress) {
    return reply.code(503).send({ error: "Platform ingress not available" });
  }
  const parsed = StageTransitionRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "INVALID_BODY" });
  }
  const { id } = request.params as { id: string };
  const principalId = request.principalIdFromAuth ?? "unknown";
  const idempotencyKey = getIdempotencyKey(request);

  const response = await app.platformIngress.submit({
    organizationId: orgId,
    actor: { id: principalId, type: "user" },
    intent: "operator.transition_opportunity_stage",
    parameters: { id, stage: parsed.data.stage },
    trigger: "operator",
    surface: { surface: "api" },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  if (!response.ok) {
    // Map IngressError → HTTP response. Helper: ingressErrorToReply(err, reply).
    return ingressErrorToReply(response.error, reply);
  }

  const outputs = response.result.outputs as { result: OpportunityRow };
  return outputs.result;
});
```

The route shape goes from "call service directly, map errors" → "submit to ingress, unwrap typed outputs." The OpportunityNotFoundError case is now classified by the handler's `outcome: "failed"` and mapped through a shared `ingressErrorToReply` helper.

### Shared helpers (one-time additions)

- `apps/api/src/utils/idempotency-key.ts` — `getIdempotencyKey(request)` reads `Idempotency-Key` header
- `apps/api/src/utils/ingress-error-to-reply.ts` — maps `IngressError` and handler-level failed outcomes to HTTP responses
- `apps/api/src/bootstrap/operator-intents.ts` — single file registering all operator-direct intents and their handlers

## Migration checklist (per route, Phase 1b)

For each of the 3 unblocked routes:

1. Define the intent's parameters Zod schema (in `apps/api/src/routes/operator-intents-schemas.ts` for Phase 1b; canonicalize to `@switchboard/schemas` in Design A).
2. Define the `WorkflowHandler` (in `apps/api/src/bootstrap/operator-intents.ts` alongside registration).
3. Register the intent and handler in `bootstrap/operator-intents.ts`.
4. Update the route to call `platformIngress.submit()` with the typed payload, idempotency key, and surface metadata.
5. Add a test in `apps/api/src/routes/__tests__/<route-name>-ingress.test.ts`:
   - Happy path: route submits → handler runs → WorkTrace recorded → response returned
   - Error path: handler returns `outcome: "failed"` → route maps to HTTP error
   - Idempotency path: same `Idempotency-Key` + payload → returns cached result on second call
6. Run `pnpm typecheck` and `pnpm --filter @switchboard/api test`.
7. Optional but recommended: re-run `bash .agent/tools/check-routes` and verify the route is no longer flagged as a bypass.

Estimated effort per route: ~half a day, including tests.

## Out of scope for this pattern (deferred to Design A)

- **Idempotency-key enforcement** (mandate the header). Phase 1b accepts the header optionally; mandate is Design A.
- **Auth guard shape standardization** — Design A.
- **Error envelope normalization** — Design A.
- **Cross-app type duplication** (`ApprovalRecord`, `ConversationState`, `Handoff`) — Design A.
- **Route classification taxonomy** (read-only / derived-write / business-state-mutation / operator-direct-ledger-write) — Design A. This pattern only covers the "operator-direct" classification.
- **Webhook auth guards** (ad-optimizer, whatsapp-send-test, managed-webhook) — separate work; not operator-direct.
- **Mutating-tool ingress migrations** (`calendar-book`, `crm-write`, AI-6) — separate architectural decision; deferred.

## Open risks

- **GovernanceGate `autoApprove: true` short-circuit** — needs verification during the first implementation. If the gate still requires a policy lookup, we add a tiny auto-approve fast-path before merging the implementation PR.
- **`platformIngress` not decorated on `app`** in some test paths — confirm the test harness wires it; otherwise add to `apps/api/src/__tests__/test-server.ts`.
- **`outputs` typing** in `WorkflowHandlerResult` is loose (`Record<string, unknown>`). Routes parse outputs at the boundary. Acceptable for Phase 1b; tighten in Design A.

## Success criteria

- Pattern is documented clearly enough that another agent can execute Phase 1b without re-deriving design decisions.
- The 5 decisions are explicit, code-grounded, and reversible if reality differs from the assumption.
- The migration checklist is concrete and reproducible across the 3 routes.
- Design A's Mutating Route Contract has a clean handoff: operator-direct routes are one of 4 buckets it classifies.

## Next step

After user review and approval, merge this spec to main via focused PR. Then **Phase 1b** runs the 3 migrations as separate PRs, each ~half a day:

- Phase 1b.1: `dashboard-opportunities.ts` (1 intent — exemplar)
- Phase 1b.2: `recommendations.ts` (1 intent)
- Phase 1b.3: `admin-consent.ts` (3 intents grouped — same domain)

`lifecycle-disqualifications.ts` migration tracks as **Phase 1c**, gated on PR #444 merging.
