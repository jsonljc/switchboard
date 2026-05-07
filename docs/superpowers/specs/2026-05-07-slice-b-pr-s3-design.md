# Slice B PR-S3 — B3 Recent Wins live (design)

**Date**: 2026-05-07
**Author**: Jason (with Claude)
**Status**: Draft for review
**Parent spec**: `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` (PR #376 → main)
**Sibling PRs**: PR-S1 merged (#366), PR-S2 in flight (#369), PR-S4/S5/S6 unstarted

---

## 1. What this PR does

Take the agent-home **B3 Recent Wins** block from fixture data to live data. After this PR, when an operator opens `/alex` (or `/riley`), the wins block reads from `PendingActionRecord` via a new `packages/core/src/agent-home/wins.ts` projection, served through a new `/api/dashboard/agents/[agentId]/wins` endpoint, with per-agent voice in win prose and an Undo affordance that respects `undoableUntil`.

PR-S3 adds **one new vertical slice** (core projection → api route → dashboard proxy → live hook) and extends `dispatch-action.ts` with an `"undo"` action branch. No schema migrations. No UI restyling. No new view-model fields.

---

## 2. Locked decisions

These five decisions were resolved during brainstorming and are **not open for re-litigation in implementation**. Each links to the evidence in `.agent/notes/agent-home-wins-audit.md`.

### Q1 — Source priority: recommendations only (narrows parent spec)

PR-S3 sources wins from `PendingActionRecord` only. Bookings and ConversionRecord are explicitly **deferred** to a follow-up PR (call it PR-S3.1).

**Why**: Neither `Booking` nor `ConversionRecord` has a direct agent-attribution field. `Booking` has `workTraceId` (opaque), `ConversionRecord` has `agentDeploymentId` (not per-agent). Implementing them requires either a schema migration (add `createdByAgent: AgentKey?`) or a `WorkTrace → Agent` bridge — both larger than PR-S3 should be. See `.agent/notes/agent-home-wins-audit.md` §5–6.

**Spec deviation**: Parent spec (lines 243–245, 771) calls for all three sources with `DepResult<T>` fan-out. PR-S3 deliberately narrows that. PR-S3.1 will add bookings + conversions once the agent-attribution schema lands.

### Q2 — Per-agent voice config: match PR-S2 precedent

`AGENT_VOICE_CONFIGS: Record<"alex" | "riley", WinsVoiceConfig>` constant at the top of `wins.ts`. Inline `if (agentKey === "alex") … else …` branches in the prose builder. No new pattern.

**Why**: PR-S2's `greeting.ts` just established this pattern (`AGENT_CONFIGS: Record<…>` + inline branches in `buildSegments`). Consistency across the agent-home directory is more valuable than purity. See `packages/core/src/agent-home/greeting.ts` (on `feat/slice-b-pr-s2-greeting-live`).

### Q3 — `timeFolio` formatter: lives in core

```ts
// packages/core/src/agent-home/time-folio.ts
export function formatTimeFolio(occurredAt: Date, now: Date, timezone: string): string;
```

Returns `"11:42 AM"` for same-day, `"Yesterday · 6:14 PM"` for prior day, `"Mon · 11:42 AM"` for same-week, `"May 3 · 11:42 AM"` for older. Hours/minutes always 12-hour with AM/PM.

**Timezone source**: Read `OrganizationConfig.timezone` if present; fall back to `"Asia/Singapore"` (matches `Booking.timezone` default). The fallback is a documented gap to revisit when an explicit org-tz field is added — recorded in `.agent/notes/agent-home-wins-audit.md` §11.

**Lives in core, not in the api route**, because view-model composition is the projection's job. The api route is dumb plumbing.

### Q4 — Pagination: cap at 5, `hasMore: true` is a flag

`getAgentWinsViewModel` queries `listBySurface` with `limit: 6`, slices to 5 for the response, and sets `hasMore: rawRows.length > 5`. No cursor. No `?limit` query parameter. `/{agent}/wins` is `ROUTE_AVAILABILITY: false` in PR-S3 (see parent spec §4.2 line 346), so `hasMore: true` is a flag the UI may use to render "see more →" against a disabled link.

**Why 5**: matches the design bundle's recent-wins block (5 tiles visible on agent home). More belongs on a `/{agent}/wins` page that doesn't exist yet.

### Q5 — Undo flow: WinTile owns the button, dispatch-action gets a fourth branch

The Undo button lives on the **WinTile** (rendered inside `WinsBlock`). Click flow:

1. Component calls a thin handler → `dispatchDecisionAction({ kind: "approval", sourceId: winId }, "undo", undefined, context)`.
2. `dispatch-action.ts` extends its action union from `"primary" | "secondary" | "dismiss"` → `"primary" | "secondary" | "dismiss" | "undo"`. The `"approval"` case already POSTs `/api/dashboard/recommendations` with `{ recommendationId, action }` — adding `"undo"` to the union routes it through the same plumbing.
3. The api endpoint `POST /api/recommendations/:id/act` already accepts `action: "undo"` and returns 409 with `error: "undo_window_closed"` if past the window. No new endpoint.
4. Existing invalidation at `dispatch-action.ts:86` — `keys.wins.byAgent(agentKey)` — already covers wins; `keys.decisions.feed(agentKey)` covers the inbox count badge that may shift when the recommendation transitions to `dismissed_by_undo`.

**Status transition**: `confirmed → dismissed_by_undo` (per actual `RecommendationStatus` enum), **not** `confirmed → pending` (which the parent spec implied but is wrong). The wins query filters out `dismissed_by_undo` — an undone action is no longer a win.

---

## 3. View-model contract

Locked in parent spec §B3 (lines 242–266). Quoted here for proximity, not redefined:

```ts
export type WinSource = "recommendation" | "booking" | "conversion";

export interface WinViewModel {
  id: string;
  agentKey: AgentKey;
  source: WinSource;
  occurredAt: string; // ISO
  timeFolio: string; // "11:42 AM" / "Yesterday · 6:14 PM"
  proseSegments: readonly ProseSegment[];
  undo: {
    available: boolean;
    until: string | null; // ISO
    unavailableReason?: "expired" | "not-reversible" | "missing-permission";
  };
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}
```

In PR-S3, every `win.source === "recommendation"`. The `WinSource` union retains the other two members so PR-S3.1 lands without a contract churn.

`freshness.unavailableSources` will always be `undefined` in PR-S3 (the only source — recs — is required and throws on failure). The field stays in the type so PR-S3.1's optional-source flow doesn't require a contract change.

---

## 4. Win classification rules

Which terminal `PendingActionRecord` rows count as wins, given the actual `RecommendationStatus` enum (`pending | acted | dismissed | confirmed | dismissed_by_undo | expired`):

| Status              | Counts as win? | Rationale                                                                |
| ------------------- | -------------- | ------------------------------------------------------------------------ |
| `acted`             | **Yes**        | Operator took the primary action (sent invite, replied, etc.).           |
| `confirmed`         | **Yes**        | Operator confirmed the recommendation off-platform; undo window is open. |
| `dismissed`         | **No**         | Operator rejected — not a win, never shows up here.                      |
| `dismissed_by_undo` | **No**         | Operator undid a `confirmed` win — withdrawn, no longer counted.         |
| `expired`           | **No**         | Auto-expired without action.                                             |
| `pending`           | **No**         | Still in the inbox.                                                      |

**Spec deviation note**: Parent spec line 771 lists "status resolved/dismissed/confirmed" as the terminal set. That phrase is the parent-spec author's shorthand for "terminal recommendations." But `dismissed` is semantically a rejection, not a win — surfacing rejections in a "Recent Wins" block would be wrong product behaviour. PR-S3 narrows to `{acted, confirmed}` only. PR-S3.1 may revisit if product decides dismissals deserve their own surface.

`undo.available` is computed at read time:

- `acted`: `available: false`, `unavailableReason: "not-reversible"` (sending a message is irreversible). `until: null`.
- `confirmed`: `available: now < undoableUntil`. If `now >= undoableUntil`, `available: false`, `unavailableReason: "expired"`. `until: undoableUntil.toISOString()`.

`"missing-permission"` is reserved for a future role-aware policy and is not emitted in PR-S3.

---

## 5. Backend — `packages/core/src/agent-home/wins.ts`

Mirrors PR-S2 `greeting.ts` shape exactly (single store interface, no `DepResult` fan-out):

```ts
// packages/core/src/agent-home/wins.ts

export type WinSource = "recommendation" | "booking" | "conversion";
export type WinTimeWindow = "today" | "week" | "month";

export interface WinTerminalRecord {
  id: string;
  agentKey: AgentKey;
  status: "acted" | "confirmed"; // store filters to these two
  intent: string; // e.g. "recommendation.send_tour_invite"
  humanSummary: string; // already-composed summary written at insert time
  occurredAt: Date; // resolvedAt
  undoableUntil: Date | null;
  targetEntities: unknown; // Json — read defensively
}

export interface WinsSignalStore {
  listTerminalRecommendations(input: {
    orgId: string;
    agentKey: AgentKey;
    sinceMs: number;
    limit: number; // request limit + 1 for hasMore
  }): Promise<WinTerminalRecord[]>;
}

export interface WinsAgentConfig {
  agentKey: "alex" | "riley";
  // Voice constants live here so the prose builder is a pure switch on intent.
  ackPhrase: string; // "Sent." vs. "Done."
  defaultUndoLabel: string;
}

const AGENT_VOICE_CONFIGS: Record<"alex" | "riley", WinsAgentConfig> = {
  alex: {
    agentKey: "alex",
    ackPhrase: "Sent.",
    defaultUndoLabel: "Undo last reply",
  },
  riley: {
    agentKey: "riley",
    ackPhrase: "Adjusted.",
    defaultUndoLabel: "Revert change",
  },
};

export interface ProjectWinsInput {
  orgId: string;
  agentKey: "alex" | "riley";
  window: WinTimeWindow;
  now: Date;
  timezone: string; // resolved upstream by the route
  store: WinsSignalStore;
}

export async function projectWins(input: ProjectWinsInput): Promise<WinsViewModel> {
  const { orgId, agentKey, window, now, timezone, store } = input;
  const sinceMs = windowStartMs(window, now);
  const limit = 5;

  const rows = await store.listTerminalRecommendations({
    orgId,
    agentKey,
    sinceMs,
    limit: limit + 1,
  });

  const visible = rows.slice(0, limit);
  const config = AGENT_VOICE_CONFIGS[agentKey];

  return {
    wins: visible.map((row) => buildWinViewModel(row, config, now, timezone)),
    hasMore: rows.length > limit,
    freshness: {
      generatedAt: now.toISOString(),
      window,
      dataSource: "live",
    },
  };
}
```

`buildWinViewModel`, `composeWinProse`, `computeUndo` — all pure functions with co-located unit tests.

`windowStartMs(window, now)` returns the epoch-ms boundary for `today | week | month`. Today = midnight in `timezone`. Week = Monday 00:00. Month = first of the month 00:00. Same helper as PR-S5 will need for metrics (move to a shared helper if both ship in the same window).

**Mira excluded by type**: `agentKey: "alex" | "riley"` (not `AgentKey`). Mira returns 404 at the route layer.

---

## 6. API layer — `apps/api/src/routes/agent-home/wins.ts`

```ts
GET /api/dashboard/agents/:agentId/wins?window=today
  → 200 { vm: WinsViewModel }
  → 401 if no session
  → 404 if agentId not in AGENT_KEYS or agent disabled for org
  → 500 on store failure
```

Same auth, isolation, and shape as the existing `/api/dashboard/agents/:agentId/decisions` endpoint:

- `requireOrganizationScope(request, reply)` for orgId.
- `AgentKeySchema.parse(params.agentId)` — `mira` is in the schema; route guard returns 404 for it (matches Slice B exclusion).
- `OrgAgentEnablement` check — same helper the decisions route uses.
- Default `window: "today"`. Validate via `z.enum(["today", "week", "month"])`.

Wires `PrismaRecommendationStore.listBySurface` into the `WinsSignalStore` adapter:

```ts
const store: WinsSignalStore = {
  async listTerminalRecommendations({ orgId, agentKey, sinceMs, limit }) {
    const rows = await app.recommendationStore.listBySurface({
      orgId,
      surface: "queue",
      sinceMs,
      limit,
    });
    return rows
      .filter((r) => r.agentKey === agentKey && (r.status === "acted" || r.status === "confirmed"))
      .map(toWinTerminalRecord);
  },
};
```

`toWinTerminalRecord` maps DB row → core type. Note the **client-side filter** by agentKey + status — `listBySurface` doesn't yet take `agentKey` or a status set. Acceptable for v1: we cap at `limit + 1 = 6` after the in-memory filter, and the store already caps at 200 raw rows. If this becomes a hot path, push the filter into the store (deferred — flagged in §10).

**Timezone resolution**: Look up via `app.organizationConfigStore?.getByOrgId(orgId)?.timezone ?? "Asia/Singapore"`. If `OrganizationConfig` lacks the field, the fallback applies. Recorded in `.agent/notes/agent-home-wins-audit.md` §11.

**Test pattern**: Mocked Prisma per `.cursor` convention (`feedback_api_test_mocked_prisma.md`). Built with `buildTestServer`. Cross-org isolation extends `api-decisions-isolation.test.ts` (or `api-agent-home-isolation.test.ts` if PR-S2 created it).

---

## 7. Dashboard proxy — `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/route.ts`

Thin tunnel — copy the `decisions/route.ts` pattern that PR-S1 / PR-S2 follow:

1. `requireDashboardSession()` → 401 if absent.
2. `AGENT_KEYS.includes(agentId)` → 400 if false.
3. `getApiClient().get(`/api/dashboard/agents/${agentId}/wins?window=${window}`)`.
4. Return upstream JSON or surface upstream error code.

Window passes through query string. Default to `"today"` if absent.

---

## 8. Hook — `apps/dashboard/src/hooks/use-agent-wins.ts`

Today (PR-S1, fixture):

```ts
export function useAgentWins(agentKey: AgentKey): AgentBlockQuery<WinsViewModel> {
  return { data: getFixtureWins(agentKey), isLoading: false, isError: false, error: null };
}
```

After PR-S3 (live):

```ts
export function useAgentWins(
  agentKey: AgentKey,
  window: "today" | "week" | "month" = "today",
): AgentBlockQuery<WinsViewModel> {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys ? keys.wins.feed(agentKey, window) : ["wins-disabled"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentKey}/wins?window=${window}`);
      if (!res.ok) throw new Error(`Wins fetch failed (HTTP ${res.status})`);
      const json = await res.json();
      return json.vm as WinsViewModel;
    },
    enabled: keys !== null,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
  };
}
```

Query key already exists at `apps/dashboard/src/lib/query-keys.ts:163-169` — `keys.wins.feed(agentKey, window)` and `keys.wins.byAgent(agentKey)` for prefix invalidation.

The `window` parameter defaults to `"today"`; UI does not yet pass anything else. Surface for future window-switcher UI without a hook signature change.

---

## 9. WinTile undo wiring

`apps/dashboard/src/components/agent-home/wins-block.tsx` already exists from PR-S1 (renders fixture wins). PR-S3 adds the undo button to the per-tile renderer. Pseudocode:

```tsx
function WinTile({ win, agentKey }: { win: WinViewModel; agentKey: AgentKey }) {
  const { mutate, isPending } = useUndoWin(); // tiny wrapper; see below
  return (
    <article>
      <header>{win.timeFolio}</header>
      <ProseSegments segments={win.proseSegments} />
      {win.undo.available && (
        <button
          type="button"
          onClick={() => mutate({ winId: win.id, agentKey })}
          disabled={isPending}
        >
          Undo
        </button>
      )}
      {!win.undo.available && win.undo.unavailableReason === "expired" && (
        <span className="dc-resolved-line">
          <em>Undo window closed</em>
        </span>
      )}
    </article>
  );
}
```

`useUndoWin` is a 15-line hook that calls `dispatchDecisionAction({ kind: "approval", sourceId: winId }, "undo", undefined, context)`. Lives at `apps/dashboard/src/hooks/use-undo-win.ts`.

---

## 10. Files added / modified

**Added**

- `packages/core/src/agent-home/wins.ts` + `__tests__/wins.test.ts`
- `packages/core/src/agent-home/time-folio.ts` + `__tests__/time-folio.test.ts`
- `apps/api/src/routes/agent-home/wins.ts` + `__tests__/wins.test.ts`
- `apps/dashboard/src/app/api/dashboard/agents/[agentId]/wins/route.ts` + `__tests__/route.test.ts`
- `apps/dashboard/src/hooks/use-undo-win.ts` + `__tests__/use-undo-win.test.tsx`

**Modified**

- `packages/core/src/agent-home/index.ts` — re-export `projectWins`, `formatTimeFolio`, related types.
- `apps/dashboard/src/lib/decisions/dispatch-action.ts` — extend action union to include `"undo"`. Two-line change.
- `apps/dashboard/src/hooks/use-agent-wins.ts` — fixture form → live form (signature stays the same; adds optional `window` param).
- `apps/dashboard/src/hooks/__tests__/use-agent-wins.test.tsx` — replace fixture test with live test (mocked fetch).
- `apps/dashboard/src/components/agent-home/wins-block.tsx` — add Undo button to tile renderer; consume `win.undo` shape.
- `apps/dashboard/src/components/agent-home/__tests__/wins-block.test.tsx` — extend to cover undo states (available, expired, not-reversible, hidden).
- `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts` — remove `wins` fixture export.
- `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts` — remove the wins fixture test entry.
- `apps/api/src/__tests__/api-agent-home-isolation.test.ts` (or `api-decisions-isolation.test.ts` extension) — add a wins-isolation case.

**Not removed**

- `getFixtureWins` helper in `_fixtures.ts` is removed; the rest of the fixture file stays for metrics/pipeline (S4/S5 will remove their slices).
- `FixtureFolioBadge` component stays (parent spec §PR-S6 confirms).

---

## 11. Acceptance criteria

1. `GET /api/dashboard/agents/alex/wins` returns `{ vm: WinsViewModel }` with `wins` sourced from the org's terminal `PendingActionRecord` rows where `sourceAgent = "alex"` and `status ∈ {acted, confirmed}`. Same for `riley`. `mira` returns 404.
2. `WinsViewModel.freshness.dataSource === "live"` (no FIXTURE badge).
3. `wins[*].timeFolio` formatted per §4 (Q3 rules), in the org's timezone (or `Asia/Singapore` fallback).
4. Per-agent voice differs verifiably between alex and riley win prose (separate test cases assert this).
5. Wins are capped at 5; `hasMore: true` exactly when more than 5 terminal rows exist in the window.
6. `undo.available` is `true` only for `confirmed` rows where `now < undoableUntil`; `false` otherwise with the right `unavailableReason`.
7. Clicking Undo on a `confirmed` win:
   - POSTs `action: "undo"` to `/api/dashboard/recommendations`.
   - On 200: invalidates wins + decisions query keys (already wired in `dispatch-action.ts`); the win disappears from the list on next render (its status is now `dismissed_by_undo`).
   - On 409 `undo_window_closed`: surfaces an inline "Undo window closed" message under the tile (no retry; no global toast system in v1).
8. Cross-org isolation: an isolation test confirms Org B cannot see Org A's wins.
9. Empty state: when zero wins exist, the block renders the parent-spec §7.3 copy `"No wins to show yet. {agentName} is still warming up."`.
10. Production gate is unchanged from PR-S1 — `/alex` is still gated until PR-S6.

---

## 12. Test plan (mirrors parent spec §8.1)

| Layer           | Tests                                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core            | `projectWins` — empty list, single win, capped at 5, hasMore true/false, alex voice differs from riley voice (snapshot of `proseSegments`), undo states (available/expired/not-reversible). `formatTimeFolio` — same-day, yesterday, this-week, older, midnight boundary, timezone respected. `windowStartMs` — today/week/month edges. |
| API route       | Mocked Prisma (`buildTestServer`). Cases: 200 happy path, 401 no session, 404 unknown agent, 404 disabled agent, 404 `mira`, 200 with org A doesn't include org B's rows, 500 on store throw. Window query param accepted.                                                                                                              |
| Dashboard proxy | Rejects unauthenticated, validates `agentKey ∈ AGENT_KEYS`, forwards to api with window query, surfaces upstream errors as JSON.                                                                                                                                                                                                        |
| Hook            | `useAgentWins` — happy path returns vm, sets data; isError on bad fetch; query key uses `keys.wins.feed`.                                                                                                                                                                                                                               |
| Undo hook       | `useUndoWin` — happy path POSTs to dispatch-action; 409 surfaces toast; invalidation happens (assert via `queryClient.invalidateQueries` mock).                                                                                                                                                                                         |
| Component       | `WinsBlock` — fixture-folio badge absent for live data; tile renders prose + undo button when `available`; "Undo window closed" line when expired; no button when `not-reversible`; empty state copy.                                                                                                                                   |
| Isolation       | Extend `api-agent-home-isolation.test.ts` (or `api-decisions-isolation.test.ts`) to assert wins endpoint never returns Org B's rows.                                                                                                                                                                                                    |

Coverage thresholds remain at parent-spec values (core 65/65/70/65, dashboard global 55/50/52/55).

---

## 13. Out of scope (explicitly deferred)

| Item                                                                     | Why deferred                                                          | Future PR |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------- |
| Booking + ConversionRecord as optional sources                           | Both lack agent attribution; needs schema migration or WorkTrace map. | PR-S3.1   |
| `DepResult<T>` fan-out infrastructure                                    | One required source in v1 — no value to add. Lands with PR-S3.1.      | PR-S3.1   |
| `/{agent}/wins` page (full-list view)                                    | `ROUTE_AVAILABILITY: false` already; `hasMore: true` is a UI flag.    | Phase D   |
| Window-switcher UI (today/week/month picker)                             | Backend supports it; no UI ships in PR-S3.                            | Future    |
| Push-down filtering (move agentKey + status filter into `listBySurface`) | Post-launch perf optimization; current limits keep query bounded.     | Optional  |
| Org-timezone schema field                                                | Hardcoded fallback to `"Asia/Singapore"`; parent backlog.             | Future    |
| Cross-agent wins inbox                                                   | `WinViewModel.agentKey` already on the type; UI ships per-agent only. | Phase D   |
| `unavailableReason: "missing-permission"`                                | Reserved for future role-aware policy.                                | Future    |
| Toast / global notification system                                       | PR-S3 surfaces undo-failure as inline text under the tile.            | Future    |

---

## 14. Risks & mitigations

| Risk                                                                                        | Mitigation                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org-tz fallback masks production bugs (operator in NY sees Singapore times).                | Document gap in spec + audit notes. Not blocking — `Asia/Singapore` is the same fallback `Booking.timezone` defaults to. Add an org-tz field in a follow-up PR.                                                                                 |
| `dismissed_by_undo` semantics differ from parent-spec mental model (`confirmed → pending`). | Document in §2 Q5 + §4 win-classification. Wins query filters out `dismissed_by_undo`, so the user-visible behaviour matches "win disappears on undo" — only the internal status differs.                                                       |
| Client-side filter on agentKey + status defeats the store's index in pathological orgs.     | Cap at 200 raw rows (existing) + cap at 6 visible. Acceptable for launch. Push-down deferred.                                                                                                                                                   |
| Undo race: operator clicks Undo just as `undoableUntil` passes.                             | Server returns 409 `undo_window_closed`; client surfaces "Undo window closed" toast; query invalidation refreshes the tile to show `unavailableReason: "expired"`. No client-side time check needed.                                            |
| `dispatch-action.ts` now handles four actions instead of three.                             | Type-checked union extension. Existing tests for primary/secondary/dismiss continue to assert their branches; one new test for undo. Two-line change to the union; no other callers affected because the function shape is otherwise identical. |
| PR-S3 lands before PR-S2.                                                                   | PR-S3 has no dep on greeting going live; the `dispatch-action.ts` invalidation of `keys.greeting.feed(agentKey)` already exists from PR-S1. If PR-S2 hasn't merged, greeting still serves fixture data — wins works regardless.                 |

---

## 15. Sequencing

PR-S3 has no blocking dependency on PR-S2. It depends only on:

- PR-S1 (#366) — merged. Provides fixtures, `WinsViewModel` type, `WinsBlock` component, `use-agent-wins` hook stub, `dispatch-action.ts` with wins invalidation already wired, query keys.
- The slice-B parent spec being on main — PR #376 currently open. **PR-S3 development can start immediately** in a worktree off `origin/main`; the spec file itself is referenced from this PR-S3 design doc but is not a code dependency.

After PR-S3 merges, PR-S4 (B5 Pipeline live), PR-S5 (B4 Metrics live), and PR-S3.1 (bookings + conversions) can run in parallel.

---

## 16. References

- `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` — parent slice-B spec (PR #376).
- `.agent/notes/agent-home-wins-audit.md` — backend audit driving every Q1–Q5 decision.
- `.agent/notes/data-models.md`, `.agent/notes/api-surface.md`, `.agent/notes/dashboard-surface.md`, `.agent/notes/core-packages.md` — persistent capability map for future sessions.
- `packages/core/src/agent-home/greeting.ts` (on `origin/feat/slice-b-pr-s2-greeting-live`) — PR-S2 precedent for store interface + voice config + prose builder shape.
- `apps/api/src/routes/recommendations.ts` — confirms POST `/:id/act` accepts `action: "undo"` and returns 409 `undo_window_closed`.
- `apps/dashboard/src/lib/query-keys.ts:163-169` — wins query keys already defined.
- `apps/dashboard/src/lib/decisions/dispatch-action.ts:86` — wins invalidation already wired.
