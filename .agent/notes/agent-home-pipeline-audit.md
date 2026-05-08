# Slice B PR-S4 (Pipeline Block) — Backend Audit

**Generated**: 2026-05-07
**Auditor**: Claude Code (Opus 4.7)
**Target**: Evidence-backed assessment of what the backend can deliver for PR-S4 (B5 Pipeline block on Alex + Riley homes).

---

## Executive Summary

PR-S4 leans on two existing Prisma models — `Contact` for Alex, `PendingActionRecord` for Riley — both with the indexes needed for the projection's filter shape. Unlike PR-S3 (wins), the two agents source from **different models**, so the store interface must accommodate two distinct method signatures. Neither store currently has a method that exactly fits what the projection needs; both need one new push-down read method.

### Five key findings

1. **`Contact.lastActivityAt` is indexed** — `(organizationId, lastActivityAt)` index already exists (schema:1471); pipeline-by-recency is one query, no schema change.
2. **`PendingActionRecord` has the right indexes** — `(organizationId, surface, status)` covers Riley's `surface="queue" + status="pending"` filter; `sourceAgent` is also indexed (schema:1332). Riley adds an in-Prisma post-filter on `sourceAgent="riley"` via the existing index.
3. **`ContactStore` lacks a recent-activity list method** — `list(orgId, filters)` orders by `lastActivityAt desc` but doesn't accept a `since` cutoff or push-down stage filter useful for the pipeline. PR-S4 needs to add a focused `listForPipeline` method.
4. **`RecommendationStore` lacks a pending-by-agent method** — `listResolvedForAgent` exists from PR-S3, but it filters terminal statuses. Riley needs a non-terminal twin: `listPendingForAgent({ orgId, agentKey, limit })` filtered by `surface="queue"` + `status="pending"` + `sourceAgent`.
5. **`resolve-link.ts` already returns disabled for `contact` + `ad-set`** — `ROUTE_AVAILABILITY` flags both `false`; `resolveAgentHomeLink` returns `{ href: null, disabled: true, reason: "route-not-available" }`. No frontend wiring change needed in PR-S4.

---

## Detailed Findings

### 1. Alex source — `Contact` model

**Location**: `packages/db/prisma/schema.prisma:1471–1505`

**Relevant fields**:

```prisma
model Contact {
  id              String
  organizationId  String
  name            String?
  phone           String?
  email           String?
  primaryChannel  String   @default("whatsapp")
  firstTouchChannel String?
  stage           String   @default("new")
  source          String?
  sourceType      String?
  attribution     Json?
  qualificationData Json?
  roles           String[] @default(["lead"])
  firstContactAt  DateTime
  lastActivityAt  DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId])
  @@index([organizationId, stage])
  @@index([organizationId, phone])
  @@index([organizationId, lastActivityAt])
  @@index([organizationId, leadgenId])
  @@index([organizationId, sourceType, createdAt])
}
```

**Pipeline-relevant observations**:

- `lastActivityAt` is indexed with `organizationId` — single-query "list contacts ordered by recency for org X since T."
- `stage` is a free-string column defaulting to `"new"`. The `ContactLifecycle` join model (schema:853) has the funnel stage enum (`lead | qualified | booked | churned`), but `Contact.stage` is the live state and what UI consumers read.
- `firstContactAt` is the lead's age-in-funnel; `lastActivityAt` is recency.
- No agent attribution on `Contact`. Pipeline filters by org + activity, not agent. Alex is the only Day-One agent that operates on contacts, so this is fine for v1.
- `name` is nullable → projection must fall back to phone/email when name is null.

### 2. Alex source — `ContactStore` interface gap

**Interface**: `packages/core/src/lifecycle/contact-store.ts:22–30`

```ts
export interface ContactStore {
  create(input: CreateContactInput): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  findByPhone(orgId: string, phone: string): Promise<Contact | null>;
  updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact>;
  updateLastActivity(orgId: string, id: string): Promise<void>;
  list(orgId: string, filters?: ContactFilters): Promise<Contact[]>;
  listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>>;
}
```

**Gap**: `list()` orders by `lastActivityAt desc` but `ContactFilters` only exposes `stage`, `source`, `limit`, `offset` — no time-window cutoff. Using `list()` with `limit:5` would silently include long-stale contacts.

