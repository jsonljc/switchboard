# Recommendations Backend v1 — Routing Rail + Shadow Auto-Actions

**Status:** Draft
**Date:** 2026-05-03
**Scope:** Replace the visual-only Pause / Reduce 50% / Dismiss handlers on `/console` recommendation cards with a real backend, and ship the routing rail that decides which recommendations reach the queue, which become shadow auto-actions in the activity trail, and which get dropped as noise.
**Defers:** v1.5 — org-level Conservative/Balanced/Aggressive mode selector; v2 — real platform-call executor (Meta/Google API calls behind shadow `confirm`); v3+ — per-agent operator-tunable thresholds.
**Coordinates with:** Console Phase 3 (agent-strip expand-to-panels) — running in parallel in `/Users/jasonli/switchboard-worktrees/feat-phase-3`. The two streams share exactly one frontend file (`recommendation-card.tsx`, handler block only) and one 2-line additive change to `queue-zone.tsx`. See "Frontend protection" below.

---

## Background

Phase 2 of the console redesign (PR #354, merged 2026-05-03) shipped inline interaction for recommendation cards. The Pause / Reduce 50% / Dismiss buttons fire a non-undoable toast and trigger the fade-out animation, but make **no API call**. The card reappears on the next refetch. An explicit comment marks the gap:

```ts
// Visual-only until recommendation backend lands —
// see docs/superpowers/specs/2026-05-03-console-frame-phase-2-design.md
```

This spec exists to remove that comment and to land the system that gives recommendations a home.

The naive fix is a one-table CRUD: a `Recommendation` model, list/act endpoints, hook swap. That fix would have shipped in two days and would have been wrong, for two reasons.

**First — the duplication.** The repo already has `PendingActionRecord` (`packages/db/prisma/schema.prisma:1313`). Its columns are: `intent`, `humanSummary`, `confidence`, `dollarsAtRisk`, `riskLevel`, `parameters`, `targetEntities`, `idempotencyKey`, `expiresAt`, `resolvedAt`, `resolvedBy`, `sourceAgent`, `workflowId?`. That is the table I would have built. Building a parallel `Recommendation` table next to it would violate Doctrine #3 (one persistence truth) and would force the next person to migrate one into the other.

**Second — the noise.** ad-optimizer's `recommendation-engine.ts` already produces `RecommendationOutput[]` per audit run. Today they go nowhere. If they all reach the queue, the queue drowns. The right v1 is not "wire them all to cards." It is "build the rail that decides which ones the operator sees, in what surface, at what depth, with what trust affordance."

---

## Operator UX Principles (the constraint)

These principles are **load-bearing**. Every implementation choice in this spec — and every follow-up spec for this surface — is judged against them. They override convenience.

1. **Modes, not knobs.** Operators do not get a settings cockpit. They get opinionated defaults. v1 has no UI surface for tuning. v1.5 will introduce a single org-level dropdown (Conservative / Balanced / Aggressive). v2+ may expose per-module modes. Per-agent operator-tunable thresholds are deferred indefinitely and are **not a goal**.
2. **Trail, not cockpit.** When the system acts on its own, the operator finds out via the activity trail with an undo button — not via a "pending automated actions" dashboard zone. Auto-actions earn the right to occupy queue space only when they fail or are reverted.
3. **Shadow before execute.** v1 ships routing + visibility + undo, but no real platform-call executor. Auto-actions in v1 are *shadow* — the system records "I would have paused this" and asks the operator to confirm or undo. v2 wires the real Meta/Google call behind the same `confirm` action. The shadow phase exists to build operator trust before code makes irreversible spend decisions.
4. **Opinionated defaults.** v1 ships hardcoded thresholds (Balanced mode). The constants live in one file, clearly marked as the seam where v1.5 will inject mode lookup. We do not build the configuration framework before we know whether the defaults are right.
5. **Empty zones disappear.** A zone with nothing to surface renders silence, not chrome. The recommendations queue card list shows an empty state only when there are zero queue-routed recommendations; the Phase 3 Nova panel will show a count only when there are non-zero shadow actions.
6. **Counts before content.** First glance: a number. Second glance (click): the list. Third glance (click row): the detail. The operator chooses depth.

These principles are restated at the top of the v1.5 and v2 specs verbatim. They do not get re-litigated per spec.

---

## Goal

After v1 lands, an operator on `/console` sees:

1. **A queue that filters noise automatically.** Below-threshold recommendations never appear as cards. The router (a single hardcoded function, Balanced mode) decides at emit time which surface each recommendation reaches.
2. **Real action on the queue cards.** Clicking Pause / Reduce 50% / Dismiss fires a real API call, the recommendation row transitions to a terminal state, the card fades out, and the recommendation does not reappear on refetch.
3. **Shadow auto-actions emitted to the database, ready to render.** High-confidence + low-risk recommendations route to the `shadow_action` surface in the database. The act-side endpoint accepts `confirm` and `undo` (24h window) and the dashboard ships a self-contained `<ShadowActionList>` component + `useShadowActions()` hook, both fully tested. The component is **not wired into `<ConsoleView>` in v1** — Phase 3 (or a small follow-up PR) places it inside the activity trail. v1 proves the loop end-to-end via component tests; the visible UI lands as soon as the trail rewrite ships. The actual ad set is *not* paused in v1 — confirming a shadow action records the intent only. The executor lands in v2.
4. **A working undo loop.** Within 24h of a shadow action being recorded, an operator can undo it. The recommendation flips to `dismissed_by_undo` and the row marks itself reverted in the trail.
5. **A rolled-up "below threshold" indicator.** Recommendations the router drops (low confidence) do not vanish silently; one `AgentEvent` per audit run summarizes them ("Nova reviewed 12 ad sets, 3 below confidence threshold"). Visible in the activity trail's expand view, never in the queue.

After v1 lands, **no operator sees a settings screen for any of this.**

---

## Architecture

### Storage — reuse `PendingActionRecord`

No new Prisma model. The `Recommendation` concept lives at the API + view-model layer, not as its own table.

**Discriminator:** `intent` column starts with `recommendation.` (e.g. `recommendation.ad_set_pause`, `recommendation.ad_set_reduce_budget`). Every recommendation row in `PendingActionRecord` is identifiable by this prefix. Filter queries SHOULD use a prefix match, not exact intent equality, so new recommendation kinds added later do not require route changes.

**Surface column.** Add a single new column to `PendingActionRecord`:

```prisma
surface  String  @default("queue")  // queue | shadow_action | dropped
```

Migration name: `add_pending_action_surface`. Because the column has a default and existing rows are operationally inert, the migration is a single `ALTER TABLE ADD COLUMN` with no backfill. `pnpm db:check-drift` must pass.

**Presentation fields go in `parameters` JSON.** `primaryLabel`, `secondaryLabel`, `dismissLabel`, and `dataLines` (the `RichText[][]` from `apps/dashboard/src/components/console/console-data.ts`) are presentation concerns. They live inside the existing `parameters` JSON column under a `presentation` sub-key:

```jsonc
parameters: {
  // ...domain fields (action params, target ids, etc.)
  presentation: {
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [[{ bold: "CPA $42" }, " vs target ", { bold: "$30" }], ["7-day spend $1,240"]]
  }
}
```

Putting them in `parameters` rather than promoting them to columns keeps the table narrow and acknowledges they are not domain data. The mapper unpacks them at the view-model boundary.

**Undo window.** Add one more column:

```prisma
undoableUntil  DateTime?  // null for queue-routed; set to createdAt + 24h for shadow_action
```

Same migration. The `undoableUntil` field is read by the act-side endpoint to gate the `undo` action, and by the trail UI to fade the undo affordance after expiry.

**Status values.** `PendingActionRecord.status` already exists. v1 uses these values for recommendations specifically:

- `pending` — newly emitted, awaiting operator decision (queue surface) or shadow window (shadow_action surface)
- `acted` — operator clicked Pause or Reduce 50% on a queue card
- `dismissed` — operator clicked Dismiss on a queue card
- `confirmed` — operator clicked Confirm on a shadow_action trail row (no executor in v1; this records intent)
- `dismissed_by_undo` — operator clicked Undo on a shadow_action within the 24h window
- `expired` — `expiresAt` has passed and no operator action was taken; computed lazily on read and on write

These do not conflict with workflow-side uses of `PendingActionRecord` because the discriminator (`intent LIKE 'recommendation.%'`) keeps the populations disjoint at query time.

**Indexes.** The existing `@@index([organizationId, status])` already supports the queue list query. Add one new index for the trail surface and one for the expiry sweep:

```prisma
@@index([organizationId, surface, status])
@@index([organizationId, undoableUntil])
```

---

### Core surface — `packages/core/src/recommendations/`

New directory. Layer-respecting: core defines interfaces and pure functions; persistence implementation lives in `packages/db`.

**Files:**

```
packages/core/src/recommendations/
├── index.ts            — barrel export
├── types.ts            — RecommendationInput, Recommendation, RecommendationStatus, RecommendationAction, Surface
├── router.ts           — routeRecommendation({confidence, dollarsAtRisk, action}) -> Surface
├── interfaces.ts       — RecommendationStore interface
├── emit.ts             — emitRecommendation(store, input)
└── act.ts              — actOnRecommendation(store, input)
```

**Router (`router.ts`).** A single pure function, ~20 lines, with the v1 Balanced thresholds inlined:

```ts
// v1 Balanced mode — hardcoded.
// v1.5 will replace these constants with a mode lookup keyed off org config.
// v2+ may expose per-module modes. Per-agent tuning is NOT a goal.
const BALANCED = {
  shadowConfidence: 0.85,
  shadowMaxRisk: 50,           // dollars
  queueMinConfidence: 0.5,
};

export type Surface = "queue" | "shadow_action" | "dropped";

export function routeRecommendation(input: {
  confidence: number;
  dollarsAtRisk: number;
  action: string;
}): Surface {
  const reversibleActions = new Set(["pause", "reduce_budget"]);
  const reversible = reversibleActions.has(input.action);

  if (reversible && input.confidence >= BALANCED.shadowConfidence && input.dollarsAtRisk < BALANCED.shadowMaxRisk) {
    return "shadow_action";
  }
  if (input.confidence >= BALANCED.queueMinConfidence) {
    return "queue";
  }
  return "dropped";
}
```

The reversible-action set is hardcoded to `{pause, reduce_budget}` because those are the only ad-optimizer actions that are cleanly reversible without re-running an audit. Other actions (`add_creative`, `consolidate`, `kill`, `expand_targeting`) always route to `queue` regardless of confidence — operator must decide.

**Emit (`emit.ts`).** Signature:

```ts
export interface RecommendationInput {
  orgId: string;
  agentKey: "nova" | "alex" | "mira";
  intent: string;                              // e.g. "recommendation.ad_set_pause"
  action: string;                              // e.g. "pause" — used by router
  humanSummary: string;                        // e.g. "Pause Whitening Ad Set B — CPA $42 vs target $30"
  confidence: number;                          // 0..1
  dollarsAtRisk: number;
  riskLevel: "low" | "medium" | "high";
  parameters: Record<string, unknown>;         // domain params
  presentation: {
    primaryLabel: string;
    secondaryLabel: string;
    dismissLabel: string;
    dataLines: unknown[];                      // RichText[][] — typed in the dashboard layer
  };
  targetEntities?: Record<string, unknown>;    // adSetId, campaignId, etc.
  expiresAt?: Date;                            // default: now + 24h
  sourceWorkflow?: string;
}
```

`emitRecommendation(store, input)`:
1. Validates the input shape with Zod (schema lives in `packages/schemas`).
2. Calls `routeRecommendation()` to pick the surface.
3. If `surface === "dropped"`, returns `{ surface: "dropped", id: null }` — **no row is written**. The caller is expected to roll dropped recommendations into a single `AgentEvent` per emit batch (see "Emit-side observability" below).
4. Otherwise, writes one `PendingActionRecord` with:
   - `surface` set
   - `undoableUntil` = `createdAt + 24h` if `surface === "shadow_action"`, else `null`
   - `expiresAt` = `input.expiresAt ?? createdAt + 24h`
   - `idempotencyKey` = a deterministic hash of `(orgId, intent, targetEntities, day-bucket)` so re-running an audit on the same day for the same target does not create duplicate rows. Existing `@@unique([idempotencyKey])` on the table enforces this. On collision, returns the existing row with `{ surface: row.surface, id: row.id, idempotent: true }`.
5. Returns `{ surface, id, idempotent }`.

**Act (`act.ts`).** Signature:

```ts
export interface ActOnRecommendationInput {
  recommendationId: string;
  orgId: string;
  actor: { principalId: string; type: "operator" };
  action: "primary" | "secondary" | "dismiss" | "confirm" | "undo";
  note?: string;
}

export type ActResult =
  | { status: "ok"; row: Recommendation }
  | { status: "already_terminal"; row: Recommendation }
  | { status: "expired"; row: Recommendation }
  | { status: "undo_window_closed"; row: Recommendation };
```

`actOnRecommendation()`:
1. Loads the row by id; 404 (caller-translated) if missing.
2. Asserts `row.orgId === input.orgId`; 403 (caller-translated) on mismatch.
3. **Lazy expiry:** if `row.status === "pending"` and `row.expiresAt < now`, transitions to `expired` first and returns `{ status: "expired", row }`.
4. **Action validity per surface:**
   - Queue surface accepts `primary | secondary | dismiss`. `confirm` and `undo` return 400.
   - Shadow surface accepts `confirm | undo`. `primary | secondary | dismiss` return 400.
5. **Terminal-state guard:** if `row.status` is anything other than `pending`, returns `{ status: "already_terminal", row }`. The caller maps this to HTTP 409 with the current row in the body. The frontend treats `409 already_terminal` as success (the fade-out animation already happened; both clients agree on the outcome).
6. **Undo window guard (shadow only):** if `action === "undo"` and `now > row.undoableUntil`, returns `{ status: "undo_window_closed", row }` (HTTP 409).
7. Computes the new status:
   - `primary | secondary` → `acted`
   - `dismiss` → `dismissed`
   - `confirm` → `confirmed`
   - `undo` → `dismissed_by_undo`
8. Writes the transition (`status`, `actedBy`, `actedAt`, `note`), writes one `AuditEntry` row, returns `{ status: "ok", row: <updated row> }`.

**Audit trail.** Each `act` writes an `AuditEntry` with `eventType: "recommendation.act"`, `actorType: "operator"`, `actorId`, `entityType: "recommendation"`, `entityId`, `summary` (the humanSummary), `snapshot: { from: prevStatus, to: newStatus, action }`, `organizationId`. This mirrors how approval-response writes audit today. `WorkTrace` is **not** written in v1 — the act is a state transition on an internal entity, not a fresh mutating action that crosses the platform boundary. v2 (when the executor lands and the act actually calls Meta/Google) MUST route through `PlatformIngress.submit()`, which writes WorkTrace as part of its standard machinery.

**Doctrine compliance note.** v1's act-side does not flow through `PlatformIngress.submit()`. This mirrors the current legacy approval-response path (`ApprovalManager`, marked in `docs/DOCTRINE.md` as a Phase-2 migration target). Recommendation acts ride the same future migration. This is documented as **legacy-bridge debt** in `docs/DOCTRINE.md` once this spec ships — add a row to the Legacy Bridge Registry table:

| Component | Location | Exit Condition |
|---|---|---|
| Recommendation act direct mutation | `packages/core/src/recommendations/act.ts` | Migrate to `PlatformIngress.submit({ intent: "operator.respond_recommendation" })` when the executor lands (v2). Same migration as approval-response. |

---

### Persistence implementation — `packages/db/src/recommendation-store.ts`

New file. Implements `RecommendationStore` from `core/recommendations/interfaces.ts`. Backed by Prisma's `PendingActionRecord` model. Methods:

- `emit(input)` — INSERT with idempotency key; returns existing row on collision
- `getById(id)` — SELECT with org guard left to caller
- `listBySurface(orgId, surface, status)` — filtered SELECT, ordered by createdAt desc, capped at 200
- `act(input)` — atomic UPDATE wrapped in a transaction with the AuditEntry insert

The `intent LIKE 'recommendation.%'` filter is applied inside `listBySurface` so callers cannot accidentally see workflow-side `PendingActionRecord` rows. Tests assert this isolation.

Wired in `apps/api/src/app.ts` alongside the other Prisma stores.

---

### API contract — `apps/api/src/routes/recommendations.ts`

New file. Mirrors the structure of `apps/api/src/routes/approvals.ts`.

**Endpoints:**

```
GET  /api/recommendations?surface=queue&status=pending&limit=50
GET  /api/recommendations?surface=shadow_action&status=pending&since=24h&limit=50
POST /api/recommendations/:id/act   body: { action, note? }
```

**`GET /api/recommendations`:**
- Query params: `surface` (required, enum), `status` (default `pending`), `since` (optional ISO duration like `24h`, applied to `createdAt`), `limit` (default 50, max 200).
- Org-scoped via `requireOrganizationScope(request, reply)`.
- Returns `{ recommendations: RecommendationApiRow[] }`.
- `RecommendationApiRow` shape:
  ```ts
  {
    id, orgId, agentKey, intent, action, humanSummary,
    confidence, dollarsAtRisk, riskLevel,
    surface, status, undoableUntil,
    parameters, targetEntities,
    sourceAgent, sourceWorkflow,
    actedBy, actedAt, note,
    createdAt, expiresAt, updatedAt
  }
  ```
- Lazy expiry is **not** applied at the GET level — expired rows are filtered out by the `status` query (`pending` excludes them once act() has lazily transitioned them). A row that has not been read since its expiry will still appear as `pending` in the list, but the next `act` call will transition it to `expired` before returning. This is acceptable for v1; v1.5 may add a sweep job if drift becomes a problem.

**`POST /api/recommendations/:id/act`:**
- Body: `{ action: "primary"|"secondary"|"dismiss"|"confirm"|"undo", note?: string }`.
- 200 with `{ recommendation: RecommendationApiRow }` on success.
- 409 with `{ error, recommendation: RecommendationApiRow }` on terminal-state conflict, expiry, or undo-window-closed.
- 404 if not found, 403 on org mismatch, 400 on invalid action-for-surface or missing body.
- The principalId for `actor` is read from `request.principalIdFromAuth` exactly as approvals.ts does.

**Rate limiting.** Apply the same per-route override approvals.ts uses for `/respond` (300 req/60s/IP). Acting on recommendations should not be starved by high-frequency reads.

---

### Dashboard proxy — `apps/dashboard/src/app/api/dashboard/recommendations/`

New directory. Mirrors `apps/dashboard/src/app/api/dashboard/approvals/route.ts` exactly.

**Files:**

```
apps/dashboard/src/app/api/dashboard/recommendations/
└── route.ts            — GET (list, by ?surface=...) + POST (act, body reshape)
```

**`GET`:**
- Calls `requireDashboardSession()`.
- Reads `surface` and `status` from `request.nextUrl.searchParams`.
- Calls `client.listRecommendations({ surface, status, since })`.
- Returns the API response verbatim.

**`POST`:**
- Calls `requireDashboardSession()`.
- Reads `{ recommendationId, action, note? }` from the body.
- Calls `client.actOnRecommendation(recommendationId, { action, note })`.
- Returns the API response verbatim, preserving the upstream status code (specifically: 409 must propagate so the frontend can recognize the already-terminal case).

The proxy must **propagate the upstream status code on 409**. Today's `proxyError` helper returns 500 by default — extend it (or use a small inline branch) to forward 4xx responses with their original status. This is necessary for the frontend's "treat 409 as silent success" path to work.

**SDK additions — `apps/dashboard/src/lib/api-client/governance.ts`:**

Append two methods to the existing governance client (no new file — the SDK is split by domain and recommendations belong in governance):

```ts
async listRecommendations(opts: { surface: "queue" | "shadow_action"; status?: string; since?: string }): Promise<{ recommendations: RecommendationApiRow[] }>
async actOnRecommendation(id: string, body: { action: ActAction; note?: string }): Promise<{ recommendation: RecommendationApiRow }>
```

The `RecommendationApiRow` type lives in `apps/dashboard/src/lib/api-client-types.ts` (the existing shared types file).

---

### Frontend wiring — the surgical part

**1. `apps/dashboard/src/lib/query-keys.ts`** — append a `recommendations` block matching the `approvals` shape:

```ts
recommendations: {
  all: () => [orgId, "recommendations"] as const,
  queue: () => [orgId, "recommendations", "queue"] as const,
  shadow: () => [orgId, "recommendations", "shadow"] as const,
},
```

**2. NEW `apps/dashboard/src/hooks/use-recommendations.ts`** — copy/paste of `use-approvals.ts` with the path swap and the `surface=queue` query param:

```ts
export function useRecommendations() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.recommendations.queue() ?? ["__disabled_recommendations_queue__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/recommendations?surface=queue&status=pending");
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      return res.json();
    },
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}

export function useRecommendationCount() {
  const { data } = useRecommendations();
  return data?.recommendations.length ?? 0;
}
```

**3. NEW `apps/dashboard/src/hooks/use-shadow-actions.ts`** — same pattern, `surface=shadow_action&since=24h`:

```ts
export function useShadowActions() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.recommendations.shadow() ?? ["__disabled_recommendations_shadow__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/recommendations?surface=shadow_action&status=pending&since=24h");
      if (!res.ok) throw new Error("Failed to fetch shadow actions");
      return res.json();
    },
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}
```

**4. NEW `apps/dashboard/src/hooks/use-recommendation-action.ts`** — copy/paste of `use-approval-action.ts` with `bindingHash` removed:

```ts
export function useRecommendationAction(recommendationId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const keys = useScopedQueryKeys();

  const respond = useMutation({
    mutationFn: async (input: { action: "primary"|"secondary"|"dismiss"|"confirm"|"undo"; note?: string }) => {
      const res = await fetch("/api/dashboard/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId, action: input.action, ...(input.note !== undefined ? { note: input.note } : {}) }),
      });
      if (res.status === 409) {
        // Already-terminal — treat as silent success.
        // The fade-out animation already happened; both clients agree on outcome.
        return { silent: true, body: await res.json().catch(() => ({})) };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Recommendation action failed (HTTP ${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.recommendations.all() });
        queryClient.invalidateQueries({ queryKey: keys.audit.all() });
      }
    },
  });

  return {
    primary: (note?: string) => respond.mutateAsync({ action: "primary", note }),
    secondary: (note?: string) => respond.mutateAsync({ action: "secondary", note }),
    dismiss: (note?: string) => respond.mutateAsync({ action: "dismiss", note }),
    confirm: (note?: string) => respond.mutateAsync({ action: "confirm", note }),
    undo: (note?: string) => respond.mutateAsync({ action: "undo", note }),
    isPending: respond.isPending,
    error: respond.error,
  };
}
```

**5. `apps/dashboard/src/components/console/console-mappers.ts`** — append `mapRecommendationCard` and widen `mapQueue` to accept recommendations. Update only the function signatures and return values; do not touch existing mappers:

```ts
export type RecommendationApiRow = {
  id: string;
  agentKey: "nova" | "alex" | "mira";
  humanSummary: string;
  confidence: number;
  parameters: { presentation?: { primaryLabel: string; secondaryLabel: string; dismissLabel: string; dataLines: unknown[] } };
  surface: "queue" | "shadow_action";
  status: string;
  createdAt: string;
};

export function mapRecommendationCard(row: RecommendationApiRow, _now: Date): RecommendationCard {
  const p = row.parameters?.presentation ?? { primaryLabel: "Confirm", secondaryLabel: "Adjust", dismissLabel: "Dismiss", dataLines: [] };
  return {
    kind: "recommendation",
    id: row.id,
    agent: row.agentKey,
    action: row.humanSummary,
    timer: { label: confidenceToLabel(row.confidence), confidence: row.confidence.toFixed(2) },
    dataLines: p.dataLines as RichText[],  // typed in console-data.ts
    primary: { label: p.primaryLabel },
    secondary: { label: p.secondaryLabel },
    dismiss: { label: p.dismissLabel },
  };
}

function confidenceToLabel(c: number): string {
  if (c >= 0.9) return "Immediate";
  if (c >= 0.75) return "High confidence";
  return "Suggested";
}

export function mapQueue(
  escalations: EscalationApiRow[],
  approvals: ApprovalApiRow[],
  recommendations: RecommendationApiRow[],   // new arg
  now: Date,
): QueueCard[] {
  const escCards = escalations.map((e) => mapEscalationCard(e, now));
  const gateCards = approvals.filter((a) => a.riskCategory === "creative").map((a) => mapApprovalGateCard(a, now));
  const recCards = recommendations.map((r) => mapRecommendationCard(r, now));
  return [...escCards, ...gateCards, ...recCards];
}
```

The line in the existing file that says `// Recommendation cards are not exposed by the backend in option B; option C wires them.` is removed.

**6. `apps/dashboard/src/components/console/zones/queue-zone.tsx`** — **2-line additive exemption** to the Phase-3 protection rule. The Phase 2 spec called this file out as off-limits to the backend session, but the `mapQueue` signature widening forces a single hook call + an extra arg here. The change is data-flow only — no JSX changes, no className changes, no animation changes:

```diff
   const escalations = useEscalations();
   const approvals = useApprovals();
+  const recommendations = useRecommendations();
   const queryClient = useQueryClient();
   ...
-  const cards = useMemo(() => mapQueue(escalationRows, approvalRows, new Date()), [...]);
+  const cards = useMemo(() => mapQueue(escalationRows, approvalRows, recommendationRows, new Date()), [...]);
```

Plus one corresponding line where `recommendationRows` is unpacked from the hook result, and the existing `queryClient.invalidateQueries` array gets a new entry for `recommendations.all()`. **This is the only file in `zones/` this initiative may touch.** Phase 3 is not editing `queue-zone.tsx` (Phase 3 targets `agent-strip.tsx`, `nova-panel.tsx`, etc.) — merge collision risk is low. The spec calls this out so both sessions know the boundary.

**7. `apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx`** — the surgical handler swap. JSX, classNames, qcard structure, and the `is-resolving` animation all stay byte-identical. Only the import block and the `fire()` function change:

```diff
- import { useToast } from "../use-toast";
+ import { useState } from "react";
+ import { useRecommendationAction } from "@/hooks/use-recommendation-action";

   export function RecommendationCardView({ card, resolving, onResolve }: Props) {
-    const { showToast } = useToast();
-
-    // Visual-only until recommendation backend lands —
-    // see docs/superpowers/specs/2026-05-03-console-frame-phase-2-design.md
-    // (no API mutation; card reappears on next refetch).
-    const fire = (label: string, detail: string) => {
-      showToast({ title: label, detail, undoable: false });
-      onResolve();
-    };
+    const action = useRecommendationAction(card.id);
+    const [error, setError] = useState<string | null>(null);
+
+    const fire = async (kind: "primary" | "secondary" | "dismiss") => {
+      setError(null);
+      try {
+        await action[kind]();
+        onResolve();
+      } catch (err) {
+        setError(err instanceof Error ? err.message : "Action failed");
+      }
+    };
```

The three button `onClick` handlers update from `() => fire(card.X.label, card.action)` to `() => fire("primary" | "secondary" | "dismiss")`. An inline `<div className="qerror">` row appears above `.qactions` when `error` is non-null, mirroring how the approval-gate-card handles errors. Net diff: ~25 lines.

**8. NEW `apps/dashboard/src/components/console/zones/shadow-action-row.tsx`** — the trail surface for shadow auto-actions. **This is a new file the original prompt did not anticipate.** It is the smallest possible v1-shadow UI and is necessary because the activity trail today does not have a notion of "the system did this on its own — confirm or undo." It does not modify any existing zone file:

```tsx
"use client";

import { useState } from "react";
import { useShadowActions } from "@/hooks/use-shadow-actions";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";

export function ShadowActionList() {
  const { data } = useShadowActions();
  const rows = data?.recommendations ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-label="Auto-actions" className="shadow-actions">
      <div className="label">Nova handled — confirm or undo</div>
      {rows.map((row) => <ShadowActionRow key={row.id} row={row} />)}
    </section>
  );
}

function ShadowActionRow({ row }: { row: { id: string; humanSummary: string; createdAt: string; undoableUntil: string } }) {
  const action = useRecommendationAction(row.id);
  const [error, setError] = useState<string | null>(null);
  const expired = new Date(row.undoableUntil) < new Date();

  return (
    <div className="shadow-row">
      <div className="summary">{row.humanSummary}</div>
      {!expired && (
        <div className="actions">
          <button type="button" onClick={async () => { try { await action.confirm(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } }}>Confirm</button>
          <button type="button" onClick={async () => { try { await action.undo(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } }}>Undo</button>
        </div>
      )}
      {error && <div className="row-error">{error}</div>}
    </div>
  );
}
```

This component is **not** wired into `<ConsoleView>` in v1. The spec ships the component and the hook so Phase 3's activity trail rewrite can pick them up. The component is fully tested in isolation. Phase 3 (or a v1.0.5 follow-up) decides where it lands inside the trail. Until then, it is dormant code with no consumer — explicitly justified by the cross-stream coordination constraint.

**Justification for shipping unwired UI:** the alternative — wiring it into the trail in this PR — would force this initiative to edit an activity-trail file that Phase 3 may also touch, breaking the parallel guarantee. Shipping the component without a consumer is the cheapest way to keep the v1-shadow loop completable end-to-end while honoring the file-level merge-isolation rule. The follow-up wiring is one line in `<ConsoleView>` (or the trail zone) once Phase 3 lands.

**9. CSS.** No changes to `console.css` for the queue-side card (Phase 2 already styles it). New CSS for `<ShadowActionRow>` lives in a new file `apps/dashboard/src/components/console/zones/shadow-action-row.css` co-located with the component. Phase 3's trail rewrite will likely fold these styles into the trail's stylesheet later; for now they are isolated to keep the merge surface zero.

---

### Emit-side — ad-optimizer sink + AgentEvent rollup

**Sink integration in `packages/ad-optimizer/src/audit-runner.ts`.** The audit-runner already gathers `recommendations: RecommendationOutput[]` (line 425). At the end of an audit run, after the existing recommendations array is finalized:

```ts
let routedQueue = 0;
let routedShadow = 0;
let dropped = 0;

for (const rec of recommendations) {
  const result = await emitRecommendation(deps.recommendationStore, {
    orgId,
    agentKey: "nova",
    intent: `recommendation.${rec.action}`,
    action: rec.action,
    humanSummary: humanizeRecommendation(rec),
    confidence: rec.confidence,
    dollarsAtRisk: estimateRisk(rec),
    riskLevel: urgencyToRiskLevel(rec.urgency),
    parameters: { ...rec.params, presentation: buildPresentation(rec) },
    targetEntities: { campaignId: rec.campaignId, campaignName: rec.campaignName },
    expiresAt: urgencyToExpiry(rec.urgency),  // 8h urgent | 24h normal | 7d info
    sourceWorkflow: auditRunId,
  });
  if (result.surface === "dropped") dropped++;
  else if (result.surface === "shadow_action") routedShadow++;
  else routedQueue++;
}

if (dropped > 0) {
  await deps.agentEventStore.record({
    orgId,
    agentKey: "nova",
    eventType: "recommendation.batch_summary",
    summary: `Nova reviewed ${recommendations.length} ad sets. ${routedQueue} flagged for review, ${routedShadow} auto-actioned, ${dropped} below confidence threshold.`,
    metadata: { auditRunId, routedQueue, routedShadow, dropped },
  });
}
```

**`humanizeRecommendation()`** is a hand-rolled function in the audit-runner (or a sibling file) that maps `RecommendationOutput.action` (`"pause" | "reduce_budget" | "add_creative" | ...`) to a human sentence with the campaign name and primary metric. v1 uses a `switch` statement covering the 5–6 actions ad-optimizer emits today. Fallback for unknown actions: the action name plus campaign name.

**`buildPresentation()`** picks button labels per action:

| action | primary | secondary | dismiss |
|---|---|---|---|
| `pause` | Pause | Reduce 50% | Dismiss |
| `reduce_budget` | Reduce 50% | Reduce 25% | Dismiss |
| `add_creative` | Add creatives | Adjust later | Dismiss |
| `consolidate` | Consolidate | Review | Dismiss |
| `kill` | Kill campaign | Pause instead | Dismiss |
| `expand_targeting` | Expand | Wait | Dismiss |
| `shift_budget` | Shift budget | Wait | Dismiss |
| `(unknown)` | Confirm | Adjust | Dismiss |

Plus `dataLines` — two lines: line 1 = the headline metric breach (`CPA $42 vs target $30`), line 2 = the secondary context (`7-day spend $1,240`). Both built from `rec.deltas` and `rec.estimatedImpact`.

**Dependency injection.** `deps.recommendationStore` and `deps.agentEventStore` are added to the audit-runner's constructor/factory. Wired in `apps/api/src/app.ts` where the audit-runner is instantiated. No new ad-optimizer files; the change is to `audit-runner.ts` and the wire-up file.

**Seed script — `scripts/seed-recommendation.ts`.** A small Node script for local dev. Fires one canned recommendation per agent against the dev DB so the console card renders without a real audit run. Reads `DATABASE_URL` from `.env`. Documented in the spec's "Local development" section.

---

### Tests

Per CLAUDE.md, every new module ships co-located tests. Vitest. Coverage: global 55/50/52/55, core 65/65/70/65.

| Module | Tests |
|---|---|
| `core/recommendations/router.test.ts` | All threshold branches: above/below shadow confidence, above/below shadow risk, above/below queue confidence, reversible/non-reversible action sets, edge cases (exactly at threshold). |
| `core/recommendations/emit.test.ts` | Validates input; computes surface; sets `undoableUntil` for shadow only; sets default `expiresAt`; idempotency (same key returns existing row); dropped returns `{surface: "dropped", id: null}` with no DB write. |
| `core/recommendations/act.test.ts` | Per-surface action validity (queue rejects `confirm`/`undo`; shadow rejects `primary`/`secondary`/`dismiss`); terminal-state guard returns `already_terminal`; lazy expiry transition; undo-window-closed on shadow after `undoableUntil`; org guard returns 403-equivalent; status transitions per action; AuditEntry written. |
| `db/src/__tests__/recommendation-store.test.ts` | Prisma roundtrip; idempotency unique constraint; `intent LIKE 'recommendation.%'` filter excludes workflow rows; org isolation; transaction atomicity for act + AuditEntry. |
| `apps/api/__tests__/routes/recommendations.test.ts` | List queue (returns only queue surface); list shadow (returns only shadow surface, since-filter); act primary success; act dismiss success; act on already-terminal returns 409 with current row; act with wrong action-for-surface returns 400; act on expired returns 409; org-mismatch returns 403; rate limit applied. |
| `apps/dashboard/src/hooks/__tests__/use-recommendations.test.tsx` | Disabled when no session; fetches from correct path; refetch interval; cache key uses `recommendations.queue()`. |
| `apps/dashboard/src/hooks/__tests__/use-shadow-actions.test.tsx` | Disabled when no session; fetches from `surface=shadow_action&since=24h`; cache key uses `recommendations.shadow()`. |
| `apps/dashboard/src/hooks/__tests__/use-recommendation-action.test.tsx` | All five actions call POST with correct body; 200 invalidates queries; 409 returns `{silent: true}` and does NOT throw; non-409 errors throw and do not invalidate. |
| `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts` | `mapRecommendationCard` maps presentation fields correctly; `confidenceToLabel` thresholds; `mapQueue` includes recommendations; missing presentation falls back to defaults. |
| `apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx` | Existing tests updated: primary/secondary/dismiss call mutation hook (not toast); success calls `onResolve`; error shows `.qerror`; 409 silently calls `onResolve` (recognized as already-resolved); button disabled while pending. |
| `apps/dashboard/src/components/console/zones/__tests__/shadow-action-row.test.tsx` | Renders rows from hook; Confirm calls `action.confirm()`; Undo calls `action.undo()`; expired rows hide buttons; error shows row-error; empty list renders nothing. |
| `apps/api/__tests__/routes/recommendations-isolation.test.ts` | Multi-org isolation: org A cannot list, get, or act on org B's recommendations (404/403 boundary). |
| `packages/ad-optimizer/src/__tests__/audit-runner-recommendation-sink.test.ts` | Sink calls `emitRecommendation` per recommendation; rollup `AgentEvent` written when `dropped > 0`; not written when `dropped === 0`; `humanizeRecommendation` covers all 7 action kinds. |

---

## Acceptance criteria

A reviewer running `pnpm dev` (with seeded recommendations) and opening `/console`:

1. ☐ The queue shows recommendation cards alongside escalation and approval-gate cards. Card visual is unchanged from Phase 2 (no CSS regressions).
2. ☐ Clicking Pause / Reduce 50% / Dismiss on a recommendation card fires a real POST to `/api/dashboard/recommendations`. The card fades out via the existing `is-resolving` animation. The card does NOT reappear on refetch.
3. ☐ Clicking Pause on a card that another tab already acted on results in a silent fade-out (409 swallowed) — no error toast, no double action.
4. ☐ Clicking Pause on a recommendation whose backend operation fails (simulate by killing the API) shows an inline `.qerror` row above `.qactions`. The card stays put. Operator can retry.
5. ☐ Running `pnpm tsx scripts/seed-recommendation.ts` creates one canned recommendation per agent in the dev DB. The console queue shows them after a refetch.
6. ☐ The router unit tests prove that a recommendation with `confidence=0.9, dollarsAtRisk=10, action="pause"` routes to `shadow_action`; one with `confidence=0.6, action="pause"` routes to `queue`; one with `confidence=0.3` routes to `dropped`.
7. ☐ A simulated dropped recommendation does NOT create a `PendingActionRecord` row. A batch with at least one dropped recommendation creates exactly one `AgentEvent` rollup row.
8. ☐ The dashboard's `<ShadowActionList>` component renders rows from `useShadowActions()` in unit tests. (Not yet wired into ConsoleView in v1 — explicit deferral to Phase 3 wiring.)
9. ☐ Confirming a shadow row transitions its status to `confirmed`; undoing transitions to `dismissed_by_undo`. Undo after `undoableUntil` returns 409.
10. ☐ Multi-org isolation tests pass: org A cannot list/get/act on org B's recommendations.
11. ☐ `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass.
12. ☐ `pnpm db:check-drift` passes after the migration is applied.
13. ☐ No file in this initiative exceeds 400 lines (CLAUDE.md soft cap).
14. ☐ `recommendation-card.tsx` diff is ≤30 lines and touches only the import block, the `fire()` function, the three onClick handlers, and adds one `.qerror` row.
15. ☐ `queue-zone.tsx` diff is ≤4 lines and touches only data flow (one hook call, one mapQueue arg, one invalidate-queries entry).
16. ☐ Phase 3's parallel branch (`feat/phase-3` worktree) merges cleanly with this branch — verified by attempting a dry-run merge before opening the implementation PR.

---

## Risks

- **`PendingActionRecord` schema migration.** Adding two columns (`surface`, `undoableUntil`) and two indexes to a table the workflow engine reads/writes. The default-value approach avoids a backfill, and the `intent LIKE 'recommendation.%'` filter keeps populations disjoint, but a careless query could surface workflow rows in the recommendations list. Mitigation: every store method that lists or filters recommendations applies the prefix filter; isolation test asserts no workflow rows leak. Migration is reviewed by anyone familiar with the workflow engine before merge.
- **Doctrine debt — act-side bypasses PlatformIngress.** v1 records acts via direct mutation + `AuditEntry`, not via `PlatformIngress.submit()`. This mirrors the legacy approval-response path and is registered in the Legacy Bridge Registry. Risk: if v1.5 or v2 lands without migrating, the debt grows. Mitigation: explicit registry entry, documented in DOCTRINE.md as part of this PR.
- **Shadow auto-actions without an executor.** v1 records "the system would have paused" but does nothing to the ad set. If an operator interprets the trail row as "the system paused this," they may not manually pause the ad set themselves and lose money on a continuing burn. Mitigation: row copy reads "Nova flagged for auto-pause — confirm or undo" rather than "Paused by Nova." The spec mandates this exact phrasing for shadow rows pre-v2-executor.
- **Cross-stream merge collision.** `queue-zone.tsx` is edited by both this initiative (2-line additive) and potentially by Phase 3. Mitigation: dry-run merge before opening this initiative's impl PR; if a real collision exists, this initiative's `queue-zone.tsx` change rebases onto Phase 3's.
- **Seed script depends on dev DB shape.** A future Prisma schema change could break `scripts/seed-recommendation.ts`. Mitigation: the script imports types from the generated Prisma client and is included in `pnpm typecheck`. If types break, the script breaks at build time, not at runtime.
- **`<ShadowActionRow>` shipped unwired.** The component exists with no consumer. Risk: dead code that decays. Mitigation: a follow-up issue ("Wire ShadowActionList into trail surface") is opened against the docs PR; the component carries a one-line comment naming the issue. If Phase 3 doesn't wire it within 2 weeks, a small follow-up PR adds it to ConsoleView directly.

---

## Out-of-scope follow-ups

- **v1.5 — Org-level mode dropdown.** Add a single org-config field `automationMode: "conservative" | "balanced" | "aggressive"`. Replace the `BALANCED` constants in `router.ts` with a mode lookup. UI: one dropdown in `/settings`. Defaults: Balanced.
- **v2 — Real platform-call executor.** Wire `confirm` to call Meta/Google APIs to actually pause / reduce / add. Route through `PlatformIngress.submit({ intent: "execute.recommendation", ... })`. Real undo (un-pause) instead of just status flip. This is the spec that retires the legacy-bridge debt registered in DOCTRINE.md by this PR.
- **v3+ — Per-agent operator-tunable thresholds.** Only if v2 ships and operators ask for it. Not a goal.
- **Phase 3 wiring of `<ShadowActionList>`.** When Phase 3 lands, fold the trail-row component into the new activity trail surface.
- **Sweep job for expired recommendations.** v1 uses lazy expiry on read+write; if drift becomes visible (operator sees stale "pending" rows that should be expired), add a periodic background job.
- **Bulk actions.** Operator selects N recommendations and acts on them as a group. Not in v1.
- **Recommendation explanation panels.** "Why did Nova suggest this" — Phase 3 Nova panel concern.
- **CRM-side recommendations via OwnerTask.** Lead-side suggestions ("call this lead, contact went cold") are a separate initiative on `OwnerTask` — same routing rail, different surface, different emitter. Out of scope for this v1.

---

## Open questions

None. All seven brainstorm decision-heuristics resolved with the user (2026-05-03):

1. State machine — pending / acted / dismissed / confirmed / dismissed_by_undo / expired; lazy expiry.
2. Emitter — ad-optimizer audit-runner sink + seed script.
3. Side effects — none in v1; v2 wires real executor.
4. expiresAt — emitter-supplied or default 24h.
5. Audit — AuditEntry per act; no WorkTrace; not through PlatformIngress (legacy-bridge debt).
6. Idempotency — first-write-wins; 409 with current row on terminal-state writes; frontend swallows 409 as silent success.
7. Multi-org isolation — `requireOrganizationScope` + `intent LIKE` filter + per-id orgId guard.

Plus three more locked at the routing-rail design step:

8. Auto-actions ship — yes, as shadow only in v1.
9. Router — hardcoded Balanced thresholds in `router.ts`; v1.5 introduces single org-level mode dropdown; v3+ per-agent.
10. Undo — ships in v1 with 24h window.
