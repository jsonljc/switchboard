# Revenue Route Ingress Migration (#654-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Cut a fresh worktree from `origin/main` into `.claude/worktrees/issue-654b`, run `pnpm install` + `pnpm db:generate` + `pnpm build` (Postgres usually unreachable locally — that's fine; tests use mocked stores).

**Goal:** Remove the last `operator-direct-contract-deferred` bypass — route `POST /api/:orgId/revenue` through `PlatformIngress.submit` (gaining WorkTrace + idempotency + audit) via a new `operator.record_revenue` operator intent, instead of writing directly through `PrismaRevenueStore` + `PrismaOutboxStore`.

**Architecture:** Mirror the Wave 2 Phase 1b operator-direct ingress pattern (`docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`). A new operator intent + `OperatorMutationHandler` adapter does the revenue-store write and the conversion-event outbox emission *inside* the governed handler; the route becomes a thin ingress submitter wired with the canonical `requireIdempotencyKey` + `requireOrgForMutation` decorators (same as #654-A). The 3 read-only GET handlers in `revenue.ts` are untouched.

**Tech Stack:** Fastify, Zod, `@switchboard/core` platform (`PlatformIngress`, `OperatorMutationMode`, `IntentRegistry`), `@switchboard/db` (`PrismaRevenueStore`, `PrismaOutboxStore`), Vitest (mocked Prisma — CI has no Postgres).

---

## Context & locked decisions

- **Exemplar to copy:** `apps/api/src/bootstrap/operator-intents/opportunity.ts` (handler factory shape) + `apps/api/src/bootstrap/operator-intents.ts` (registration) + `apps/api/src/routes/recommendations.ts` (route decorator wiring, `buildDevAuthFallback` hook) + `apps/api/src/routes/__tests__/*-ingress.test.ts` (e.g. `admin-consent-ingress.test.ts`, `lifecycle-disqualifications-ingress.test.ts`) for the WorkTrace/idempotency test seam (`lastIngressTrace`, `ingressTraceCount` on the test server).
- **Org resolution (consistent with #654-A, Option 1):** resolve org from auth via `requireOrgForMutation` (`request.orgId`), NOT from the `:orgId` path param. Keep the URL `/api/:orgId/revenue` unchanged for compatibility, but **auth is authoritative** — a path `:orgId` differing from the authenticated org is scoped to the auth org (tenant isolation preserved), mirroring #654-A's cross-tenant behavior. Add a test proving this.
- **Outbox emission moves into the handler.** Today the route does `revenueStore.record(...)` then `outboxStore.write('evt_rev_'+event.id, 'purchased', {...})`. Both move into the handler so the whole operation is governed and behind one ingress submission. Handler takes a `RevenueStore` + a minimal outbox-writer interface `{ write(eventId, type, payload): Promise<void> }` (so the handler stays a thin adapter and does not import Prisma directly — wire the concrete `PrismaOutboxStore` at bootstrap, like `app.revenueEventStore` is wired at `app.ts:611`).
- **Idempotency:** the route forwards the `Idempotency-Key` header to `submit({ idempotencyKey })`; the platform guarantees dedup (DOCTRINE §6). `requireIdempotencyKey` makes the header mandatory (a tightening — document it; revenue recording is exactly where replay protection matters).
- **No new error codes needed:** revenue `record` is a create with no domain "not found"; let infra errors propagate (ingress maps to a failed outcome / 500). Do NOT add a try/catch with a fabricated error code.
- **Intent registration shape:** copy `registerOperatorIntent` defaults verbatim (`defaultMode: "operator_mutation"`, `approvalMode: "system_auto_approved"`, `idempotent: true`, `allowedTriggers: ["api"]`, etc.). Revenue recording is auto-approved (it is an operator recording a fact, not a risky outbound action).
- **GOTCHA (cost a CI red in #654-A):** `check-routes --mode=error` does NOT run the `reachesIngress` ingress-reachability check — that runs in DEFAULT mode via `pnpm local:verify:fast`. After this migration the POST *does* reach `platformIngress.submit`, so `revenue.ts` should pass default mode WITHOUT an allowlist entry. **Verify both:** `pnpm exec tsx .agent/tools/check-routes.ts` (default) AND `... --mode=error`.
- **commitlint:** subject must be lowercase-first; footer (Co-Authored-By) needs a leading blank line.

## File structure

- **Create** `apps/api/src/bootstrap/operator-intents/revenue.ts` — `buildRecordRevenueHandler(revenueStore, outboxWriter)` factory.
- **Create** `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts` — handler unit test (mocked store + outbox).
- **Modify** `apps/api/src/bootstrap/operator-intents/shared.ts` — add `RECORD_REVENUE_INTENT = "operator.record_revenue"`.
- **Modify** `apps/api/src/routes/operator-intents-schemas.ts` — add `RecordRevenueParametersSchema` (the existing `RecordRevenueInputSchema` fields from `revenue.ts`).
- **Modify** `apps/api/src/bootstrap/operator-intents.ts` — add `revenueStore?` + `outboxWriter?` to deps; register handler + intent when both present; re-export the new symbols.
- **Modify** `apps/api/src/routes/revenue.ts` — rewrite the POST handler to submit via ingress + decorators + `buildDevAuthFallback`; remove the deferral directive; leave the 3 GET handlers unchanged.
- **Modify** `apps/api/src/app.ts` — pass `revenueStore: app.revenueEventStore` + `outboxWriter: new PrismaOutboxStore(prismaClient)` into the `bootstrapOperatorIntents(...)` call (~line 708).
- **Modify** `apps/api/src/__tests__/test-server.ts` — wire the revenue handler into the test server's operator-intents bootstrap (mirror how opportunity/recommendation are wired) so integration tests can submit the intent. Use an in-memory/mocked `RevenueStore` + a spy outbox writer.
- **Modify/Create** `apps/api/src/__tests__/api-revenue.test.ts` (or the existing revenue test file if present) — integration tests proving WorkTrace, idempotency, org resolution, revenue persistence, outbox emission, and the missing-key 400.

---

### Task 1: Define the intent constant + parameter schema

**Files:**
- Modify: `apps/api/src/bootstrap/operator-intents/shared.ts`
- Modify: `apps/api/src/routes/operator-intents-schemas.ts`

- [ ] **Step 1: Add the intent constant.** In `shared.ts`, after `CLEAR_CONSENT_INTENT`:

```ts
export const RECORD_REVENUE_INTENT = "operator.record_revenue";
```

- [ ] **Step 2: Add the parameter schema.** In `operator-intents-schemas.ts`, mirror the existing `RecordRevenueInputSchema` from `revenue.ts` (verify the file's current export style and copy the field set verbatim):

```ts
export const RecordRevenueParametersSchema = z.object({
  contactId: z.string(),
  opportunityId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("SGD"),
  type: z.enum(["payment", "deposit", "invoice", "refund"]).default("payment"),
  recordedBy: z.enum(["owner", "staff", "stripe", "integration"]).default("owner"),
  externalReference: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});
export type RecordRevenueParameters = z.infer<typeof RecordRevenueParametersSchema>;
```

- [ ] **Step 3: Typecheck + commit.** `pnpm --filter @switchboard/api typecheck`; commit `feat(audit): add operator.record_revenue intent + param schema (#654-B)`.

---

### Task 2: Build the record-revenue handler (TDD)

**Files:**
- Create: `apps/api/src/bootstrap/operator-intents/revenue.ts`
- Create: `apps/api/src/bootstrap/operator-intents/__tests__/revenue.test.ts`

- [ ] **Step 1: Write the failing handler test.** Mirror an existing operator-intent handler test. Assert: (a) `revenueStore.record` called with the parsed params + `organizationId` from `workUnit.organizationId`, opportunityId defaulting to `rev-${contactId}-${<deterministic>}` when omitted; (b) `outboxWriter.write` called once with `evt_rev_${event.id}`, `"purchased"`, and a payload containing `type:"purchased"`, `contactId`, `organizationId`, `value: amount`, `source:"revenue-api"`, and `metadata.opportunityId/currency/revenueType`; (c) result `{ outcome: "completed", outputs: { event } }`.

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRecordRevenueHandler } from "../revenue.js";

describe("buildRecordRevenueHandler", () => {
  it("records revenue and emits the purchased outbox event", async () => {
    const event = { id: "rev_1", amount: 100, currency: "SGD" };
    const revenueStore = { record: vi.fn().mockResolvedValue(event) };
    const outboxWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const handler = buildRecordRevenueHandler(revenueStore as never, outboxWriter);
    const result = await handler.execute({
      organizationId: "org_a",
      actor: { id: "u1", type: "user" },
      parameters: { contactId: "c1", amount: 100, currency: "SGD", type: "payment", recordedBy: "owner" },
    } as never);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", contactId: "c1", amount: 100 }),
    );
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_rev_rev_1",
      "purchased",
      expect.objectContaining({ type: "purchased", contactId: "c1", value: 100, source: "revenue-api" }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.event).toEqual(event);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`buildRecordRevenueHandler` not defined). `pnpm --filter @switchboard/api test -- operator-intents/__tests__/revenue`

- [ ] **Step 3: Implement the handler.** Mirror `opportunity.ts`:

```ts
import type { RevenueStore } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { RecordRevenueParametersSchema } from "../../routes/operator-intents-schemas.js";

/** Minimal outbox-writer surface (concrete PrismaOutboxStore wired at bootstrap). */
export interface OutboxWriter {
  write(eventId: string, type: string, payload: Record<string, unknown>): Promise<void>;
}

export function buildRecordRevenueHandler(
  revenueStore: RevenueStore,
  outboxWriter: OutboxWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordRevenueParametersSchema.parse(workUnit.parameters);
      const resolvedOpportunityId =
        params.opportunityId ?? `rev-${params.contactId}-${Date.now()}`;
      const event = await revenueStore.record({
        organizationId: workUnit.organizationId,
        contactId: params.contactId,
        opportunityId: resolvedOpportunityId,
        amount: params.amount,
        currency: params.currency,
        type: params.type,
        recordedBy: params.recordedBy,
        externalReference: params.externalReference ?? null,
        sourceCampaignId: params.sourceCampaignId ?? null,
        sourceAdId: params.sourceAdId ?? null,
      });
      await outboxWriter.write(`evt_rev_${event.id}`, "purchased", {
        type: "purchased",
        contactId: params.contactId,
        organizationId: workUnit.organizationId,
        value: params.amount,
        sourceAdId: params.sourceAdId ?? null,
        sourceCampaignId: params.sourceCampaignId ?? null,
        occurredAt: new Date().toISOString(),
        source: "revenue-api",
        metadata: {
          opportunityId: resolvedOpportunityId,
          currency: params.currency,
          revenueType: params.type,
        },
      });
      return {
        outcome: "completed" as const,
        summary: `Recorded ${params.type} of ${params.amount} ${params.currency} for contact ${params.contactId}`,
        outputs: { event },
      };
    },
  };
}
```

> NOTE: the `Date.now()` opportunityId default makes the test non-deterministic on that field — assert `record` with `expect.objectContaining` that omits `opportunityId`, or inject a clock. Keep behavior identical to the current route (which uses `Date.now()`).

- [ ] **Step 4: Run — expect PASS.** Same command.
- [ ] **Step 5: Commit** `feat(audit): record-revenue operator-mutation handler (#654-B)`.

---

### Task 3: Register the handler + intent in the bootstrap

**Files:** Modify `apps/api/src/bootstrap/operator-intents.ts`

- [ ] **Step 1:** Add to `OperatorIntentsBootstrapDeps`: `revenueStore?: RevenueStore;` and `outboxWriter?: OutboxWriter;` (import `RevenueStore` from `@switchboard/core`, `OutboxWriter` from `./operator-intents/revenue.js`). Import `RECORD_REVENUE_INTENT` from `./operator-intents/shared.js` and `buildRecordRevenueHandler` from `./operator-intents/revenue.js`; add both to the re-export blocks.
- [ ] **Step 2:** In `bootstrapOperatorIntents`, after the consent block, register the handler only when BOTH deps are present:

```ts
if (revenueStore && outboxWriter) {
  handlers.set(RECORD_REVENUE_INTENT, buildRecordRevenueHandler(revenueStore, outboxWriter));
}
```
and after the consent intent registration:
```ts
if (revenueStore && outboxWriter) {
  registerOperatorIntent(intentRegistry, RECORD_REVENUE_INTENT);
}
```
and bump the `intentCount` expression by `(revenueStore && outboxWriter ? 1 : 0)`.

- [ ] **Step 3: Typecheck + commit** `feat(audit): wire record_revenue into operator-intents bootstrap (#654-B)`.

---

### Task 4: Wire the production bootstrap call

**Files:** Modify `apps/api/src/app.ts` (~line 708)

- [ ] **Step 1:** Add to the `bootstrapOperatorIntents({...})` call: `revenueStore: app.revenueEventStore,` and `outboxWriter: new PrismaOutboxStore(prismaClient),`. Ensure `PrismaOutboxStore` is imported in `app.ts` (it is imported in `revenue.ts`; add the import to `app.ts` if absent — it is already dynamically imported elsewhere; confirm).
- [ ] **Step 2: Typecheck + commit** `feat(audit): pass revenue store + outbox writer to operator-intents (#654-B)`.

---

### Task 5: Rewrite the revenue POST route to submit via ingress (TDD)

**Files:** Modify `apps/api/src/routes/revenue.ts`

- [ ] **Step 1: Update the route file head + imports.** Remove line 2 (`// route-governance: operator-direct-contract-deferred ...`). Keep `// @route-class: operator-direct`. Add imports mirroring `recommendations.ts`: `requireIdempotencyKey` from `../utils/idempotency-key.js`, `requireOrgForMutation` from `../decorators/org.js`, `buildDevAuthFallback` from `../utils/auth-fallback.js`, `RECORD_REVENUE_INTENT` from `../bootstrap/operator-intents.js`, and `CanonicalSubmitRequest` type from `@switchboard/core/platform`. Add `app.addHook("preHandler", buildDevAuthFallback(app));` at the top of the plugin.

- [ ] **Step 2: Rewrite the POST handler** to:

```ts
app.post(
  "/:orgId/revenue",
  { preHandler: requireOrgForMutation },
  async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "PlatformIngress not available", statusCode: 503 });
    }
    const idempotencyKey = requireIdempotencyKey(request, reply);
    if (!idempotencyKey) return;

    const parsed = RecordRevenueInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
    }

    const submitRequest: CanonicalSubmitRequest = {
      intent: RECORD_REVENUE_INTENT,
      parameters: parsed.data,
      actor: { id: request.actorId, type: "user" as const },
      organizationId: request.orgId, // auth is authoritative; :orgId path param is informational
      trigger: "api" as const,
      idempotencyKey,
      surface: { surface: "api" as const, requestId: request.id },
    };

    const response = await app.platformIngress.submit(submitRequest);
    if (!response.ok) {
      const notFound =
        response.error.type === "intent_not_found" || response.error.type === "deployment_not_found";
      return reply.code(notFound ? 404 : 400).send({ error: response.error.message, statusCode: notFound ? 404 : 400 });
    }
    if (response.result.outcome === "failed") {
      return reply.code(500).send({ error: response.result.error?.message ?? "Revenue recording failed", statusCode: 500 });
    }
    // Preserve the prior 201 { event } response shape.
    return reply.code(201).send({ event: response.result.outputs?.event });
  },
);
```

> VERIFY against `@switchboard/core/platform` types: the exact `response` discriminated-union shape (`response.ok`, `response.result.outcome`, `response.result.outputs`, `response.error.type`). Copy the mapping from `execute.ts`/`actions.ts` (already on this pattern after #654-A) rather than guessing.

- [ ] **Step 3: Leave the 3 GET handlers (`/:orgId/revenue`, `/:orgId/revenue/summary`, `/:orgId/revenue/by-campaign`) unchanged** — they are read-only.
- [ ] **Step 4: Typecheck.** `pnpm --filter @switchboard/api typecheck`.
- [ ] **Step 5: Commit** `refactor(audit): route revenue recording through PlatformIngress (#654-B)`.

---

### Task 6: Test-server wiring + integration tests (TDD)

**Files:**
- Modify: `apps/api/src/__tests__/test-server.ts`
- Create/Modify: `apps/api/src/__tests__/api-revenue.test.ts`

- [ ] **Step 1: Wire the handler into the test server.** In `test-server.ts`, where operator-intents are bootstrapped for tests, register `RECORD_REVENUE_INTENT` with `buildRecordRevenueHandler(<mock RevenueStore>, <spy outbox writer>)`. Expose the mock store + spy so tests can assert. Follow exactly how the opportunity/recommendation handlers are wired in the test server (find the existing operator-intents test wiring — it may use the real `bootstrapOperatorIntents` with in-memory stores, or register handlers directly).

- [ ] **Step 2: Write the failing integration tests.** Use `app.inject` with an `x-organization-id` header (the dev-auth-fallback honors it) + an `Idempotency-Key` header. Assert:
  1. `POST /api/:orgId/revenue` with valid body + key → **201** with `{ event }`.
  2. A `WorkTrace` was persisted — assert via the test server's `lastIngressTrace`/`ingressTraceCount` seam (see `admin-consent-ingress.test.ts` for the exact accessor).
  3. The mock `RevenueStore.record` was called with the auth org; the outbox spy `write` was called with `evt_rev_*` + `"purchased"`.
  4. Replay (same `Idempotency-Key` + body) → cached/deduped result (assert `record` called once, not twice — confirm the platform dedup behavior the other `*-ingress.test.ts` idempotency tests assert).
  5. Missing `Idempotency-Key` → **400** `missing_idempotency_key`.
  6. Cross-tenant: path `:orgId = org_b` but `x-organization-id: org_a` → recorded under `org_a` (isolation; mirrors #654-A).

- [ ] **Step 3: Run — expect FAIL, then implement** any test-server wiring gaps until green. `pnpm --filter @switchboard/api test -- revenue`
- [ ] **Step 4: Commit** `test(audit): revenue ingress migration — WorkTrace/idempotency/outbox/isolation (#654-B)`.

---

### Task 7: Full verification + gate

- [ ] **Step 1:** `pnpm --filter @switchboard/api typecheck` — clean.
- [ ] **Step 2:** `pnpm --filter @switchboard/api test` — all green (revenue + operator-intents + any touched).
- [ ] **Step 3:** `pnpm --filter @switchboard/core test` if any core file changed (none expected).
- [ ] **Step 4: Route gate — BOTH modes** (the #654-A lesson). `cd .agent/tools && pnpm install --ignore-workspace` (once), then from worktree root:
  - `pnpm exec tsx .agent/tools/check-routes.ts > /tmp/g.log 2>&1; echo $?` → **0** (default mode incl. reachesIngress; `revenue.ts` now reaches ingress, so NO allowlist entry needed — confirm it is NOT flagged).
  - `pnpm exec tsx .agent/tools/check-routes.ts --mode=error; echo $?` → **0**.
  - Confirm `grep -c operator-direct-contract-deferred apps/api/src/routes/revenue.ts` → **0**.
- [ ] **Step 5:** `pnpm exec eslint <changed files>` → 0 errors; `pnpm exec prettier --check <changed files>` → clean.
- [ ] **Step 6: Final whole-branch review** (controller adjudicates), then open PR to `main`, arm `gh pr merge --squash --auto`.

---

## Self-review checklist (run before execution handoff)

1. **Spec coverage:** intent (T1) · handler w/ store+outbox (T2) · bootstrap registration (T3) · prod wiring (T4) · route→ingress (T5) · tests proving WorkTrace+idempotency+org+persistence+outbox (T6) · gate both modes (T7). ✓ All issue-#654-B scope items covered.
2. **Verify-against-code spots flagged** (do NOT guess): exact `submit` response union shape (copy from `execute.ts`); `RecordRevenueInput` field names (copy from current `revenue.ts`); test-server operator-intents wiring style; `lastIngressTrace` seam accessor name.
3. **Type consistency:** `RECORD_REVENUE_INTENT`, `buildRecordRevenueHandler`, `OutboxWriter`, `RecordRevenueParametersSchema` used consistently across T1–T6.

## Out of scope
- The 3 GET revenue handlers (read-only; unchanged).
- `PrismaRevenueStore`/`PrismaOutboxStore` internals (reused as-is).
- Stricter matrix cells, #643, Phase 3B — separate items.
