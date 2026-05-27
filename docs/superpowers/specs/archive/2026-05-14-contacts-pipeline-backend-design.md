# `/contacts` Opportunity Pipeline — **Backend** Design Spec (PR-C2)

_2026-05-14 · sibling to `docs/superpowers/specs/2026-05-13-contacts-pipeline-design.md` (PR-C1, frontend) · third in the C1 → C2 → C3 sequence locked in §11 of the C1 spec_

> **Reading posture:** This spec pins the backend that powers the Mercury `/contacts` board PR-C1 already ships against fixtures. The PR-C1 spec at `docs/superpowers/specs/2026-05-13-contacts-pipeline-design.md` §2.2 deliberately deferred backend decisions — projection scope, audit wiring, error envelopes, store split — to this document. The C1 wire-shape lock test in `packages/schemas/src/pipeline-board.test.ts` ("locked PR-C2 wire shape") is the cross-PR contract gate; nothing here may diverge from it. `NEXT_PUBLIC_CONTACTS_LIVE` stays OFF when PR-C2 merges. PR-C3 is the flip.

---

## 1. Problem & scope

### 1.0 One-line scope

Ship the two Fastify endpoints + core projection + atomic store mutation + audit emission that the PR-C1 hooks already point at, so PR-C3 can flip `NEXT_PUBLIC_CONTACTS_LIVE=true` without touching frontend code.

### 1.1 What this slice ships

- New shared store-interface methods on `OpportunityStore` (`packages/core/src/lifecycle/opportunity-store.ts`): `findOrgBoard(orgId)` and `transitionStage(input)`. The existing `updateStage` is **not** modified — see §5.3.
- New core projection module `packages/core/src/lifecycle/opportunity-board.ts` with `listOpportunitiesForBoard` and `transitionOpportunityStage`. Converts the store's `Date` fields to ISO strings, joins the minimal `Contact` projection, returns the locked `PipelineBoardResponse` shape.
- Prisma implementations in `packages/db/src/stores/prisma-opportunity-store.ts`. `transitionStage` uses Prisma's `$transaction` to update the row **and** write a `WorkTrace` with `ingressPath: "store_recorded_operator_mutation"` atomically.
- Two Fastify endpoints in `apps/api/src/routes/dashboard-opportunities.ts`:
  - `GET /api/dashboard/opportunities` → `200 { rows: PipelineBoardOpportunity[] }`
  - `PATCH /api/dashboard/opportunities/:id/stage` body `{ stage }` → `200 { opportunity: PipelineBoardOpportunity }`
