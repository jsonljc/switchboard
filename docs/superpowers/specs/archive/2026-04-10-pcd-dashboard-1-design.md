# SP-Dashboard-1: Creative Pipeline Dashboard — Data Layer + Job Detail

**Date:** 2026-04-10
**Status:** Draft
**Parent Spec:** `docs/superpowers/specs/2026-04-08-performance-creative-director-design.md`
**Depends On:** SP1-SP4 (creative pipeline backend + stages 1-4)

---

## 1. Overview

Add dashboard support for viewing and managing creative pipeline jobs. Buyers access creative jobs from the deployment detail page, view pipeline progress through a visual stepper, review stage outputs, and approve or stop the pipeline — all without leaving the deployment context.

### Key Design Decisions

- **Nested under deployments** — creative jobs are accessed via `/deployments/[id]/creative-jobs/[jobId]`, not a top-level route
- **Timeline stepper** — horizontal 5-step progress bar showing pipeline state, clickable to view each stage's output
- **Inline action bar** — approve/stop buttons visible when pipeline is awaiting approval, no modal dialog
- **No brief submission** — that's SP-Dashboard-2. This spec covers viewing and managing existing jobs only

---

## 2. Data Layer

### 2.1 Proxy Routes

**Directory:** `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/`

Follow the existing proxy route pattern: use `getApiClient()` to forward to the backend API, return `NextResponse.json()`.

| Route File              | Method | Forwards To                                  | Purpose                           |
| ----------------------- | ------ | -------------------------------------------- | --------------------------------- |
| `route.ts`              | GET    | `client.listCreativeJobs({ deploymentId })`  | List jobs for a deployment        |
| `[id]/route.ts`         | GET    | `client.getCreativeJob(id)`                  | Get single job with stage outputs |
| `[id]/approve/route.ts` | POST   | `client.approveCreativeJobStage(id, action)` | Approve or stop pipeline          |

**List route validation:** `deploymentId` query param is required. Return `400` with `{ error: "deploymentId is required" }` if missing.

**Approve route validation:** Parse request body as JSON. Validate `action` is `"continue"` or `"stop"`. Return `400` with `{ error: "Invalid action" }` if missing or invalid.

Error handling follows existing pattern:

```typescript
catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Request failed";
  return NextResponse.json(
    { error: message },
    { status: message === "Unauthorized" ? 401 : 500 },
  );
}
```

### 2.2 Query Keys

Add to `apps/dashboard/src/lib/query-keys.ts`:

```typescript
creativeJobs: {
  all: ["creativeJobs"] as const,
  list: (deploymentId: string) => ["creativeJobs", "list", deploymentId] as const,
  detail: (id: string) => ["creativeJobs", "detail", id] as const,
},
```

### 2.3 React Query Hook

**File:** `apps/dashboard/src/hooks/use-creative-pipeline.ts`

Separate file from `use-marketplace.ts` — the creative pipeline is a distinct feature with its own query patterns.

| Hook                            | Type     | Polling                                              | Invalidates        |
| ------------------------------- | -------- | ---------------------------------------------------- | ------------------ |
| `useCreativeJobs(deploymentId)` | Query    | 30s when any job is in-progress or awaiting approval | —                  |
| `useCreativeJob(id)`            | Query    | 30s when job is not complete/stopped                 | —                  |
| `useApproveStage()`             | Mutation | —                                                    | `creativeJobs.all` |

**Enabled guards:** `useCreativeJobs` is enabled only when `deploymentId` is truthy (`enabled: !!deploymentId`). `useCreativeJob` is enabled only when `id` is truthy (`enabled: !!id`).

Polling logic: `refetchInterval` is set to `30_000` when the job/any job has `currentStage !== "complete"` and `stoppedAt === null`. Otherwise no polling.

Hook fetches from the proxy routes (`/api/dashboard/marketplace/creative-jobs/...`), not the backend API directly.

### 2.4 Types

The `CreativeJobSummary` interface already exists in `apps/dashboard/src/lib/api-client.ts` (lines 55-72). No new types needed for the data layer. Stage output types are rendered dynamically from the `stageOutputs` record — each renderer knows its own shape.

### 2.5 `stoppedAt` Field Semantics

Despite the name, `stoppedAt` stores a **stage name** (e.g., `"hooks"`, `"scripts"`), not a timestamp. This is how `jobStore.stop(id, stage)` works in the backend runner — it records which stage the pipeline was stopped at. A value of `null` means the pipeline has not been stopped. The stepper component uses this to determine which step gets the "stopped" icon.

