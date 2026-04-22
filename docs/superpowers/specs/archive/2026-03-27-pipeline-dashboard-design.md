# Pipeline Funnel Dashboard + Dockerfile Fix — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Depends on:** Unified Lifecycle spec (2026-03-25), Opportunity-Based Routing (PR #180)

---

## 1. Problem Statement

The owner dashboard shows stat cards with leads and bookings, but revenue is hardcoded to `"$0"` and there's no visibility into the sales pipeline. The `GET /lifecycle/pipeline` API already returns `PipelineSnapshot` data (per-stage counts, values, total revenue), but no dashboard component consumes it. Without a funnel view, the owner can't see "leads becoming money" — the core product value prop.

Additionally, the Dockerfile uses `--no-frozen-lockfile` across all install stages, producing non-reproducible builds.

---

## 2. Design Decisions

| Decision                     | Choice                                   | Rationale                                                                                              |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Where to show the funnel     | Embedded in `OwnerToday` home page       | Owner sees pipeline every visit without navigating. One API call, compact visual.                      |
| Visualization style          | Horizontal stage bars                    | Intuitive funnel metaphor, works at a glance for small business owners.                                |
| Which stages to show as bars | 6 forward-flow stages (interested → won) | Lost/nurturing aren't forward funnel — they break the narrowing visual. Shown as summary counts below. |
| Revenue stat card            | Wire to `PipelineSnapshot.totalRevenue`  | API already returns it; replaces hardcoded `"$0"`.                                                     |
| Click-through to CRM         | Not now                                  | CRM page doesn't support stage filtering. Add later.                                                   |
| Date filtering               | Not now                                  | API returns all-time data. Add later.                                                                  |

---

## 3. Changes

### 3.1 Dashboard Proxy Route

**File:** `apps/dashboard/src/app/api/dashboard/pipeline/route.ts`

Proxies authenticated requests to `GET /lifecycle/pipeline` on the API server. Follows the existing proxy pattern used by other dashboard API routes (e.g., operator-chat proxy).

```typescript
// GET /api/dashboard/pipeline → GET /lifecycle/pipeline
export async function GET(request: NextRequest) {
  // Forward auth headers to API server
  // Return PipelineSnapshot JSON
}
```

### 3.2 `usePipeline` Hook

**File:** `apps/dashboard/src/hooks/use-pipeline.ts`

React Query hook wrapping the proxy endpoint. Returns typed `PipelineSnapshot` data.

```typescript
export function usePipeline() {
  return useQuery({
    queryKey: queryKeys.pipeline.snapshot,
    queryFn: () => fetch("/api/dashboard/pipeline").then((r) => r.json()),
    staleTime: 30_000, // refresh every 30s
  });
}
```

Add `pipeline` to `queryKeys` in `apps/dashboard/src/lib/query-keys.ts`.

### 3.3 `PipelineFunnel` Component

**File:** `apps/dashboard/src/components/dashboard/pipeline-funnel.tsx`

Renders the pipeline as horizontal bars for the 6 forward-flow stages, with lost/nurturing as a summary line below.

**Layout:**

```
"Your pipeline"
████████████████████████  Interested   12  $6,000
██████████████████        Qualified     8  $4,500
████████████              Quoted        5  $3,200
████████                  Booked        4  $2,800
██████                    Showed        3  $1,500
████                      Won           2  $1,200
4 lost · 2 nurturing
```

**Bar sizing:** Width proportional to count relative to the maximum count across all 6 stages. Minimum width of 8% so even zero-count stages are visible as thin bars.

**States:**

- **Loading:** Skeleton bars (pulsing placeholder rectangles)
- **Empty:** "No leads in your pipeline yet" message
- **Error:** Silent fail — section hidden (non-critical data)

**Stage display order:** `interested`, `qualified`, `quoted`, `booked`, `showed`, `won` (hardcoded, not derived from data order).

**Stage colors:** Use the existing dashboard color palette. Each stage gets a subtle color that darkens as the funnel narrows (e.g., lightest at interested, darkest at won).

**Currency formatting:** Use `Intl.NumberFormat` with the org's locale (or default `en-US`). Values shown as `$1,200` format.

### 3.4 Wire Revenue Stat Card

**File:** `apps/dashboard/src/components/dashboard/owner-today.tsx`

Replace the hardcoded `"$0"` revenue stat with `PipelineSnapshot.totalRevenue`:

```typescript
// Before:
{ label: "Revenue", value: "$0" }

// After:
{ label: "Revenue", value: formatCurrency(pipelineData?.totalRevenue ?? 0) }
```

The `usePipeline` hook is called in `OwnerToday` and the data is shared between the stat card and the `PipelineFunnel` component (single fetch, no duplicate requests).

### 3.5 Integration in OwnerToday

Insert the `PipelineFunnel` section between the stat cards and the approvals section:

```
[StatCards]
[PipelineFunnel]     ← NEW
[Needs you]
[What happened]
```

### 3.6 Dockerfile Fix

**File:** `Dockerfile`

Replace `--no-frozen-lockfile` with `--frozen-lockfile` on all 4 `pnpm install` commands (lines 26, 78, 126, 186). This ensures reproducible production builds by requiring an exact match with `pnpm-lock.yaml`.

---

## 4. What Does NOT Change

- **No new pages** — no `/pipeline` route
- **No nav changes** — no new sidebar items
- **No new API endpoints** — `GET /lifecycle/pipeline` already exists
- **No CRM click-through** — funnel bars are static
- **No date filtering** — shows all-time data
- **No backend changes** (except Dockerfile)

---

## 5. File Impact Summary

| File                                                          | Change                                           |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `apps/dashboard/src/app/api/dashboard/pipeline/route.ts`      | NEW — proxy route                                |
| `apps/dashboard/src/hooks/use-pipeline.ts`                    | NEW — React Query hook                           |
| `apps/dashboard/src/components/dashboard/pipeline-funnel.tsx` | NEW — funnel component                           |
| `apps/dashboard/src/components/dashboard/owner-today.tsx`     | Wire revenue stat + add PipelineFunnel section   |
| `apps/dashboard/src/lib/query-keys.ts`                        | Add `pipeline` key                               |
| `Dockerfile`                                                  | Fix `--no-frozen-lockfile` → `--frozen-lockfile` |

---

## 6. Testing Strategy

- **Component test for `PipelineFunnel`**: Mock `usePipeline`, verify bar rendering for each stage, verify lost/nurturing summary, verify loading skeleton, verify empty state.
- **Hook test for `usePipeline`**: Verify fetch URL and query key.
- **Integration in `OwnerToday`**: Verify revenue stat card shows real value instead of `"$0"`.
- **Dockerfile**: CI docker build job already validates the build succeeds.

---

## 7. Risks & Mitigations

| Risk                                               | Mitigation                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pipeline API returns empty stages array (new org)  | Empty state message: "No leads in your pipeline yet"                                               |
| Slow pipeline API response                         | 30s stale time + loading skeleton. Funnel is non-blocking — rest of dashboard renders immediately. |
| `--frozen-lockfile` breaks CI if lockfile is stale | CI already runs `pnpm install` before build. If lockfile is stale, CI fails fast with clear error. |