- Two Next.js proxy routes in `apps/dashboard/src/app/api/dashboard/opportunities/` mirroring the `/contacts`, `/reports` proxy pattern (PR #470).
- Two new methods on the dashboard's `getApiClient()` helper.
- Test stores in `apps/api/src/__tests__/test-stores.ts` implement the new store methods (currently throw "not implemented").

### 1.2 What this slice does **not** ship

- **Frontend changes.** `apps/dashboard/src/app/(auth)/(mercury)/contacts/**` is byte-for-byte untouched. The PR-C1 hooks already target the URLs this spec ships; they parse `PipelineBoardResponseSchema` and `PipelineBoardOpportunitySchema` directly. If a projection bug breaks the wire shape, the schema parse throws — the frontend's optimistic rollback engages — there is no frontend retrofit to do here.
- **Flag flip.** `NEXT_PUBLIC_CONTACTS_LIVE` value is unchanged in every non-test file. PR-C3 is the flip and ships its own staging smoke test.
- **Paging.** Spec OPEN-11 (C1 §2.2) locks no-paging for v1. The projection returns every opportunity in the org. Expected size for the SGD-medspa pilot is 50–200 cards (C1 spec §1.1, §6.1). See §2 OPEN-A1.
- **TTL on terminal stages.** Won/lost rows are returned indefinitely. See §2 OPEN-A1.
- **Bulk stage transitions.** One opportunity per PATCH. The C1 mutation hook fires once per drop and once per drawer-select; no bulk surface exists.
- **Conflict detection / `409`.** Last-write-wins per C1 §1.2. Two operators racing to PATCH the same card both succeed; the second write wins and emits its own WorkTrace.
- **`If-Match` / ETags / optimistic-concurrency headers.** The C1 hook doesn't send them; introducing them would couple this PR to a frontend retrofit.
- **`Idempotency-Key` header.** The PATCH route is naturally idempotent at the row level (§5.4); a network-level retry produces a second WorkTrace, which is the audit-honest answer (C1 §1.2). If a stronger idempotency guarantee becomes necessary, layer it in a follow-up.
- **Routing the mutation through `PlatformIngress.submit()`.** See §2 OPEN-A2 — chosen path is `store_recorded_operator_mutation`, not `platform_ingress`.
- **Modifying `OpportunityStore.updateStage`.** Existing callers (lifecycle service, agent paths in `core`) stay on the current contract. The audit obligation is closed by the new `transitionStage` method, not by retrofitting.
- **A separate "opportunities feed" route.** `/api/dashboard/opportunities` is the single org-wide read.
- **Per-agent or per-channel scoping.** The board is org-wide. Per-agent pipeline tiles (`useAgentPipeline`) are unchanged and continue to use their own data path (C1 spec §10.3).

### 1.3 Why this surface, why now

PR-C1 shipped the visual rebuild on fixtures and is queued for merge. The `NEXT_PUBLIC_CONTACTS_LIVE` flag stays OFF in production until PR-C3 flips it; that flip is blocked on PR-C2 existing. Without this PR, operators see fixtures regardless of the flag value — there's no live data path.

The audit obligation called out in C1 spec §1.2 and OPEN-20 is the real architectural debt being closed. PrismaOpportunityStore.`updateStage` mutates the row without writing a `WorkTrace`. Doctrine (`CLAUDE.md`: "Mutating actions enter through `PlatformIngress.submit()`") needs a deliberate answer; this spec picks the existing `store_recorded_operator_mutation` ingress path and justifies the choice in §2 OPEN-A2.

---

## 2. Decisions

### 2.0 Decisions ledger (locked 2026-05-14)

| #       | Question                                                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1**  | Projection scope: paged? include terminals? TTL?                   | **Return ALL stages, all opportunities, no paging, no TTL.** Spec OPEN-11 (C1 §2.2) caps expected cardinality at 50–200 cards/org for the launch pilot. Sort `updatedAt DESC` from the store so test snapshots stay stable; the client re-groups by stage. A `?since=` cursor is a clean backward-compatible follow-up when a larger org exceeds the comfort zone.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **A2**  | Audit wiring: `PlatformIngress.submit()` vs explicit `WorkTrace`?  | **Explicit `WorkTrace` with `ingressPath: "store_recorded_operator_mutation"`.** This is the documented second ingress path in `packages/core/src/platform/work-trace.ts` — used by `conversationStateStore.releaseEscalationToAi`, the `/api/escalations/:id/reply` route, and `PrismaDeploymentLifecycleStore`. The pattern is precedent for **operator-direct UI edits**: no agent intent, no governance evaluation, no execution-mode dispatch, no approval-routing. Stage drag is exactly that class. Routing through `PlatformIngress` would require registering an `opportunity.stage_transition` intent, an always-allow governance gate, an always-execute mode, and a deployment resolver — none of which carry semantic weight for a UI mutation. See §5.4 for atomicity guarantees. |
| **A3**  | GET response envelope                                              | **`200 { rows: PipelineBoardOpportunity[] }`.** Locked by the C1 wire-shape test (`packages/schemas/src/pipeline-board.test.ts`). `PipelineBoardResponseSchema` is the contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **A4**  | PATCH response envelope                                            | **`200 { opportunity: PipelineBoardOpportunity }`.** PR-C1's `use-opportunity-stage-transition.ts` parses `body.opportunity` with `PipelineBoardOpportunitySchema`; any drift fails the schema parse → frontend rolls back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **A5**  | PATCH error codes                                                  | **`200` on success (including same-stage), `400 { error: "INVALID_BODY" }` on Zod fail, `404 { error: "OPPORTUNITY_NOT_FOUND" }` for missing/cross-tenant, `503 { error: "Opportunity store not available" }` when the store decorator is missing.** No `409`. C1 §1.2 locks last-write-wins; conflict detection is out of scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A6**  | Idempotency on same-stage PATCH                                    | **Write the WorkTrace and bump `updatedAt` every time.** C1 §1.2: "each operator action is a distinct event." Silently no-op'ing would hide audit signal without operator benefit. Final row state matches what an immediate re-read would return — the "idempotent in practice" the C1 spec promises.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A7**  | Where does the projection live — new store method or in core?      | **Both, on different responsibilities.** Store gets `findOrgBoard(orgId)` returning raw rows with `Date` fields and joined minimal `Contact`. Core's `listOpportunitiesForBoard` converts to ISO and shapes the `objections` array. Splits the SQL concern from the wire-format concern, keeps the Prisma store close to Prisma, makes the core projection unit-testable without a database.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **A8**  | Where does the mutation live — extend `updateStage` or new method? | **New method: `transitionStage(input)`.** `updateStage` has live callers in the lifecycle service and agent paths in `core`; retrofitting it with WorkTrace emission risks double-writes from those callers and broadens this PR's blast radius. `transitionStage` is operator-path-only; agent paths keep their existing audit (governance-gated through `PlatformIngress`).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **A9**  | Cross-tenant safety                                                | **Mandatory.** `findOrgBoard` filters by `organizationId`. `transitionStage` re-reads the row inside the same transaction with `id` AND `organizationId` in the where-clause — cross-tenant id returns the same 404 path as missing id. A dedicated integration test asserts this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **A10** | Trace `actor` shape                                                | **`{ id: principalIdFromAuth, kind: "user" }`** in dev/test parity (`x-org-id` header path), and the session principal in production. Matches the escalations-route precedent — the operator is the actor of record on operator-direct mutations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A11** | Trace `intent` string                                              | **`opportunity.stage_transition`.** Lowercase dot-namespaced to match existing intent strings (`messaging.reply`, `escalation.resolve`). Not registered in `IntentRegistry` — see §5.4 — but the string is canonical for filtering audit queries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A12** | Trace `parameters` payload                                         | **`{ opportunityId, contactId, fromStage, toStage }`.** Enough to reconstruct the transition without re-reading the row. `fromStage` is the stage observed inside the transaction (before the update), so it survives concurrent rewrites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 2.1 Decisions deliberately NOT made here

- **Flipping `NEXT_PUBLIC_CONTACTS_LIVE`.** PR-C3 owns the flip + the staging smoke. This PR explicitly leaves the flag value untouched.
- **A `?since=` cursor or paging.** Out of scope; called out as a backward-compatible follow-up in §2 OPEN-A1.
- **Conflict detection / If-Match.** C1 §1.2 locked last-write-wins.
- **Replacing or deprecating `OpportunityStore.updateStage`.** Existing callers stay; consolidation is a future refactor.
- **Idempotency keys at the HTTP layer.** Naturally idempotent at the row level (§A6); HTTP-level keying is out of scope.
- **Backfilling WorkTraces for historical stage changes that hit `updateStage`.** Audit starts at PR-C2 merge.

---

## 3. Shared-conventions input

Things this surface needs that wave-1.5's `docs/design-prompts/shared-conventions.md` should consider, none of which block PR-C2:

- **Operator-direct mutation pattern.** The `store_recorded_operator_mutation` ingress path now has three callers (conversation release, escalation reply, opportunity stage). Strong candidate for a shared helper at `packages/core/src/platform/operator-mutation-trace.ts` — a thin wrapper around `buildWorkTrace({ ingressPath: "store_recorded_operator_mutation", ... })` that each store calls. **Out of scope for PR-C2**; flagged so a future shared-conventions pass can unify.
- **Dashboard proxy route boilerplate.** Every `app/api/dashboard/*` Next.js route is the same six-line pattern (session → API client → JSON response → `proxyError`). Candidate for a `createProxyRoute()` helper. Not load-bearing; flagged.

---

## 4. Data contract

### 4.1 Schemas (no new schemas)

PR-C2 introduces zero new exported schemas. The wire contract is fully locked by PR-C1's `packages/schemas/src/pipeline-board.ts`:

- `PipelineBoardContactSchema` — `{ id, name, primaryChannel }`
- `PipelineBoardOpportunitySchema` — the locked card shape (ISO date strings, ISO objection timestamps, all OpportunitySchema fields except `organizationId`/`createdAt`)
- `PipelineBoardResponseSchema` — `{ rows: PipelineBoardOpportunity[] }`

The PR-C2 implementation **consumes** these schemas (parses inputs server-side defensively, but mostly relies on TypeScript types). The C1 lock test fires automatically if a regression slips the wire shape.

A new internal request-validation schema for the PATCH body lives inside the route file, not exported:

```ts
const StageTransitionRequestSchema = z.object({
  stage: OpportunitySchema.shape.stage, // reuses the canonical OpportunityStage enum
});
```

### 4.2 Store-method types

```ts
// packages/core/src/lifecycle/opportunity-store.ts

export interface OpportunityBoardRow {
  // mirrors Opportunity but with the joined minimal contact
  id: string;
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  stage: OpportunityStage;
  timeline: "immediate" | "soon" | "exploring" | "unknown" | null;
  priceReadiness: "ready" | "flexible" | "price_sensitive" | "unknown" | null;
  objections: ObjectionRecord[]; // Date objects from the DB, NOT ISO strings
  qualificationComplete: boolean;
  estimatedValue: number | null;
  revenueTotal: number;
  assignedAgent: string | null;
  assignedStaff: string | null;
  lostReason: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
  contact: {
    id: string;
    name: string; // store returns "" or actual; core falls back to "Unknown"
    primaryChannel: "whatsapp" | "telegram" | "dashboard";
  };
}

export interface TransitionStageInput {
  orgId: string;
  id: string;
  stage: OpportunityStage;
  actor: { id: string; kind: "user" | "system" };
}

export interface TransitionStageResult {
  opportunity: OpportunityBoardRow;
  workTraceId: string;
}

export interface OpportunityStore {
  // ... existing methods unchanged
  findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]>;
  transitionStage(input: TransitionStageInput): Promise<TransitionStageResult>;
}
```

### 4.3 Core projection types

```ts
// packages/core/src/lifecycle/opportunity-board.ts

export function listOpportunitiesForBoard(
  input: { orgId: string },
  deps: { opportunityStore: Pick<OpportunityStore, "findOrgBoard"> },
): Promise<PipelineBoardResponse>;

export function transitionOpportunityStage(
  input: {
    orgId: string;
    id: string;
    stage: OpportunityStage;
    actor: { id: string; kind: "user" };
  },
  deps: { opportunityStore: Pick<OpportunityStore, "transitionStage"> },
): Promise<{ opportunity: PipelineBoardOpportunity }>;

export class OpportunityNotFoundError extends Error {
  readonly code = "OPPORTUNITY_NOT_FOUND";
}
```

### 4.4 Date conversion + contact fallback rules

Core projection is the **only** place dates and contact-name fallback happen:

- Every `Date` → `.toISOString()`. Null → null.
- Each `ObjectionRecord` is re-shaped from `{ category, raisedAt: Date, resolvedAt: Date | null }` to `{ category, raisedAt: string, resolvedAt: string | null }`.
- `contact.name`: if the joined row's `contact.name` is empty/whitespace, substitute `"Unknown"`. Falls in core, not the store, so the store stays close to Prisma's raw output.
- `assignedStaff`, `lostReason`, `notes`, `closedAt`, `estimatedValue`, `assignedAgent`, `timeline`, `priceReadiness`: passed through as-is. Schema accepts nullable on each.

---

## 5. Architecture

### 5.1 Layer map (dependency-doctrine compliance per CLAUDE.md)

```
apps/api/src/routes/dashboard-opportunities.ts   ── Layer 5 (app)
        │  imports listOpportunitiesForBoard, transitionOpportunityStage
        │  imports requireOrganizationScope, app.opportunityStore, app.workTraceStore
        ▼
packages/core/src/lifecycle/opportunity-board.ts ── Layer 3 (core)
        │  imports OpportunityStore type from same package
        │  imports PipelineBoardResponseSchema from @switchboard/schemas
        ▼
packages/core/src/lifecycle/opportunity-store.ts ── Layer 3 (core) — interface only
        │
        ▼ (implemented by)
packages/db/src/stores/prisma-opportunity-store.ts ── Layer 4 (db)
        │  imports buildWorkTrace from @switchboard/core/platform
        │  imports WorkTraceStore from @switchboard/core/platform (constructor-injected)
        ▼
PostgreSQL (Opportunity + Contact + WorkTrace tables, single Prisma $transaction)
```

Core (Layer 3) never imports db (Layer 4). The app (Layer 5) wires them together at app-init time.

### 5.2 Dashboard proxy

```
apps/dashboard/src/app/(auth)/(mercury)/contacts/hooks/use-opportunities-board.ts
        ▼  fetch("/api/dashboard/opportunities")
apps/dashboard/src/app/api/dashboard/opportunities/route.ts (Next.js handler)
        ▼  await client.getOpportunitiesBoard()
apps/dashboard/src/lib/get-api-client.ts → Fastify /api/dashboard/opportunities
```

PATCH analogous: hook → `apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/route.ts` → `client.patchOpportunityStage(id, stage)` → Fastify PATCH.

### 5.3 Store split

| Method                                               | Caller class                    | Audit semantics                                                    | New in PR-C2?  |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | -------------- |
| `create`                                             | Lifecycle service + agent flows | Caller's responsibility (agent paths go through `PlatformIngress`) | No             |
| `findById` / `findByContact` / `findActiveByContact` | Read-only callers               | None                                                               | No             |
| `findOrgBoard`                                       | Dashboard read route            | None                                                               | **Yes**        |
| `updateStage`                                        | Lifecycle service + agent flows | Caller's responsibility                                            | No — unchanged |
| `transitionStage`                                    | Dashboard PATCH route           | **This method writes its own `WorkTrace`**                         | **Yes**        |
| `updateRevenueTotal`                                 | Booking confirmation flows      | Caller's responsibility                                            | No             |
| `countByStage` / `countClosedWon`                    | Agent-home pipeline tiles       | None                                                               | No             |

The split is intentional: existing callers don't double-emit, and the new operator-path methods own their audit.

### 5.4 Atomic mutation (`transitionStage`)

```ts
// packages/db/src/stores/prisma-opportunity-store.ts

async transitionStage(input: TransitionStageInput): Promise<TransitionStageResult> {
  const { orgId, id, stage, actor } = input;
  const now = new Date();
  const workTraceId = randomUUID();
  const traceId = randomUUID();
  const workUnitId = randomUUID();

  return this.prisma.$transaction(async (tx) => {
    const existing = await tx.opportunity.findFirst({
      where: { id, organizationId: orgId },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    });
    if (!existing) {
      throw new OpportunityNotFoundError(`Opportunity not found: ${id} (org: ${orgId})`);
    }

    const isTerminal = stage === "won" || stage === "lost";
    const updated = await tx.opportunity.update({
      where: { id },
      data: {
        stage,
        closedAt: isTerminal ? (existing.closedAt ?? now) : null,
        updatedAt: now,
      },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    });

    const trace = buildWorkTrace({
      workUnit: {
        id: workUnitId,
        traceId,
        organizationId: orgId,
        requestedAt: now.toISOString(),
        actor,
        intent: "opportunity.stage_transition",
        parameters: {
          opportunityId: id,
          contactId: existing.contactId,
          fromStage: existing.stage,
          toStage: stage,
        },
        // ... deployment / resolvedMode minimal stubs per buildWorkTrace's contract
      },
      ingressPath: "store_recorded_operator_mutation",
      // ... governance/execution fields default to a "completed" operator-direct trace
    });
    await tx.workTrace.create({ data: { id: workTraceId, /* ... */ } }); // or this.workTraceStore.persistInTx(tx, trace)

    return { opportunity: mapRowToBoardRow(updated), workTraceId };
  });
}
```

Two things to verify against the existing `buildWorkTrace` contract during implementation:

1. The exact shape of the `WorkUnit` argument when there's no real `deployment` / `mode` (operator-direct edits don't have those). The escalations / conversation precedents have stub values; mirror them.
2. Whether `WorkTraceStore.persist` supports a transaction-aware variant. If not, the trace `INSERT` happens in the same `$transaction` block via `tx.workTrace.create`, sidestepping the store interface. The Prisma client inside the transaction guarantees ACID with the row update.

