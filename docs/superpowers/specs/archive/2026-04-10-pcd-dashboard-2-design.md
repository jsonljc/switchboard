# SP-Dashboard-2: Brief Submission + Creative Task Cards

**Date:** 2026-04-10
**Status:** Draft
**Parent Spec:** `docs/superpowers/specs/2026-04-08-performance-creative-director-design.md`
**Depends On:** SP-Dashboard-1 (proxy routes, hooks, job detail page)

---

## 1. Overview

Add the ability to submit creative briefs from the dashboard and provide richer task cards for creative pipeline tasks on the Tasks page. Buyers create new creative jobs via a slide-out sheet on the deployment detail page, and creative pipeline tasks render with stage progress and a link to the job detail page.

### Key Design Decisions

- **Sheet, not page** — brief form opens as a `Sheet` from the deployment detail, keeping users in deployment context
- **URL add/remove pattern** — product images and references use a text input + "Add" button with removable chips
- **Creative task card** — `creative_strategy` tasks get a dedicated card component on the Tasks page with pipeline context
- **Link to deployment, not job** — creative task cards link to `/deployments/[deploymentId]` (the Creative Jobs section there lists jobs), avoiding cross-reference complexity between tasks and jobs
- **No `pastPerformance` field** — skipped for V1 (freeform `Record<string, unknown>` is hard to build a good UI for)

---

## 2. Brief Submission Sheet

### 2.1 Trigger

Add a "New Creative Job" button to the Creative Jobs section header in `deployment-detail-client.tsx`. The button opens a `Sheet` component (shadcn/ui, slide-out from right).

**Props needed:** The sheet requires `deploymentId` and `listingId` to submit the brief. The deployment detail server page already fetches the deployment (which has `listingId`). Pass `listingId` as an additional prop to `DeploymentDetailClient`.

### 2.2 Form Fields

| Field                     | Component      | Required    | Schema Field              | Notes                          |
| ------------------------- | -------------- | ----------- | ------------------------- | ------------------------------ |
| Product Description       | `Textarea`     | Yes         | `productDescription`      | min 1 char                     |
| Target Audience           | `Textarea`     | Yes         | `targetAudience`          | min 1 char                     |
| Platforms                 | Checkbox group | Yes (min 1) | `platforms`               | Options: meta, youtube, tiktok |
| Brand Voice               | `Textarea`     | No          | `brandVoice`              | nullable, optional             |
| Product Images            | `UrlListInput` | No          | `productImages`           | defaults []                    |
| References                | `UrlListInput` | No          | `references`              | defaults []                    |
| Generate Reference Images | `Switch`       | No          | `generateReferenceImages` | defaults false                 |

### 2.3 UrlListInput Component

**File:** `apps/dashboard/src/components/creative-pipeline/url-list-input.tsx`

Reusable component for managing a list of URL strings.

**Props:**

- `value: string[]` — current URLs
- `onChange: (urls: string[]) => void` — callback when list changes
- `label: string` — field label
- `placeholder?: string` — input placeholder

**Behavior:**

- Text input + "Add" button
- On "Add": validate input is a non-empty string, add to list, clear input
- Each URL renders as a row with the URL text (truncated) and a remove button (X icon)
- No URL format validation — users may paste partial URLs, file paths, or identifiers

### 2.4 Validation

Client-side validation uses a subset of `CreativeBriefInput` from `@switchboard/schemas` (excluding `pastPerformance`). Validation runs on submit, not on blur.

**Error display:** Inline error messages below each field that fails validation. Submit button stays enabled (not disabled while fields are invalid — let users attempt submission and see all errors at once).

### 2.5 Submission Flow

1. User fills form, clicks "Create Job"
2. `useSubmitBrief()` mutation fires — calls `POST /api/dashboard/marketplace/creative-jobs`
3. Proxy route forwards to `client.submitCreativeBrief({ deploymentId, listingId, brief })`
4. **On success:** close sheet, toast "Creative job started", invalidate `creativeJobs.all` queries
5. **On error:** toast "Failed to create creative job. Please try again.", sheet stays open, form data preserved

### 2.6 Proxy Route

**File:** `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts` (modify existing)

Add a `POST` handler alongside the existing `GET`:

```typescript
export async function POST(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.submitCreativeBrief(body);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Body validation is handled by the backend API (Zod validation in the Fastify route). The proxy route passes through.

### 2.7 Mutation Hook

Add to `apps/dashboard/src/hooks/use-creative-pipeline.ts`:

```typescript
export function useSubmitBrief() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      deploymentId: string;
      listingId: string;
      brief: {
        productDescription: string;
        targetAudience: string;
        platforms: string[];
        brandVoice?: string | null;
        productImages?: string[];
        references?: string[];
        generateReferenceImages?: boolean;
      };
    }) => {
      const res = await fetch("/api/dashboard/marketplace/creative-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create creative job");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.creativeJobs.all });
    },
  });
}
```

---

## 3. Creative Task Card

### 3.1 Component

**File:** `apps/dashboard/src/components/tasks/creative-task-card.tsx`

A specialized card for tasks with `category === "creative_strategy"`. Replaces the generic `TaskCard` for these tasks on the Tasks page.

**Renders:**

- "Creative Strategy" label
- Product description extracted from `task.input.productDescription` (with truncation)
- Platforms badges from `task.input.platforms`
- Status badge (same styling as generic `TaskCard`)
- "View Pipeline →" link to `/deployments/[task.deploymentId]` — navigates to deployment detail where the Creative Jobs section shows the job
- Created date (using existing `formatRelative` from `@/lib/format`)
- Approve/reject buttons when `status === "awaiting_review"` (same callback pattern as generic `TaskCard`)

**Fallback logic:** The component checks `task.input.productDescription` is a string and `task.input.platforms` is an array. If either check fails (missing or wrong type), the component returns `null` and the Tasks page falls back to the generic `TaskCard`. This handles cases where `creative_strategy` tasks were created with unexpected input shapes.

**Props:** Same as `TaskCardProps` — `task: MarketplaceTask`, `onApprove?`, `onReject?`.

### 3.2 Tasks Page Integration

**File:** `apps/dashboard/src/app/(auth)/tasks/page.tsx` (modify)

In the task list rendering, check `task.category` and render `CreativeTaskCard` for `"creative_strategy"` tasks, `TaskCard` for everything else:

```tsx
{displayed.map((task) =>
  task.category === "creative_strategy" ? (
    <CreativeTaskCard key={task.id} task={task} onApprove={...} onReject={...} />
  ) : (
    <TaskCard key={task.id} task={task} onApprove={...} onReject={...} />
  )
)}
```

### 3.3 Deployment Detail — listingId Prop

**File:** `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx` (modify)
**File:** `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx` (modify)

Add `listingId: string` to `DeploymentDetailClientProps`. The server page already fetches `deployment.listingId` — pass it through.

---

## 4. Error Handling

| Scenario                               | Behavior                                                       |
| -------------------------------------- | -------------------------------------------------------------- |
| Brief validation fails (client)        | Inline field errors, form stays open                           |
| Brief submission fails (server)        | Toast error, form stays open with data preserved               |
| Empty platforms selection              | Validation error: "Select at least one platform"               |
| `listingId` not available              | "New Creative Job" button hidden (defensive, shouldn't happen) |
| Creative task card input parsing fails | Fall back to generic `TaskCard` rendering                      |

---

## 5. File Structure

| Action | File                                                                          | Responsibility                                                |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Create | `apps/dashboard/src/components/creative-pipeline/brief-submission-sheet.tsx`  | Sheet with brief form, validation, submission                 |
| Create | `apps/dashboard/src/components/creative-pipeline/url-list-input.tsx`          | Reusable URL add/remove input                                 |
| Create | `apps/dashboard/src/components/tasks/creative-task-card.tsx`                  | Enhanced card for creative_strategy tasks                     |
| Modify | `apps/dashboard/src/hooks/use-creative-pipeline.ts`                           | Add `useSubmitBrief()` mutation                               |
| Modify | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`     | Add POST handler                                              |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`                     | Pass `listingId` prop                                         |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx` | Add `listingId` prop, "New Creative Job" button, render sheet |
| Modify | `apps/dashboard/src/app/(auth)/tasks/page.tsx`                                | Use `CreativeTaskCard` for creative_strategy tasks            |

---

## 6. Out of Scope

- `pastPerformance` field on brief form (freeform schema, no good UI)
- Cross-deployment creative jobs list page (per-deployment list + Tasks page coverage is sufficient)
- File upload for product images (URLs only for V1)
- Brief templates or saved briefs
- Brief editing after submission
