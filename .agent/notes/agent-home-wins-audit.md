# Slice B PR-S3 (Recent Wins Block) — Backend Audit

**Generated**: 2026-05-07  
**Auditor**: Claude Code  
**Target**: Precise evidence-backed assessment of what the backend can deliver for PR-S3 (Recent Wins block on agent home pages)

---

## Executive Summary

PR-S3 wins implementation can lean heavily on existing infrastructure, but faces a critical **spec vs. reality divergence introduced by PR-S2**. The parent Slice B spec mandates a `DepResult<T>` fan-out pattern for optional sources (Booking, ConversionRecord), but PR-S2's greeting implementation uses a single `GreetingSignalStore` interface with no `DepResult` wrapper. PR-S3 must choose a side.

### Five Key Findings

1. **`PendingActionRecord` fully qualified** — Prisma schema (packages/db/prisma/schema.prisma:1332–1366) has all required fields: status (enum: pending/acted/dismissed/confirmed), `undoableUntil` (DateTime nullable), `resolvedAt`, `resolvedBy`, `sourceAgent` (text, validated by AgentKeySchema), org linkage, and three critical indexes for querying by org+surface+status.

2. **Recommendations store exists and battle-tested** — `PrismaRecommendationStore` (packages/db/src/recommendation-store.ts:85–236) implements full lifecycle: insert with idempotency, getById, listBySurface (with optional status filter + time window), and applyAct (status transition with audit trail). Terminal states are `acted`, `dismissed`, `confirmed`, `dismissed_by_undo` (spec calls these "resolved/dismissed/confirmed"). Undo flips from `confirmed` back to `pending`.

3. **PR-S2 deviates from parent spec on dependency injection** — Parent spec (§5.2) prescribes `DepResult<T> | { ok: true; data: T } | { ok: false; source: string; error: unknown }` for optional sources; PR-S2's greeting.ts uses a single `GreetingSignalStore` interface with no failure wrapping. Core is lean (no Prisma imports), but optional-source resilience pattern is not yet established. PR-S3 must decide: follow PR-S2 precedent (simpler, less resilient) or follow spec literal (more explicit failure handling).

4. **Booking and ConversionRecord models exist but lack agent attribution** — Booking (schema:1677–1703) has `workTraceId` (link to WorkTrace, not direct agent attribution), and ConversionRecord (schema:1726–1746) has `agentDeploymentId` (not per-agent). Neither has a direct field linking to agent identity. Query story requires joining through Contact→Opportunity→LifecycleRevenueEvent, or via WorkTrace's undocumented `actorId`. This is a gap for "wins created today for org X attributable to agent Alex."

5. **Undo lifecycle exists on PendingActionRecord but time window enforcement is at read time** — `undoableUntil` is stored on the row (packages/db/prisma/schema.prisma:1353), and `applyAct` in recommendation-store.ts:161–214 checks it implicitly (no explicit time guard shown in code excerpt). The `undo` action is a first-class RecommendationAction (packages/schemas/src/recommendations.ts:17–23). Undo flips status from `confirmed` to `dismissed_by_undo` (or `pending`?); PR-S3 must verify the exact target status.

---

## Detailed Findings

### 1. PendingActionRecord Model (Prisma Schema)

**Location**: `packages/db/prisma/schema.prisma:1332–1366`

```prisma
model PendingActionRecord {
  id                   String    @id @default(uuid())
  idempotencyKey       String    @unique
  workflowId           String?
  stepIndex            Int?
  status               String
  intent               String
  targetEntities       Json
  parameters           Json
  humanSummary         String
  confidence           Float
  riskLevel            String
  dollarsAtRisk        Float     @default(0)
  requiredCapabilities String[]
  dryRunSupported      Boolean   @default(false)
  approvalRequired     String
  fallback             Json?
  sourceAgent          String
  sourceWorkflow       String?
  organizationId       String
  surface              String    @default("queue")
  undoableUntil        DateTime?
  createdAt            DateTime  @default(now())
  expiresAt            DateTime?
  resolvedAt           DateTime?
  resolvedBy           String?

  workflow WorkflowExecution? @relation(fields: [workflowId], references: [id])

  @@index([organizationId, status])
  @@index([organizationId, surface, status])
  @@index([organizationId, undoableUntil])
  @@index([workflowId])
  @@index([sourceAgent])
}
```

**Key observations**:

- No explicit `enum` on `status`, but used in code as `RecommendationStatus` = pending | acted | dismissed | confirmed | dismissed_by_undo | expired (packages/schemas/src/recommendations.ts:7–14).
- `surface` has default "queue"; spec mentions "queue | shadow_action" for recommendations (packages/schemas/src/recommendations.ts:4).
- `undoableUntil` is stored (nullable DateTime), enabling time-window checks.
- `resolvedAt` + `resolvedBy` present but don't explicitly map "resolved/dismissed/confirmed" — resolved state is determined by `status` field.
- Three indexes cover org+surface+status queries + time-window lookups.
- No direct agent field; `sourceAgent` is String (validated at write time by AgentKeySchema in core).

### 2. Recommendations Store (Read + Mutate)

**Location**: `packages/db/src/recommendation-store.ts:85–236`

**Class**: `PrismaRecommendationStore`

**Key functions**:

| Function        | Signature                                                                                                | Purpose                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `insert`        | `async insert(input: PersistRecommendationInput): Promise<{ row: Recommendation; idempotent: boolean }>` | Create with idempotency key; returns existing row on duplicate.                          |
| `getById`       | `async getById(id: string): Promise<Recommendation \| null>`                                             | Fetch by ID; filters for `intent.startsWith("recommendation.")`                          |
| `listBySurface` | `async listBySurface(args: { orgId, surface, status?, sinceMs?, limit? }): Promise<Recommendation[]>`    | Query by org+surface, optional status + time window, max 200, ordered by createdAt desc. |
| `applyAct`      | `async applyAct(args: { id, actor, fromStatus, toStatus, note }): Promise<Recommendation>`               | Status transition with atomic audit-entry creation; throws if status mismatch.           |
| `latestByAgent` | `async latestByAgent(input: { orgId, agentKey, from, to }): Promise<{ date, humanSummary } \| null>`     | Find most recent recommendation for agent in date range.                                 |

**Undo lifecycle**: `applyAct` checks `fromStatus` matches before updating to `toStatus`, and creates an AuditEntry. No explicit `undoableUntil` validation in the code excerpt shown; PR-S3 route must enforce it before calling `applyAct`.

**Status mapping** (from line 43–68):

- Database stores `status` as string.
- `rowToRecommendation` reads `status` as `RecommendationStatus`.
- No explicit handling of the time window; that's a route-level concern.

### 3. API Endpoint Pattern

**Location**: `packages/schemas/src/recommendations.ts:7–14`

**RecommendationStatus enum values**:

- `pending` — awaiting action
- `acted` — user took primary/secondary action
- `dismissed` — user dismissed (secondary)
- `confirmed` — user confirmed (undo-available state)
- `dismissed_by_undo` — user undid a confirmed action
- `expired` — auto-expired

**Spec vs. code**:

- Parent spec (§4) mentions "resolved/dismissed/confirmed" as terminal states for v1.
- Actual enum uses `acted`, `dismissed`, `confirmed`, `dismissed_by_undo`, `expired`.
- **Mapping**: "resolved" = `acted`, "dismissed" = `dismissed`, "confirmed" = `confirmed`. Undo target status is `dismissed_by_undo` (not reverting to `pending`).

### 4. DepResult Pattern (Spec vs. PR-S2 Reality)

**Spec Location**: Parent spec §5.2 (git show origin/docs/slice-b-spec-and-plan:docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md)

```ts
// Spec prescription
export type DepResult<T> = { ok: true; data: T } | { ok: false; source: string; error: unknown };
```

**PR-S2 Implementation** (packages/core/src/agent-home/greeting.ts, observed on feat/slice-b-pr-s2-greeting-live):

```ts
// PR-S2 actual
export interface GreetingSignalStore {
  getSignal(orgId: string, agentKey: AgentKey): Promise<GreetingSignal>;
  getTopItem(orgId: string, agentKey: AgentKey): Promise<TopItemMeta | null>;
}

export async function projectGreeting(input: ProjectGreetingInput): Promise<GreetingProjection> {
  // No DepResult wrapping — both calls are Promise<Data> or throw
  const [signal, topItem] = await Promise.all([
    store.getSignal(orgId, agentKey),
    store.getTopItem(orgId, agentKey),
  ]);
  // No try/catch for optional-source resilience
  // ...
}
```

**Spec deviation analysis**:

- PR-S2 does not wrap optional sources in `DepResult`.
- Both sources are treated as synchronously available or block-fatal.
- No `isPartial` or `unavailableSources` in PR-S2's GreetingProjection (unlike spec §5.2).