**Atomicity guarantee:** if the WorkTrace `INSERT` fails (constraint violation, DB error), the transaction aborts and the row update rolls back. No "silent stage change without audit" failure mode.

### 5.5 Route handler skeleton

```ts
// apps/api/src/routes/dashboard-opportunities.ts (abridged)

export const dashboardOpportunitiesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/api/dashboard/opportunities", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    return await listOpportunitiesForBoard({ orgId }, { opportunityStore: app.opportunityStore });
  });

  app.patch("/api/dashboard/opportunities/:id/stage", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    const parsed = StageTransitionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY" });
    }
    const { id } = request.params as { id: string };
    const principalId = request.principalIdFromAuth ?? "unknown";
    try {
      return await transitionOpportunityStage(
        { orgId, id, stage: parsed.data.stage, actor: { id: principalId, kind: "user" } },
        { opportunityStore: app.opportunityStore },
      );
    } catch (err) {
      if (err instanceof OpportunityNotFoundError) {
        return reply.code(404).send({ error: "OPPORTUNITY_NOT_FOUND" });
      }
      throw err;
    }
  });
};
```

The `preHandler` shape mirrors `dashboard-contacts.ts` and `dashboard-reports.ts` verbatim — auth-disabled dev parity, production middleware sets `organizationIdFromAuth` upstream.