---

## 3. Deployment Detail Integration

### 3.1 Creative Jobs Section

Add a "Creative Jobs" section to the existing deployment detail client component (`apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`).

**Placement:** After the "Work Log" section.

**Content:** A list of creative job cards for the current deployment. Each card shows:

- Current stage name (e.g., "Awaiting approval: hooks")
- Status badge: `Running` (blue), `Awaiting Approval` (yellow), `Complete` (green), `Stopped` (gray)
- Created date (relative, e.g., "2 hours ago")
- Click navigates to `/deployments/[id]/creative-jobs/[jobId]`

**Empty state:** "No creative jobs yet" with muted text.

**Data:** Uses `useCreativeJobs(deploymentId)` hook.

### 3.2 Creative Job Card Component

**File:** `apps/dashboard/src/components/creative-pipeline/creative-job-card.tsx`

Simple card component. Props: `job: CreativeJobSummary`, `deploymentId: string`. Uses `next/link` for navigation.

---

## 4. Job Detail Page

### 4.1 Route Structure

**Server page:** `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/page.tsx`

- Fetches job data via `getApiClient().getCreativeJob(jobId)` on the server
- Passes as `initialData` prop to client component
- Returns `notFound()` if the API returns 404

**Client component:** `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/creative-job-detail-client.tsx`

- Uses `useCreativeJob(jobId)` hook with `initialData` from server (avoids redundant fetch on first render)
- Hook still handles polling for live updates after initial render
- Renders: header, pipeline stepper, stage output panel, action bar

### 4.2 Page Layout

```
┌─────────────────────────────────────────┐
│ ← Back to deployment                    │
│                                         │
│ Creative Job #abc123                    │
│ Status: Awaiting Approval  ·  2h ago    │
│                                         │
│ ○────●────○────○────○                   │
│ Trends  Hooks  Scripts  Board  Prod     │
│  ✓       ●      ○       ○      ○       │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Stage Output: Hooks                 │ │
│ │                                     │ │
│ │ [Hook 1] "Stop scrolling..."        │ │
│ │ Type: question  Score: 8/10         │ │
│ │                                     │ │
│ │ [Hook 2] "Did you know..."          │ │
│ │ Type: bold_statement  Score: 7/10   │ │
│ │                                     │ │
│ │ Top Combos:                         │ │
│ │ Angle "Time savings" + Hook 1 (8)   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ [Approve & Continue to Scripts]     │ │
│ │ [Stop Pipeline]                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 4.3 Pipeline Stepper Component

**File:** `apps/dashboard/src/components/creative-pipeline/pipeline-stepper.tsx`

Horizontal stepper with 5 steps. Stage name mapping from `currentStage` values to display labels:

| `currentStage` value | Display Label |
| -------------------- | ------------- |
| `"trends"`           | Trends        |
| `"hooks"`            | Hooks         |
| `"scripts"`          | Scripts       |
| `"storyboard"`       | Storyboard    |
| `"production"`       | Production    |

**Step states:**

- `completed` — checkmark icon, green, clickable
- `current` — filled circle, blue (if running) or yellow (if awaiting approval)
- `pending` — empty circle, gray, not clickable
- `stopped` — stop icon, gray, not clickable

**Props:**

- `currentStage: string` — the job's current stage
- `stoppedAt: string | null` — if stopped, which stage it stopped at
- `onStageClick: (stage: string) => void` — callback when clicking a completed stage
- `selectedStage: string` — which stage's output is currently displayed

The stepper is a controlled component. The parent tracks `selectedStage` in state, defaulting to the latest completed stage.

### 4.4 Stage Output Panel

**File:** `apps/dashboard/src/components/creative-pipeline/stage-output-panel.tsx`

Receives `stageName: string` and `output: unknown`. Selects the appropriate renderer based on stage name.

**Renderers** (one per stage, all in the same directory):

| File                    | Stage      | Key Display Elements                                                                                                                                                                                                       |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trend-output.tsx`      | trends     | Angle cards (theme, motivator, platform fit, rationale). Audience insights block (awareness level, drivers, objections). Trend signals table.                                                                              |
| `hook-output.tsx`       | hooks      | Hook cards with text, type badge, platform score bar. Top combos section with scores.                                                                                                                                      |
| `script-output.tsx`     | scripts    | Full script text. Color-coded timing sections: hook (red), problem (orange), solution (green), proof (blue), cta (purple). Format + platform badges. Production notes.                                                     |
| `storyboard-output.tsx` | storyboard | Scene cards in sequence: number, description, visual direction, duration badge, text overlay. Reference image displayed inline (`<img>`) when `referenceImageUrl` is not null. Placeholder with "No image" text when null. |
| `production-output.tsx` | production | Placeholder for SP5. Shows raw JSON in a code block.                                                                                                                                                                       |