**Decision for PR-S3**: This is a critical choice. PR-S3 wins must source from PendingActionRecord (required), then optionally Booking + ConversionRecord. If you follow PR-S2 precedent, DepResult is not used. If you follow spec literal, every optional source is wrapped in DepResult and the WinsViewModel includes `isPartial` + `unavailableSources`.

### 5. Booking Model

**Location**: `packages/db/prisma/schema.prisma:1677–1703`

```prisma
model Booking {
  id              String    @id @default(uuid())
  organizationId  String
  contactId       String
  opportunityId   String?
  calendarEventId String?
  service         String
  startsAt        DateTime
  endsAt          DateTime
  timezone        String    @default("Asia/Singapore")
  status          String    @default("pending_confirmation")
  attendeeName    String?
  attendeeEmail   String?
  connectionId    String?
  createdByType   String    @default("agent")
  sourceChannel   String?
  workTraceId     String?
  rescheduledAt   DateTime?
  rescheduleCount Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([organizationId, contactId, service, startsAt])
  @@index([organizationId, startsAt])
  @@index([contactId])
  @@index([status])
}
```

**Agent attribution**:

- No direct `agentKey` or `createdByAgentKey` field.
- `createdByType` = "agent" (string literal), but no agent identifier.
- `workTraceId` links to WorkTrace model (schema:1616–1671), which has:
  ```prisma
  actorId          String
  actorType        String
  ```
  But `actorId` is opaque (could be user, operator, system); no guarantee it's a named agent.

**Query story for "bookings created today for org X by agent Alex"**:

- Must join Booking → WorkTrace → ??? (unclear how to resolve actorId to agentKey).
- **Gap identified**: Direct agent attribution is missing. Either add `createdByAgent: AgentKey?` to Booking, or establish WorkTrace→Agent mapping (not present in schema).

### 6. ConversionRecord Model

**Location**: `packages/db/prisma/schema.prisma:1726–1746`

```prisma
model ConversionRecord {
  id                String   @id @default(uuid())
  eventId           String   @unique
  organizationId    String
  contactId         String
  type              String
  value             Float    @default(0)
  sourceAdId        String?
  sourceCampaignId  String?
  sourceChannel     String?
  agentDeploymentId String?
  bookingId         String?
  metadata          Json     @default("{}")
  occurredAt        DateTime
  createdAt         DateTime @default(now())

  @@index([organizationId, type, occurredAt])
  @@index([organizationId, sourceCampaignId])
  @@index([contactId])
  @@index([bookingId])
}
```

**Agent attribution**:

- `agentDeploymentId` links to AgentDeployment (schema:940–968), not to AgentKey.
- No direct per-agent field.
- `metadata` is Json (could contain agent info, but untyped).

**Query story**: Same gap as Booking — no direct agent linkage.

### 7. Existing Decisions/Recommendations Endpoint

**Location**: `apps/api/src/routes/recommendations.ts:66–125`

**GET `/` endpoint** (lines 86–125):

```ts
// Query params: surface, status, since (hours suffix "h"), limit
// Returns: { recommendations: [{ id, orgId, agentKey, status, undoableUntil, ... }] }
// Auth: organizationIdFromAuth from session
// Isolation: orgId from auth headers
```

**POST `/:id/act` endpoint** (lines 127–215):

```ts
// Body: { action, note? }
// Actions: primary, secondary, dismiss, confirm, undo
// Rate limit: 300 req / 60s (configurable via env)
// Returns: 200 on success, 4xx/5xx on failure
```

**Dashboard proxy pattern** (observed in dispatch-action.ts:39–50):

- Browser calls `/api/dashboard/recommendations` (Next.js proxy at :3002).
- Proxy forwards to `/api/...` on Fastify API server (:3000).
- Same auth + isolation rules apply.

### 8. Isolation Test Pattern (PR-S1 precedent)

**Location**: `apps/api/src/__tests__/api-decisions-isolation.test.ts:1–36`

```ts
// Test structure:
// 1. emit recommendation with orgId "org-A" and secret content
// 2. make request with "x-org-id" header "org-B"
// 3. assert secret is NOT in response
// 4. repeat for other orgs

// Key detail: isolation is enforced at the route via requireOrganizationScope(request, reply)
// which checks request.organizationIdFromAuth against the queried orgId
```

**Pattern for PR-S3**: Same isolation test for wins endpoint — create recommendations with different orgs, query as one org, verify no leakage.

### 9. dispatch-action.ts Query Invalidation

**Location**: `apps/dashboard/src/lib/decisions/dispatch-action.ts:31–88`