**Resolution**: Add `listForPipeline({ orgId, activitySince, limit })` to `ContactStore` interface + `PrismaContactStore`. The Prisma query is `where: { organizationId, lastActivityAt: { gte: activitySince } }, orderBy: { lastActivityAt: "desc" }, take: limit + 1` (fetch one extra to know `totalCount` semantics; or run a separate `count` for the headline figure — see Q4).

**Note on InMemory parity**: There is no `InMemoryContactStore` under `packages/core/src/lifecycle/` (only the interface). The api test pattern from PR-S3 shows that test-server adapts a real Prisma-like store via `app.contactStore`; for unit tests of the projection we provide a plain inline test double implementing `ContactPipelineStore` (defined inside `pipeline.ts`).

### 3. Riley source — `PendingActionRecord` model (recap from PR-S3 audit)

**Location**: `packages/db/prisma/schema.prisma:1332–1366`

**Relevant fields**: `id`, `status`, `intent`, `humanSummary`, `riskLevel`, `dollarsAtRisk`, `surface` (default `"queue"`), `sourceAgent`, `organizationId`, `createdAt`, `expiresAt`, `targetEntities` (Json), `parameters` (Json), `dryRunSupported`, `approvalRequired`, `requiredCapabilities[]`.

**Status enum** (`packages/schemas/src/recommendations.ts`): `pending | acted | dismissed | confirmed | dismissed_by_undo | expired`.

**Riley's pipeline rows are**: `status="pending"` + `surface="queue"` + `sourceAgent="riley"` + `organizationId=<org>`.

**Indexes that cover this filter**:

- `(organizationId, surface, status)` — primary push-down filter.
- `sourceAgent` — secondary in-database filter via index.