### 5.6 Wiring in `apps/api/src/app.ts`

Two registration touches:

1. The `dashboardOpportunitiesRoutes` plugin is registered alongside `dashboardContactsRoutes`.
2. `app.opportunityStore` already exists (line 596 — `app.decorate("opportunityStore", new PrismaOpportunityStore(prismaClient))`). No new decorator needed.

### 5.7 Dashboard proxy + API client

Two files mirror the existing `apps/dashboard/src/app/api/dashboard/contacts/route.ts` pattern verbatim:

```ts
// app/api/dashboard/opportunities/route.ts (GET)
export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.getOpportunitiesBoard();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

// app/api/dashboard/opportunities/[id]/stage/route.ts (PATCH)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await req.json();
    const data = await client.patchOpportunityStage(params.id, body.stage);
    return NextResponse.json(data);
  } catch (err: unknown) {
    // map upstream 404 → 404, 400 → 400, otherwise 500
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : /invalid/i.test(message) ? 400 : 500;
    return proxyError({ error: message }, status);
  }
}
```

`getApiClient()` gets two methods that POST/GET against the Fastify endpoints with the existing auth headers.

---

## 6. Audit trail — what a stage-transition WorkTrace looks like on disk

After a successful PATCH, the `WorkTrace` table contains a row equivalent to:

```jsonc
{
  "id": "<uuid>",
  "workUnitId": "<uuid>",
  "traceId": "<uuid>",
  "organizationId": "org_acme",
  "ingressPath": "store_recorded_operator_mutation",
  "intent": "opportunity.stage_transition",
  "actor": { "id": "user_42", "kind": "user" },
  "parameters": {
    "opportunityId": "opp_abc123",
    "contactId": "c_xyz789",
    "fromStage": "quoted",
    "toStage": "booked",
  },
  "outcome": "completed",
  "mode": null, // operator-direct edits have no execution mode
  "requestedAt": "2026-05-14T08:12:33.000Z",
  "executionStartedAt": "2026-05-14T08:12:33.000Z",
  "completedAt": "2026-05-14T08:12:33.001Z",
  "durationMs": 1,
}
```

The `audit` route (`/api/audit`) and `/api/activity` route already filter by `organizationId` and surface WorkTraces; no audit-route changes are needed for stage transitions to appear in `/activity`. (The activity view's display formatting for `opportunity.stage_transition` is a separate UX concern, not in this PR.)

---

## 7. Test plan

### 7.1 Wire-shape lock (cross-PR contract gate)

`packages/schemas/src/pipeline-board.test.ts` — the C1 test at `describe("PipelineBoardResponseSchema — locked PR-C2 wire shape")` MUST pass without modification. If the projection ships a wire-shape regression (date-as-Date instead of ISO string, missing field, renamed field), this test fires before integration testing does.

### 7.2 Store unit tests — `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts` (extend)

Mocked Prisma per existing pattern. New cases:

- `findOrgBoard` filters by `organizationId`; cross-tenant rows are excluded.
- `findOrgBoard` includes the joined `contact` select.
- `findOrgBoard` returns `updatedAt DESC`.
- `transitionStage` runs both the row update AND the WorkTrace insert inside `$transaction` (assert mock `$transaction` is called and the callback writes both).
- `transitionStage` writes the WorkTrace with `ingressPath: "store_recorded_operator_mutation"`, `intent: "opportunity.stage_transition"`, parameters with `fromStage`/`toStage`.
- `transitionStage` sets `closedAt` when transitioning into `won`/`lost`, clears when leaving terminal.
- `transitionStage` throws `OpportunityNotFoundError` for cross-tenant or missing id (re-read inside transaction returns null).
- `transitionStage` rolls back the row update if WorkTrace insert fails (mock `tx.workTrace.create` to throw; assert row update reverts).

### 7.3 Core projection unit tests — `packages/core/src/lifecycle/__tests__/opportunity-board.test.ts` (NEW)

In-memory store stub (per `packages/core/src/contacts/__tests__/detail.test.ts` pattern). New cases:

- `listOpportunitiesForBoard` converts every `Date` to ISO string (including objection timestamps).
- `listOpportunitiesForBoard` substitutes `"Unknown"` when `contact.name` is empty/whitespace.
- `listOpportunitiesForBoard` passes the C1 wire-shape lock — feed the test the locked C2 representative payload (Date objects), parse output through `PipelineBoardResponseSchema`, assert deep-equal modulo date-format on the locked test object.
- `transitionOpportunityStage` returns `{ opportunity }` with ISO strings.
- `transitionOpportunityStage` propagates `OpportunityNotFoundError` from the store.

### 7.4 API integration tests — `apps/api/src/__tests__/api-opportunities-board.test.ts` + `api-opportunities-stage.test.ts` (NEW)

Per memory `feedback_api_test_mocked_prisma.md`: flat under `apps/api/src/__tests__/`, `buildTestServer`, mocked Prisma (no real Postgres). Cases:

**Board route:**

- `GET /api/dashboard/opportunities` returns `200 { rows: [...] }` parseable by `PipelineBoardResponseSchema`.
- `GET` returns `503` when `app.opportunityStore` is null.
- `GET` returns rows scoped to the request's `organizationId` only (cross-tenant test — two orgs, each request sees its own rows).
- `GET` returns `[]` when the org has no opportunities (not 404).

**Stage route:**

- `PATCH /api/dashboard/opportunities/:id/stage` with valid `{ stage: "booked" }` returns `200 { opportunity }`.
- `PATCH` writes a `WorkTrace` (assert via the test work-trace store mock that `persist` or the in-test `$transaction` callback is invoked with `ingressPath: "store_recorded_operator_mutation"`).
- `PATCH` returns `404` for unknown id.
- `PATCH` returns `404` for cross-tenant id (org A's opportunity, org B's session).
- `PATCH` returns `400 { error: "INVALID_BODY" }` for missing/invalid stage.
- `PATCH` returns `503` when `app.opportunityStore` is null.
- Idempotent same-stage PATCH (`quoted` → `quoted`) returns `200` and emits a WorkTrace (asserting C1 §1.2 "each operator action is a distinct event").
- Terminal transitions (`quoted` → `won`) set `closedAt`; non-terminal (`won` → `quoted`) clears `closedAt`.

### 7.5 Test stores

`apps/api/src/__tests__/test-stores.ts` `TestOpportunityStore` gets working implementations of `findOrgBoard` and `transitionStage` so integration tests can seed rows and observe trace writes through an injected mock. No more `"not implemented"` throws for these two methods.

### 7.6 Dashboard proxy

Lightweight: `apps/dashboard/src/app/api/dashboard/opportunities/__tests__/route.test.ts` — mock `getApiClient` and `requireSession`, assert GET forwards to `client.getOpportunitiesBoard()` and PATCH forwards to `client.patchOpportunityStage(id, stage)`. Auth-error → 401 path.

---

## 8. Risks & migration

### 8.1 Risks

| Risk                                                                                              | Likelihood             | Mitigation                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `buildWorkTrace` signature doesn't accept the stub `WorkUnit` shape an operator-direct edit needs | Medium                 | Mirror the escalations / `releaseEscalationToAi` precedent exactly; the implementation plan should pin the call shape with a code snippet.                                                                   |
| `WorkTraceStore.persist` doesn't accept a Prisma transaction client, breaking atomicity           | Medium                 | Fall back to `tx.workTrace.create({ data: { ... } })` inside the `$transaction` block (using Prisma's transaction client directly). The store-level `persist` interface stays for non-transactional callers. |
| C1 wire-shape lock test fails because the C1 schema requires fields the projection doesn't emit   | Low (locked by schema) | The lock test is the first thing to run after the projection module exists. Iterate against it.                                                                                                              |
| Cross-tenant leak in `findOrgBoard`                                                               | Low                    | Dedicated test asserts org A's request returns zero org B rows even when both orgs share opportunity ids by collision.                                                                                       |
| Concurrent stage PATCHes on the same opportunity produce inconsistent state                       | Low                    | Last-write-wins is locked by C1 §1.2. Both transactions commit; the second observed `fromStage` is the first transaction's `toStage`, which is the audit-honest record.                                      |
| `NEXT_PUBLIC_CONTACTS_LIVE` accidentally flipped in this PR                                       | Low                    | Search grep in PR description; no `.env*` file in the diff.                                                                                                                                                  |