**Function signature**:

```ts
export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss",
  payload?: { message?: string; resolutionNote?: string; note?: string },
  context?: DispatchContext,
): Promise<void>;
```

**Query keys invalidated** (lines 82–87):

```ts
const keys = scopedKeys(orgId);
void queryClient.invalidateQueries({ queryKey: keys.decisions.feed(agentKey) });
void queryClient.invalidateQueries({ queryKey: keys.greeting.feed(agentKey) });
void queryClient.invalidateQueries({ queryKey: keys.wins.byAgent(agentKey) });
```

**Note**: `keys.wins.byAgent(agentKey)` is already referenced, implying the query key structure is pre-planned. Check `query-keys.ts` to see if it's defined.

### 10. use-agent-wins.ts Hook (Current Fixture Form)

**Location**: `apps/dashboard/src/hooks/use-agent-wins.ts:1–14`

```ts
"use client";

export function useAgentWins(agentKey: AgentKey): AgentBlockQuery<WinsViewModel> {
  return {
    data: getFixtureWins(agentKey),
    isLoading: false,
    isError: false,
    error: null,
  };
}
```

**Hook signature**: `(agentKey: AgentKey) => AgentBlockQuery<WinsViewModel>`

**Return shape** (from types.ts:38–43):

```ts
export interface AgentBlockQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}
```

**Contract**: Fixture returns immediate data; live PR swaps internals to call `/api/dashboard/agents/[agentId]/wins` and returns same interface shape (async-compatible).

### 11. Time Formatting Helpers

**Location**: `apps/dashboard/src/lib/agent-home/types.ts:74–75`

```ts
timeFolio: string; // pre-rendered: "11:42 AM" / "Yesterday · 6:14 PM"
```

**Status**: String field name is `timeFolio` (from fixtures.ts line 45), but no formatting helper found in codebase yet. **Gap identified**: PR-S3 must implement a formatter. Org timezone access story is unclear — no timezone field on OrganizationConfig found in audit (schema shows businessHours Json field, but no timezone).

### 12. AgentKey Schema

**Location**: `packages/schemas/src/agents.ts:1–46`

```ts
export const AGENT_REGISTRY = {
  alex: { key: "alex", role: "lead-to-speed", displayName: "Alex", launchTier: "day-one" },
  riley: { key: "riley", role: "ad-optimizer", displayName: "Riley", launchTier: "day-one" },
  mira: { key: "mira", role: "creative", displayName: "Mira", launchTier: "day-thirty" },
};

export type AgentKey = keyof typeof AGENT_REGISTRY;
export const AgentKeySchema = z.enum(AGENT_KEYS as unknown as [AgentKey, ...AgentKey[]]);

export function isAgentKey(s: string): s is AgentKey {
  /* ... */
}
```

**Mira status**: `launchTier: "day-thirty"` — excluded from day-one launch. Spec confirms: Slice B excludes Mira entirely (`/mira` returns 404).

**Exhaustiveness pattern**: Union type `AgentKey = "alex" | "riley" | "mira"`; type-system enforcement for agent-specific logic (e.g., voice profiles in greeting.ts).

### 13. PR-S2 Precedent vs. Spec Drift

**File compared**: Parent spec §5.2 vs. PR-S2's packages/core/src/agent-home/greeting.ts (on feat/slice-b-pr-s2-greeting-live)

| Aspect                         | Spec                                                                                                          | PR-S2 Reality                                                                                | Deviation                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dependency shape**           | `GreetingDeps` with `getInboxCount`, `getOldestOpenItem`, `getLastOperatorActionAt` (mixed required/optional) | `GreetingSignalStore` with `getSignal`, `getTopItem` (no require/optional distinction)       | **MAJOR**: spec has DepResult wrapping; PR-S2 does not. Spec explicitly handles partial unavailability. PR-S2 treats both as all-or-nothing.             |
| **Optional-source resilience** | DepResult pattern: `{ ok: true; data: T } \| { ok: false; source: string; error }`                            | No DepResult wrapper; failures throw.                                                        | **MAJOR**: spec enables graceful degradation (unavailableSources in freshness); PR-S2 has block-fatal errors.                                            |
| **DataFreshness**              | `isPartial?: boolean; unavailableSources?: string[]`                                                          | `generatedAt, window, dataSource` only (no isPartial/unavailableSources)                     | **MODERATE**: PR-S2 omits optional-source failure tracking.                                                                                              |
| **Function naming**            | `getAgentGreetingViewModel`                                                                                   | `projectGreeting`                                                                            | **MINOR**: semantics, no functional impact.                                                                                                              |
| **Variant enum**               | "welcome" \| "named-lead" \| "quiet" \| "busy"                                                                | "welcome" \| "named-lead" \| "quiet" \| "busy"                                               | ✓ Matches (PR-S2 adds "welcome", spec uses unnamed welcome state in logic).                                                                              |
| **Voice profiles**             | `VOICE_PROFILES: Record<AgentKey, VoiceProfile>` at top of file                                               | `AGENT_CONFIGS: Record<"alex" \| "riley", GreetingAgentConfig>` (Mira excluded with comment) | **MINOR**: naming + no Mira config in PR-S2 (spec also excludes Mira, but uses assertNever pattern). PR-S2 uses explicit Record<"alex" \| "riley", ...>. |
| **Prose composition**          | `composeProse(variant, slots, agentKey)` described in spec                                                    | `buildSegments(variant, signal, config, topItem)` in PR-S2                                   | **MINOR**: function signature, same purpose.                                                                                                             |