**Field `targetEntities` (Json)** holds the ad-set id reference (writers' contract from ad-optimizer). Riley pipeline tiles need to dereference an ad-set name and id from there. Spec lock-in for the Json shape is tracked under Q3.

### 4. Riley source — `RecommendationStore` interface gap

**Interface**: `packages/core/src/recommendations/interfaces.ts:9–45`

Has:

- `listBySurface({ orgId, surface, status?, sinceMs?, limit? })` — filters by org + surface + (optional) status + time window. **No agentKey filter.** Riley would have to client-side-post-filter.
- `listResolvedForAgent({ orgId, agentKey, statuses, resolvedSince, limit })` — terminal twin for wins.

**Gap**: No method that combines org + surface + status + agentKey + limit cleanly with push-down. PR-S4 should add `listPendingForAgent({ orgId, agentKey, surface, limit })` symmetric to `listResolvedForAgent`.

**Resolution**: Add to:

- `RecommendationStore` interface (`packages/core/src/recommendations/interfaces.ts`)
- `InMemoryRecommendationStore` (`packages/core/src/recommendations/in-memory-store.ts`) — required for `vi.spyOn` to find it on api-test runtime.
- `PrismaRecommendationStore` (`packages/db/src/recommendation-store.ts`).

The Prisma query: `where: { organizationId, surface, status: "pending", sourceAgent: agentKey }, orderBy: { createdAt: "desc" }, take: limit + 1`.

### 5. `resolve-link.ts` already returns disabled for pipeline links

**Location**: `apps/dashboard/src/lib/agent-home/resolve-link.ts:8–32`

Verified:

```ts
const ROUTE_AVAILABILITY = {
  contact: false,
  "ad-set": false,
  ...
};
```

`resolveAgentHomeLink({ kind: "contact", id })` and `resolveAgentHomeLink({ kind: "ad-set", id })` both return `{ href: null, disabled: true, reason: "route-not-available" }`. PR-S4 wires the block component to render `<span aria-disabled="true">…</span>` instead of `<a href>` when `disabled` is true.

### 6. Endpoint pattern (mirror PR-S3 wins)

**Reference**: `apps/api/src/routes/agent-home/wins.ts:1–108`

Key shape:

- `app.addHook("preHandler", ...)` for authDisabled / x-org-id (test mode).
- Params Zod: `{ agentId: AgentKeySchema }`.
- Query Zod: PR-S4 has none (no `window` selector for pipeline).
- `ALEX_RILEY_ONLY` array; mira → 404.
- `requireOrganizationScope(request, reply)` for org isolation.
- `503` when the upstream store is missing on `app`.
- `try/catch` around `projectPipeline(...)`; `500` on projection failure.
- Returns `{ vm }` body shape (consistent with wins).

**Test-server registration**: PR-S3 added winsRoute to both `apps/api/src/bootstrap/routes.ts` and `apps/api/src/__tests__/test-server.ts`. PR-S4 must register `pipelineRoute` in both files (lesson from the user brief).

### 7. Dashboard proxy + api-client pattern

**Reference**: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/route.ts` (next.js proxy) + `apps/dashboard/src/lib/api-client/governance.ts:listWins(...)`.

PR-S4 mirrors:

- Proxy at `apps/dashboard/src/app/api/dashboard/agents/[agentId]/pipeline/route.ts`.
- `listPipeline(agentId)` method on `SwitchboardClient` next to `listWins`.

### 8. Hook pattern (live → React Query)

**Reference**: `apps/dashboard/src/hooks/use-agent-wins.ts` (live form) + `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` mock pattern.

PR-S4 swaps `use-agent-pipeline.ts` from fixture form to live form. Existing fixture test in `[agentKey]/__tests__/fixtures.test.ts` deletes the `pipeline` case (mirrors PR-S3's wins-fixture removal). The agent-home-client.test.tsx must add a `vi.mock("@/hooks/use-agent-pipeline", ...)` returning `{ data: { tiles: [], totalCount: 0, ... } }` to avoid the React Query path (the test mocks tanstack with only `useQueryClient`).

---

## Gaps & Unknowns for PR-S4

| Gap                                      | Impact                                                   | Resolution                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stage classification rules per agent** | "hot" / "warm" / "new" thresholds are not in the spec.   | Lock per-agent rules in PR-S4 spec (Q2). Alex from `Contact.stage` + recency; Riley from `PendingActionRecord.riskLevel` + `dollarsAtRisk`.                                                                      |
| **Tile cap**                             | Spec doesn't specify visible-tile cap; PR-S3 used 5.     | Lock in PR-S4 spec (Q4). Likely 5 to mirror wins.                                                                                                                                                                |
| **`ctx` format per agent**               | Pre-rendered string for tile's secondary line.           | Lock per-agent template in PR-S4 spec (Q3).                                                                                                                                                                      |
| **`targetEntities` shape for Riley**     | Json blob; PR-S4 needs ad-set name + id contract.        | Riley currently writes `targetEntities = [{ kind: "ad-set", id, name? }]` (verify in ad-optimizer code before implementation). If `name` not present, fall back to `humanSummary`-extracted label or display id. |
| **Empty-state copy**                     | Spec §7.3 mentions empty-state lock-in.                  | Re-read spec §7.3 before drafting empty-state literals. Tests assert the literal copy.                                                                                                                           |
| **`Contact.name` nullable**              | Tile name may be null.                                   | Fallback: phone (last 4 digits formatted), then email, then `"Unnamed lead"`. Confirm in spec.                                                                                                                   |
| **`isPartial` / `unavailableSources`**   | PR-S2/S3 didn't use it; PR-S4 has only required sources. | Skip — both Alex and Riley have a single required source each. No DepResult fan-out.                                                                                                                             |

---

## Implementation Readiness Checklist

- [x] `Contact` model has `lastActivityAt` index for recency ordering.
- [x] `PendingActionRecord` model has `(organizationId, surface, status)` + `sourceAgent` indexes.
- [x] `RecommendationStatus` includes non-terminal `"pending"`.
- [x] `resolveAgentHomeLink` returns `{ disabled: true }` for `contact` and `ad-set` link kinds.
- [x] PR-S3 wins.ts pattern (single SignalStore + projection + voice config) is the precedent.
- [ ] `ContactStore.listForPipeline` — needs to be added.
- [ ] `RecommendationStore.listPendingForAgent` — needs to be added.
- [ ] `pipelineRoute` registered in both `bootstrap/routes.ts` AND `__tests__/test-server.ts`.
- [ ] `apps/dashboard/.../pipeline/route.ts` next.js proxy (mirror wins proxy).
- [ ] `SwitchboardClient.listPipeline(agentId)` method.
- [ ] `agent-home-client.test.tsx` adds `vi.mock("@/hooks/use-agent-pipeline")`.
- [ ] `_fixtures.ts` `pipeline` map + `getFixturePipeline` removed; `fixtures.test.ts` pipeline case removed.

---

## Spec-to-Reality Reconciliation

**Overall assessment**: Backend is 90% ready for PR-S4. Both source models exist, both have correct indexes, both have store classes that just need one new push-down read method each. No schema migration. No DepResult complication.

**Confidence**: High on Alex Contact path; High on Riley PendingActionRecord path; gating questions are product-shape (stage rules, ctx, tile cap, name fallback) — all locked in the PR-S4 design doc, not code-discovered.