Each renderer parses the `output` with the corresponding Zod schema from `@switchboard/schemas` for type safety. If parsing fails (shouldn't happen), show "Unable to display output" with the raw JSON as fallback.

### 4.5 Action Bar

**File:** `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`

Sticky bottom bar. Only visible when:

- `currentStage` is not `"complete"`
- `stoppedAt` is `null`

**Buttons:**

- **"Approve & Continue to [next stage name]"** — primary button, calls `useApproveStage()` with `action: "continue"`. Disabled while mutation is in-flight (shows spinner).
- **"Stop Pipeline"** — secondary/destructive button, calls `useApproveStage()` with `action: "stop"`. Shows confirmation text inline ("Are you sure?") before executing.

**Toast feedback:**

- Success: "Stage approved" or "Pipeline stopped"
- Error: "Failed to update pipeline. Please try again."

Uses existing toast infrastructure from the project.

---

## 5. Error Handling

| Scenario                     | Behavior                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Job not found (404 from API) | Next.js `notFound()` in server page                                           |
| Approve/stop mutation fails  | Toast error, buttons re-enabled                                               |
| Network error during polling | React Query handles silently, retries on next interval                        |
| Reference image URL expired  | `<img>` onError handler shows placeholder text "Image expired"                |
| Stage output fails Zod parse | Show raw JSON in code block with "Unable to display formatted output" message |

---

## 6. File Structure

| Action | File                                                                                                  | Responsibility                        |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`                             | Proxy: list creative jobs             |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/route.ts`                        | Proxy: get creative job               |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts`                | Proxy: approve/stop stage             |
| Create | `apps/dashboard/src/hooks/use-creative-pipeline.ts`                                                   | React Query hooks                     |
| Create | `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/page.tsx`                       | Server page                           |
| Create | `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/creative-job-detail-client.tsx` | Client component                      |
| Create | `apps/dashboard/src/components/creative-pipeline/pipeline-stepper.tsx`                                | 5-step progress stepper               |
| Create | `apps/dashboard/src/components/creative-pipeline/stage-output-panel.tsx`                              | Output renderer dispatcher            |
| Create | `apps/dashboard/src/components/creative-pipeline/trend-output.tsx`                                    | Trends stage renderer                 |
| Create | `apps/dashboard/src/components/creative-pipeline/hook-output.tsx`                                     | Hooks stage renderer                  |
| Create | `apps/dashboard/src/components/creative-pipeline/script-output.tsx`                                   | Scripts stage renderer                |
| Create | `apps/dashboard/src/components/creative-pipeline/storyboard-output.tsx`                               | Storyboard stage renderer             |
| Create | `apps/dashboard/src/components/creative-pipeline/production-output.tsx`                               | Production stage placeholder renderer |
| Create | `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`                                      | Approve/stop action bar               |
| Create | `apps/dashboard/src/components/creative-pipeline/creative-job-card.tsx`                               | Job card for deployment detail list   |
| Modify | `apps/dashboard/src/lib/query-keys.ts`                                                                | Add `creativeJobs` namespace          |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`                         | Add Creative Jobs section             |

---

## 7. Testing Strategy

- **`use-creative-pipeline.test.ts`** — Hook tests with mocked fetch:
  - `useCreativeJobs` fetches and returns jobs
  - `useCreativeJob` fetches single job
  - `useApproveStage` mutation calls correct endpoint, invalidates queries
  - Polling enabled/disabled based on job state
- **`pipeline-stepper.test.ts`** — Component tests:
  - Correct step states for various `currentStage` values
  - Completed stages are clickable, pending stages are not
  - Stopped state shows stop icon at correct stage
- **`action-bar.test.ts`** — Component tests:
  - Hidden when job is complete or stopped
  - Shows correct next stage name in approve button
  - Buttons disabled during mutation

---

## 8. Out of Scope

- Brief submission form (SP-Dashboard-2)
- Job list page outside deployment context (SP-Dashboard-2)
- Real-time WebSocket updates (polling is sufficient)
- Stage output editing or regeneration
- Export/download of stage outputs
- Navigation changes (no new tabs in bottom nav)