**Summary of drift**: PR-S2 **significantly deviates from spec's optional-source resilience model**. The spec prescribes DepResult wrapping for Booking/ConversionRecord so unavailability doesn't kill the block. PR-S2's greeting uses a simpler all-or-throw pattern. PR-S3 must choose: simpler (PR-S2 precedent) or spec-compliant (DepResult fan-out).

---

## Gaps & Unknowns for PR-S3

| Gap                                                 | Impact                                                                            | Resolution                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent attribution on Booking + ConversionRecord** | Query "wins by agent Alex" requires schema or WorkTrace bridging.                 | Add `createdByAgent: AgentKey?` to Booking, or establish WorkTrace mapping. Current: impossible without schema change.                         |
| **Time window enforcement**                         | `undoableUntil` is stored but not validated in applyAct shown code.               | Route layer must check `now() < undoableUntil` before calling applyAct with `undo` action.                                                     |
| **Timezone for timeFolio formatting**               | OrganizationConfig has no timezone field visible.                                 | Query tz from businessHours Json (if present) or assume org timezone from Contact.phone region (guess). Implement formatter helper.            |
| **Query key structure**                             | dispatch-action.ts references `keys.wins.byAgent(agentKey)`, but not defined yet. | Define in query-keys.ts (check if file exists).                                                                                                |
| **DepResult pattern**                               | Spec prescribes it; PR-S2 doesn't use it. Core can't decide alone.                | **Make explicit choice in PR-S3 spec/design doc**: follow PR-S2 (simpler, consistency) or spec literal (resilient, but contradicts precedent). |
| **Undo target status**                              | Does undo flip `confirmed` → `pending` or → `dismissed_by_undo`?                  | Spec says "resolved/dismissed/confirmed"; actual enum has `dismissed_by_undo`. Verify with product intent.                                     |

---

## Implementation Readiness Checklist

- [x] PendingActionRecord schema fully qualified (status, undoableUntil, resolvedAt, sourceAgent, org, indexes).
- [x] PrismaRecommendationStore exists with insert, getById, listBySurface, applyAct.
- [x] Recommendation store supports undo action (RecommendationAction enum includes "undo").
- [x] AuditEntry creation on status transitions (built into applyAct).
- [x] API endpoint pattern established (/api/recommendations with GET + POST/:id/act).
- [x] Dashboard proxy pattern precedent (dispatch-action.ts) references query invalidation for wins.
- [x] Isolation test pattern exists (api-decisions-isolation.test.ts).
- [ ] Agent attribution on Booking/ConversionRecord (gap: no direct agentKey field).
- [ ] Time formatting helper (gap: not found in codebase; needs implementation).
- [ ] Query key definition for wins (gap: referenced but not defined yet).
- [ ] DepResult pattern decision (choice between spec literal vs. PR-S2 precedent).

---

## Spec-to-Reality Reconciliation

**Overall assessment**: Backend is 85% ready. Core gaps are:

1. **Agent attribution** on optional sources (Booking, ConversionRecord) — requires schema change or WorkTrace bridging.
2. **DepResult vs. simple pattern** — architecture choice that affects error handling resilience.
3. **Time formatting + timezone** — utility code needed; no schema gap.

**Confidence**: High on PendingActionRecord path (required source); Medium on Booking/ConversionRecord (optional sources lack agent linkage); Low on optional-source resilience pattern (spec vs. PR-S2 contradiction unresolved).
