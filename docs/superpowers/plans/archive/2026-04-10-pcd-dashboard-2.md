# SP-Dashboard-2: Brief Submission + Creative Task Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable buyers to submit creative briefs from the deployment detail page and surface creative pipeline tasks with richer context on the Tasks page.

**Architecture:** Brief submission uses a slide-out Sheet from the deployment detail page, backed by a new mutation hook and POST proxy route. Creative task cards detect `creative_strategy` category on the existing Tasks page and render pipeline-specific information with a link to the job detail page.

**Tech Stack:** Next.js 14, TanStack React Query, Zod (`@switchboard/schemas`), Tailwind CSS, shadcn/ui (Sheet, Switch, Checkbox, Textarea, Button), lucide-react

**Spec:** `docs/superpowers/specs/2026-04-10-pcd-dashboard-2-design.md`

---

## File Structure

| Action | File                                                                          | Responsibility                                                |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Modify | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`     | Add POST handler for brief submission                         |
| Modify | `apps/dashboard/src/hooks/use-creative-pipeline.ts`                           | Add `useSubmitBrief()` mutation                               |
| Create | `apps/dashboard/src/components/creative-pipeline/url-list-input.tsx`          | Reusable URL add/remove list input                            |
| Create | `apps/dashboard/src/components/creative-pipeline/brief-submission-sheet.tsx`  | Sheet with brief form, validation, submission                 |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`                     | Pass `listingId` prop to client component                     |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx` | Add `listingId` prop, "New Creative Job" button, render sheet |
| Create | `apps/dashboard/src/components/tasks/creative-task-card.tsx`                  | Enhanced card for creative_strategy tasks                     |
| Modify | `apps/dashboard/src/app/(auth)/tasks/page.tsx`                                | Use `CreativeTaskCard` for creative_strategy tasks            |

---

### Task 1: POST Proxy Route + Mutation Hook

**Files:**

- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`
- Modify: `apps/dashboard/src/hooks/use-creative-pipeline.ts`

- [ ] **Step 1: Add POST handler to proxy route**

In `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`, add this function after the existing `GET`:

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

- [ ] **Step 2: Add useSubmitBrief mutation hook**

In `apps/dashboard/src/hooks/use-creative-pipeline.ts`, add after `useApproveStage`:

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

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts apps/dashboard/src/hooks/use-creative-pipeline.ts
git commit -m "feat(dashboard): add brief submission proxy route and mutation hook"
```

---

### Task 2: UrlListInput Component

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/url-list-input.tsx`

- [ ] **Step 1: Create the component**

Create `apps/dashboard/src/components/creative-pipeline/url-list-input.tsx`:

```typescript
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UrlListInputProps {
  value: string[];
  onChange: (urls: string[]) => void;
  label: string;
  placeholder?: string;
}

export function UrlListInput({ value, onChange, label, placeholder }: UrlListInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setInputValue("");
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-[13px]">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Enter URL..."}
          className="text-[13px]"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="space-y-1">
          {value.map((url, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-lg bg-muted/30"
            >
              <span className="text-[12px] text-muted-foreground truncate">{url}</span>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/url-list-input.tsx
git commit -m "feat(dashboard): add reusable URL list input component"
```

---

### Task 3: Brief Submission Sheet

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/brief-submission-sheet.tsx`

**Context:**

- Form fields map to `CreativeBriefInput` from `@switchboard/schemas` (minus `pastPerformance`)
- Uses `useSubmitBrief()` hook from Task 1
- Uses `UrlListInput` from Task 2
- Platforms are: `"meta"`, `"youtube"`, `"tiktok"` — from `CreativePlatform` enum in schemas
- Toast: `import { useToast } from "@/components/ui/use-toast"`
- shadcn/ui components: Sheet, Textarea, Switch, Checkbox, Label, Button
- Dashboard uses extensionless imports

- [ ] **Step 1: Create the sheet component**

Create `apps/dashboard/src/components/creative-pipeline/brief-submission-sheet.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { useSubmitBrief } from "@/hooks/use-creative-pipeline";
import { UrlListInput } from "./url-list-input";