### 8.2 Migration / schema impact

**None.** `Opportunity`, `Contact`, and `WorkTrace` tables already exist. No Prisma schema changes; no migration file; `pnpm db:check-drift` is not required.

If the implementation requires adding an index on `Opportunity(organizationId, updatedAt)` for the board read, that decision lands in the implementation plan, not here. Pilot data sizes don't require it.

---

## 9. File-by-file plan

```
packages/core/src/lifecycle/
  opportunity-store.ts                                          # MODIFY — add OpportunityBoardRow, TransitionStageInput/Result, OpportunityNotFoundError; extend interface
  opportunity-board.ts                                          # NEW — listOpportunitiesForBoard, transitionOpportunityStage
  __tests__/opportunity-board.test.ts                           # NEW
  index.ts (or barrel)                                          # MODIFY if a barrel exists — export from new module

packages/db/src/stores/
  prisma-opportunity-store.ts                                   # MODIFY — implement findOrgBoard + transitionStage; constructor takes optional WorkTraceStore-or-tx-direct
  __tests__/prisma-opportunity-store.test.ts                    # MODIFY — add cases for the two new methods

apps/api/src/routes/
  dashboard-opportunities.ts                                    # NEW

apps/api/src/__tests__/
  api-opportunities-board.test.ts                               # NEW
  api-opportunities-stage.test.ts                               # NEW
  test-stores.ts                                                # MODIFY — implement findOrgBoard + transitionStage on TestOpportunityStore

apps/api/src/app.ts                                             # MODIFY — register dashboardOpportunitiesRoutes (one-line touch)

apps/dashboard/src/app/api/dashboard/opportunities/
  route.ts                                                      # NEW — GET proxy
  [id]/stage/route.ts                                           # NEW — PATCH proxy
  __tests__/route.test.ts                                       # NEW

apps/dashboard/src/lib/
  get-api-client.ts                                             # MODIFY — add getOpportunitiesBoard, patchOpportunityStage
```

Estimated diff: ~600–800 net lines added across ~8 implementation files + ~4 test files. Well below the 600-line-per-file warn limit; the largest single file is the API integration test bundle.

---

## 10. Open questions for the implementation plan

Not pre-decided here; the writing-plans pass picks them up:

1. **`WorkTraceStore.persist` vs `tx.workTrace.create`.** If `persist` accepts a Prisma transaction client, prefer it for consistency with `releaseEscalationToAi`. If not, the implementation can use `tx.workTrace.create` directly. Plan should inspect `packages/db/src/stores/prisma-work-trace-store.ts` and pick.
2. **Whether `OpportunityNotFoundError` lives in `opportunity-store.ts` or `opportunity-board.ts`.** Both work. Recommendation: the **store** (where the throw originates) — same package as `OpportunityStore`, consumed by core.
3. **Index on `Opportunity(organizationId, updatedAt)`.** Pilot data sizes don't require it; the implementation plan should benchmark a synthetic 500-row read locally and decide. If added, the migration goes in PR-C2 (not deferred).
4. **Test-store WorkTrace observation.** Whether `TestOpportunityStore.transitionStage` accepts an injected WorkTrace-recorder hook for assertion, or whether the integration test asserts via the `app.workTraceStore` mock. Recommendation: the latter — closer to production wiring.