const PLATFORMS = [
  { value: "meta", label: "Meta" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
] as const;

interface BriefSubmissionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploymentId: string;
  listingId: string;
}

interface FormErrors {
  productDescription?: string;
  targetAudience?: string;
  platforms?: string;
}

export function BriefSubmissionSheet({
  open,
  onOpenChange,
  deploymentId,
  listingId,
}: BriefSubmissionSheetProps) {
  const { toast } = useToast();
  const submitMutation = useSubmitBrief();

  const [productDescription, setProductDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [brandVoice, setBrandVoice] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [generateReferenceImages, setGenerateReferenceImages] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!productDescription.trim()) newErrors.productDescription = "Product description is required";
    if (!targetAudience.trim()) newErrors.targetAudience = "Target audience is required";
    if (platforms.length === 0) newErrors.platforms = "Select at least one platform";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTogglePlatform = (platform: string) => {
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  };

  const resetForm = () => {
    setProductDescription("");
    setTargetAudience("");
    setPlatforms([]);
    setBrandVoice("");
    setProductImages([]);
    setReferences([]);
    setGenerateReferenceImages(false);
    setErrors({});
  };

  const handleSubmit = () => {
    if (!validate()) return;

    submitMutation.mutate(
      {
        deploymentId,
        listingId,
        brief: {
          productDescription: productDescription.trim(),
          targetAudience: targetAudience.trim(),
          platforms,
          brandVoice: brandVoice.trim() || null,
          productImages,
          references,
          generateReferenceImages,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Creative job started", description: "Pipeline is now running." });
          resetForm();
          onOpenChange(false);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to create creative job. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Creative Job</SheetTitle>
          <SheetDescription>
            Submit a brief to start the creative pipeline.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Product Description */}
          <div className="space-y-2">
            <Label className="text-[13px]">
              Product Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="Describe the product or service..."
              className="text-[13px] min-h-[80px]"
            />
            {errors.productDescription && (
              <p className="text-[12px] text-red-500">{errors.productDescription}</p>
            )}
          </div>

          {/* Target Audience */}
          <div className="space-y-2">
            <Label className="text-[13px]">
              Target Audience <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="Who is this ad targeting?"
              className="text-[13px] min-h-[80px]"
            />
            {errors.targetAudience && (
              <p className="text-[12px] text-red-500">{errors.targetAudience}</p>
            )}
          </div>

          {/* Platforms */}
          <div className="space-y-2">
            <Label className="text-[13px]">
              Platforms <span className="text-red-500">*</span>
            </Label>
            <div className="flex gap-4">
              {PLATFORMS.map((p) => (
                <label key={p.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={platforms.includes(p.value)}
                    onCheckedChange={() => handleTogglePlatform(p.value)}
                  />
                  <span className="text-[13px]">{p.label}</span>
                </label>
              ))}
            </div>
            {errors.platforms && (
              <p className="text-[12px] text-red-500">{errors.platforms}</p>
            )}
          </div>

          {/* Brand Voice */}
          <div className="space-y-2">
            <Label className="text-[13px]">Brand Voice</Label>
            <Textarea
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              placeholder="Describe the brand's tone and voice (optional)"
              className="text-[13px] min-h-[60px]"
            />
          </div>

          {/* Product Images */}
          <UrlListInput
            value={productImages}
            onChange={setProductImages}
            label="Product Images"
            placeholder="Paste image URL..."
          />

          {/* References */}
          <UrlListInput
            value={references}
            onChange={setReferences}
            label="References"
            placeholder="Paste reference URL..."
          />

          {/* Generate Reference Images */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-[13px]">Generate Reference Images</Label>
              <p className="text-[12px] text-muted-foreground">
                AI-generated visuals for each storyboard scene
              </p>
            </div>
            <Switch
              checked={generateReferenceImages}
              onCheckedChange={setGenerateReferenceImages}
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="w-full"
          >
            {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Job
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/brief-submission-sheet.tsx
git commit -m "feat(dashboard): add brief submission sheet for creative pipeline"
```

---

### Task 4: Deployment Detail Integration

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`

**Context:**

- The server page (`page.tsx`) already fetches `deployment` which has `listingId` (line 15-16)
- The client component needs `listingId` to pass to `BriefSubmissionSheet`
- Add a "New Creative Job" button in the Creative Jobs section header
- The button opens the `BriefSubmissionSheet`
- Dashboard uses extensionless imports

- [ ] **Step 1: Pass listingId from server page**

In `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`, the `DeploymentDetailClient` render (around line 24-30) currently passes `deploymentId`, `connections`, `listing`, `trustBreakdown`. Add `listingId`:

Change:

```tsx
return (
  <DeploymentDetailClient
    deploymentId={id}
    connections={connections}
    listing={listingResult?.listing ?? null}
    trustBreakdown={trustResult}
  />
);
```

To:

```tsx
return (
  <DeploymentDetailClient
    deploymentId={id}
    listingId={deployment.listingId}
    connections={connections}
    listing={listingResult?.listing ?? null}
    trustBreakdown={trustResult}
  />
);
```

- [ ] **Step 2: Update client component props and add sheet**

In `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`:

Add imports:

```typescript
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefSubmissionSheet } from "@/components/creative-pipeline/brief-submission-sheet";
```

`useState` is not currently imported — add it. `Skeleton`, `Badge`, `ArrowLeft`, `Bot` are already imported.

Add `listingId: string` to the `DeploymentDetailClientProps` interface:

```typescript
interface DeploymentDetailClientProps {
  deploymentId: string;
  listingId: string;
  connections: Connection[];
  listing: MarketplaceListing | null;
  trustBreakdown: TrustScoreBreakdown | null;
}
```

Add `listingId` to the destructured props:

```typescript
export function DeploymentDetailClient({
  deploymentId,
  listingId,
  connections,
  listing,
  trustBreakdown,
}: DeploymentDetailClientProps) {
```

Add state for sheet visibility inside the component:

```typescript
const [briefSheetOpen, setBriefSheetOpen] = useState(false);
```

Change the Creative Jobs section header (line 166) from:

```tsx
<h2 className="section-label mb-4">Creative Jobs</h2>
```

To:

```tsx
<div className="flex items-center justify-between mb-4">
  <h2 className="section-label">Creative Jobs</h2>
  {listingId && (
    <Button variant="outline" size="sm" onClick={() => setBriefSheetOpen(true)}>
      <Plus className="h-3.5 w-3.5 mr-1.5" />
      New Creative Job
    </Button>
  )}
</div>
```

Add the sheet after the closing `</section>` of Creative Jobs (line 183) and before the final `</div>` (line 184):

```tsx
<BriefSubmissionSheet
  open={briefSheetOpen}
  onOpenChange={setBriefSheetOpen}
  deploymentId={deploymentId}
  listingId={listingId}
/>
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx" "apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx"
git commit -m "feat(dashboard): integrate brief submission sheet into deployment detail"
```

---

### Task 5: Creative Task Card + Tasks Page Integration

**Files:**

- Create: `apps/dashboard/src/components/tasks/creative-task-card.tsx`
- Modify: `apps/dashboard/src/app/(auth)/tasks/page.tsx`

**Context:**

- The existing `TaskCard` is in `apps/dashboard/src/components/tasks/task-card.tsx`
- It uses `STATUS_STYLES` and `STATUS_LABELS` records, `formatRelative` from `@/lib/format`
- The creative card has the same props: `task: MarketplaceTask`, `onApprove?`, `onReject?`
- `task.input` is `Record<string, unknown>` — need runtime checks for `productDescription` and `platforms`
- If input parsing fails, the component renders the generic `TaskCard` as its own fallback (spec deviation: spec says return `null`, but internal fallback avoids the anti-pattern of calling components as functions)
- Link goes to `/deployments/[task.deploymentId]` (the Creative Jobs section there lists jobs)

- [ ] **Step 1: Create the creative task card**

Create `apps/dashboard/src/components/tasks/creative-task-card.tsx`:

```typescript
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { MarketplaceTask } from "@/lib/api-client";
import { TaskCard } from "./task-card";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-caution/10 text-caution",
  awaiting_review: "bg-caution/10 text-caution",
  approved: "bg-positive/10 text-positive",
  rejected: "bg-negative/10 text-negative",
  completed: "bg-positive/10 text-positive",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  awaiting_review: "Awaiting Review",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

interface CreativeTaskCardProps {
  task: MarketplaceTask;
  onApprove?: (task: MarketplaceTask) => void;
  onReject?: (task: MarketplaceTask) => void;
}

function parseCreativeInput(input: Record<string, unknown>): {
  productDescription: string;
  platforms: string[];
} | null {
  const desc = input.productDescription;
  const plats = input.platforms;
  if (typeof desc !== "string" || !Array.isArray(plats)) return null;
  return { productDescription: desc, platforms: plats as string[] };
}

export function CreativeTaskCard({ task, onApprove, onReject }: CreativeTaskCardProps) {
  const parsed = parseCreativeInput(task.input);
  if (!parsed) {
    return <TaskCard task={task} onApprove={onApprove} onReject={onReject} />;
  }

  const isReviewable = task.status === "awaiting_review" && task.output;

  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[14px] text-foreground font-medium">Creative Strategy</p>
            <Badge variant="outline" className="text-[11px]">Pipeline</Badge>
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {formatRelative(task.createdAt)}
          </p>
        </div>
        <span
          className={cn(
            "px-2 py-0.5 rounded-md text-[11px] font-medium",
            STATUS_STYLES[task.status] ?? STATUS_STYLES.pending,
          )}
        >
          {STATUS_LABELS[task.status] ?? task.status}
        </span>
      </div>

      {/* Product description */}
      <p className="text-[13px] text-muted-foreground line-clamp-2">
        {parsed.productDescription}
      </p>

      {/* Platforms */}
      <div className="flex gap-1.5">
        {parsed.platforms.map((p) => (
          <Badge key={p} variant="secondary" className="text-[11px] capitalize">
            {p}
          </Badge>
        ))}
      </div>

      {/* View pipeline link */}
      <Link
        href={`/deployments/${task.deploymentId}`}
        className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:text-blue-700 transition-colors"
      >
        View Pipeline
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>

      {/* Review actions */}
      {isReviewable && onApprove && onReject && (
        <div className="flex items-center gap-3 pt-2 border-t border-border/60">
          <button
            onClick={() => onApprove(task)}
            className="px-5 py-2.5 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity min-h-[44px]"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(task)}
            className="px-4 py-2.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            Reject
          </button>
        </div>
      )}

      {/* Review result */}
      {task.reviewResult && (
        <p className="text-[12px] text-muted-foreground">
          Review: {task.reviewResult}
          {task.reviewedAt && ` · ${formatRelative(task.reviewedAt)}`}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update Tasks page to use CreativeTaskCard**

In `apps/dashboard/src/app/(auth)/tasks/page.tsx`, add import:

```typescript
import { CreativeTaskCard } from "@/components/tasks/creative-task-card";
```

Replace the task rendering block (around line 117):

```tsx
{
  displayed.map((task) => (
    <TaskCard
      key={task.id}
      task={task}
      onApprove={(t) => setDialog({ open: true, action: "approved", task: t })}
      onReject={(t) => setDialog({ open: true, action: "rejected", task: t })}
    />
  ));
}
```

With:

```tsx
{
  displayed.map((task) => {
    const Card = task.category === "creative_strategy" ? CreativeTaskCard : TaskCard;
    return (
      <Card
        key={task.id}
        task={task}
        onApprove={(t) => setDialog({ open: true, action: "approved", task: t })}
        onReject={(t) => setDialog({ open: true, action: "rejected", task: t })}
      />
    );
  });
}
```

Note: `CreativeTaskCard` handles its own fallback — when input parsing fails, it renders the generic `TaskCard` internally (see the `TaskCard` import and fallback in Step 1). This avoids the anti-pattern of calling components as functions.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/tasks/creative-task-card.tsx "apps/dashboard/src/app/(auth)/tasks/page.tsx"
git commit -m "feat(dashboard): add creative task card and tasks page integration"
```

---

## Verification

After all tasks are complete:

- [ ] Run `cd apps/dashboard && npx tsc --noEmit` — no type errors
- [ ] Run `pnpm lint` — no lint errors
- [ ] Verify no `console.log` statements
- [ ] Verify extensionless imports throughout (no `.js` in dashboard code)