---

## 11. Ship sequence (locked, from C1 §11)

| PR                             | Scope                                                                                                                                              | Flag state                        | What goes live                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| PR-C1 (merged / pending merge) | Fixture-only frontend                                                                                                                              | `NEXT_PUBLIC_CONTACTS_LIVE=false` | Design review + screenshot tests on staging |
| **PR-C2 (this spec)**          | Backend: store methods, core projection, Fastify routes, dashboard proxy, audit emission via `store_recorded_operator_mutation`, integration tests | Flag still off                    | Backend ready, dashboard still on fixtures  |
| PR-C3                          | Flip switch: `NEXT_PUBLIC_CONTACTS_LIVE=true`, staging smoke, simulated-500 rollback test                                                          | Flag flips on                     | Operators see real opportunity data         |

PR-C2 is branched from **`feat/contacts-pipeline-pr-c1`**, not main, because the PR-C1 wire-shape lock test and schemas haven't merged to main yet at spec authoring time. After PR-C1 merges, PR-C2 rebases to main.

---

## 12. Acceptance criteria

Before this PR is mergeable, all of the following must be demonstrably true. Each criterion maps to a §-section or a test file.

1. **C1 wire-shape lock test passes.** `packages/schemas/src/pipeline-board.test.ts` (the C1-authored test at `describe("PipelineBoardResponseSchema — locked PR-C2 wire shape")`) is green.
2. **`GET /api/dashboard/opportunities` returns `{ rows }` parseable by `PipelineBoardResponseSchema`.** Integration test in `api-opportunities-board.test.ts`.
3. **`PATCH /api/dashboard/opportunities/:id/stage` writes a `WorkTrace` with `ingressPath: "store_recorded_operator_mutation"`.** Integration test asserts via the trace store mock.
4. **Cross-tenant id returns 404, never 200.** Integration test in `api-opportunities-stage.test.ts`.
5. **Idempotent same-stage PATCH still emits a trace.** Integration test asserts trace mock called once per request, including same-stage.
6. **`NEXT_PUBLIC_CONTACTS_LIVE` is unchanged.** PR description includes `grep -r CONTACTS_LIVE` showing zero functional change.
7. **`apps/dashboard/src/app/(auth)/(mercury)/contacts/**`is byte-for-byte untouched.**`git diff <base> -- 'apps/dashboard/src/app/(auth)/(mercury)/contacts'` returns empty.
8. **Full verification: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @switchboard/dashboard build`** all pass.
9. **PR body includes curl examples** for both endpoints with realistic SGD-medspa payloads, and explicitly states the audit-path choice (`store_recorded_operator_mutation`, not `PlatformIngress.submit()`) with a one-line justification.

---

## 13. Reading order for the writing-plans pass

When PR-C2's implementation plan is authored next, read in this order:

1. This spec, §2 (decisions) → §5 (architecture) → §7 (test plan) — establishes the targets.
2. `packages/schemas/src/pipeline-board.ts` and its `pipeline-board.test.ts` — the locked contract.
3. `packages/core/src/platform/work-trace.ts` and `work-trace-recorder.ts` — `buildWorkTrace` signature, `ingressPath` semantics.
4. `apps/api/src/routes/escalations.ts` (lines 200–280) — the closest operator-direct mutation precedent. Mirror its `releaseEscalationToAi` → `finalizeOperatorTrace` cadence (except PR-C2 has no delivery step, so no `finalizeOperatorTrace` call).
5. `packages/db/src/stores/prisma-opportunity-store.ts` — the file being extended.
6. `apps/api/src/routes/dashboard-contacts.ts` and `dashboard-reports.ts` — the freshest dashboard-route precedents.
7. `apps/dashboard/src/app/api/dashboard/contacts/route.ts` and `app/api/dashboard/reports/route.ts` — proxy-route precedent.
