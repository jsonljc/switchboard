# SP-Dashboard-1: Creative Pipeline Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dashboard support for viewing and managing creative pipeline jobs, nested under deployment detail pages.

**Architecture:** Next.js App Router proxy routes forward to the backend API via `getApiClient()`. React Query hooks with polling fetch from proxy routes. Server pages prefetch data and pass as `initialData` to client components. UI components use shadcn/ui + Tailwind.

**Tech Stack:** Next.js 14, TanStack React Query, Zod (from `@switchboard/schemas`), Tailwind CSS, shadcn/ui, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-04-10-pcd-dashboard-1-design.md`

---

## File Structure

| Action | File                                                                                                  | Responsibility                  |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| Modify | `apps/dashboard/src/lib/query-keys.ts`                                                                | Add `creativeJobs` namespace    |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`                             | Proxy: list creative jobs       |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/route.ts`                        | Proxy: get creative job         |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts`                | Proxy: approve/stop stage       |
| Create | `apps/dashboard/src/hooks/use-creative-pipeline.ts`                                                   | React Query hooks               |
| Create | `apps/dashboard/src/components/creative-pipeline/creative-job-card.tsx`                               | Job card for deployment list    |
| Create | `apps/dashboard/src/components/creative-pipeline/pipeline-stepper.tsx`                                | 5-step progress stepper         |
| Create | `apps/dashboard/src/components/creative-pipeline/stage-output-panel.tsx`                              | Output renderer dispatcher      |
| Create | `apps/dashboard/src/components/creative-pipeline/trend-output.tsx`                                    | Trends stage renderer           |
| Create | `apps/dashboard/src/components/creative-pipeline/hook-output.tsx`                                     | Hooks stage renderer            |
| Create | `apps/dashboard/src/components/creative-pipeline/script-output.tsx`                                   | Scripts stage renderer          |
| Create | `apps/dashboard/src/components/creative-pipeline/storyboard-output.tsx`                               | Storyboard stage renderer       |
| Create | `apps/dashboard/src/components/creative-pipeline/production-output.tsx`                               | Production placeholder renderer |
| Create | `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`                                      | Approve/stop action bar         |
| Create | `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/page.tsx`                       | Server page                     |
| Create | `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/creative-job-detail-client.tsx` | Client component                |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`                         | Add Creative Jobs section       |

---

### Task 1: Query Keys + Proxy Routes

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts`

- [ ] **Step 1: Add creativeJobs query keys**

Add to the `queryKeys` object in `apps/dashboard/src/lib/query-keys.ts`, after the `marketplace` namespace:

```typescript
creativeJobs: {
  all: ["creativeJobs"] as const,
  list: (deploymentId: string) => ["creativeJobs", "list", deploymentId] as const,
  detail: (id: string) => ["creativeJobs", "detail", id] as const,
},
```

- [ ] **Step 2: Create list proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.listCreativeJobs({ deploymentId });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 3: Create get-by-id proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.getCreativeJob(id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 4: Create approve proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = body?.action;
    if (action !== "continue" && action !== "stop") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.approveCreativeJobStage(id, action);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/
git commit -m "feat(dashboard): add creative pipeline proxy routes and query keys"
```

---

### Task 2: React Query Hooks

**Files:**

- Create: `apps/dashboard/src/hooks/use-creative-pipeline.ts`

- [ ] **Step 1: Create the hooks file**

Create `apps/dashboard/src/hooks/use-creative-pipeline.ts`:

```typescript
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreativeJobSummary } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useCreativeJobs(deploymentId: string) {
  return useQuery({
    queryKey: queryKeys.creativeJobs.list(deploymentId),
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/marketplace/creative-jobs?deploymentId=${encodeURIComponent(deploymentId)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch creative jobs");
      const data = await res.json();
      return data.jobs as CreativeJobSummary[];
    },
    enabled: !!deploymentId,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      const hasActive = jobs.some((j) => j.currentStage !== "complete" && !j.stoppedAt);
      return hasActive ? 30_000 : false;
    },
  });
}

export function useCreativeJob(id: string) {
  return useQuery({
    queryKey: queryKeys.creativeJobs.detail(id),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${id}`);
      if (!res.ok) throw new Error("Failed to fetch creative job");
      const data = await res.json();
      return data.job as CreativeJobSummary;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return false;
      return job.currentStage !== "complete" && !job.stoppedAt ? 30_000 : false;
    },
  });
}

export function useApproveStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, action }: { jobId: string; action: "continue" | "stop" }) => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${jobId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Failed to update pipeline");
      const data = await res.json();
      return data as { job: CreativeJobSummary; action: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.creativeJobs.all });
    },
  });
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/use-creative-pipeline.ts
git commit -m "feat(dashboard): add creative pipeline React Query hooks"
```

---

### Task 3: Creative Job Card + Deployment Detail Integration

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/creative-job-card.tsx`
- Modify: `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`

- [ ] **Step 1: Create creative-job-card component**

Create `apps/dashboard/src/components/creative-pipeline/creative-job-card.tsx`:

```typescript
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CreativeJobSummary } from "@/lib/api-client";

const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
  complete: "Complete",
};

function getStatusInfo(job: CreativeJobSummary): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (job.stoppedAt) return { label: "Stopped", variant: "secondary" };
  if (job.currentStage === "complete") return { label: "Complete", variant: "default" };
  return { label: `Running: ${STAGE_LABELS[job.currentStage] ?? job.currentStage}`, variant: "outline" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface CreativeJobCardProps {
  job: CreativeJobSummary;
  deploymentId: string;
}

export function CreativeJobCard({ job, deploymentId }: CreativeJobCardProps) {
  const status = getStatusInfo(job);
  return (
    <Link
      href={`/deployments/${deploymentId}/creative-jobs/${job.id}`}
      className="flex items-center justify-between py-3 px-4 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-3">
        <Badge variant={status.variant} className="text-[11px]">
          {status.label}
        </Badge>
        <span className="text-[13px] text-muted-foreground truncate max-w-[200px]">
          {job.productDescription.slice(0, 60)}
          {job.productDescription.length > 60 ? "..." : ""}
        </span>
      </div>
      <span className="text-[12px] text-muted-foreground shrink-0">{timeAgo(job.createdAt)}</span>
    </Link>
  );
}
```

- [ ] **Step 2: Add Creative Jobs section to deployment detail**

In `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`:

Add imports at top:

```typescript
import { Skeleton } from "@/components/ui/skeleton";
import { useCreativeJobs } from "@/hooks/use-creative-pipeline";
import { CreativeJobCard } from "@/components/creative-pipeline/creative-job-card";
```

Note: `Skeleton` is already imported — only add the two new imports.

Inside the component, after the existing `useTrustProgression` hook, add:

```typescript
const { data: creativeJobs, isLoading: creativeJobsLoading } = useCreativeJobs(deploymentId);
```

After the Work Log `</section>` closing tag (line ~159), add:

```tsx
{
  /* Creative Jobs */
}
<section>
  <h2 className="section-label mb-4">Creative Jobs</h2>
  <div className="rounded-xl border border-border bg-surface p-6">
    {creativeJobsLoading ? (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    ) : creativeJobs && creativeJobs.length > 0 ? (
      <div className="space-y-2">
        {creativeJobs.map((job) => (
          <CreativeJobCard key={job.id} job={job} deploymentId={deploymentId} />
        ))}
      </div>
    ) : (
      <p className="text-[13px] text-muted-foreground">No creative jobs yet</p>
    )}
  </div>
</section>;
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/creative-job-card.tsx apps/dashboard/src/app/\(auth\)/deployments/\[id\]/deployment-detail-client.tsx
git commit -m "feat(dashboard): add creative job card and deployment detail integration"
```

---

### Task 4: Pipeline Stepper Component

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/pipeline-stepper.tsx`

- [ ] **Step 1: Create the pipeline stepper**

Create `apps/dashboard/src/components/creative-pipeline/pipeline-stepper.tsx`:

```typescript
"use client";

import { Check, Circle, Loader2, Square } from "lucide-react";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production"] as const;

const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
};

type StepState = "completed" | "current" | "pending" | "stopped";

function getStepState(
  stage: string,
  currentStage: string,
  stoppedAt: string | null,
): StepState {
  const stageIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const currentIdx = STAGES.indexOf(currentStage as (typeof STAGES)[number]);

  // "complete" means all stages done
  if (currentStage === "complete") return "completed";

  if (stoppedAt) {
    const stoppedIdx = STAGES.indexOf(stoppedAt as (typeof STAGES)[number]);
    if (stageIdx < stoppedIdx) return "completed";
    if (stageIdx === stoppedIdx) return "stopped";
    return "pending";
  }

  if (stageIdx < currentIdx) return "completed";
  if (stageIdx === currentIdx) return "current";
  return "pending";
}

interface PipelineStepperProps {
  currentStage: string;
  stoppedAt: string | null;
  onStageClick: (stage: string) => void;
  selectedStage: string;
}

export function PipelineStepper({
  currentStage,
  stoppedAt,
  onStageClick,
  selectedStage,
}: PipelineStepperProps) {
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((stage, i) => {
        const state = getStepState(stage, currentStage, stoppedAt);
        const isClickable = state === "completed";
        const isSelected = stage === selectedStage;

        return (
          <div key={stage} className="flex items-center">
            {/* Step */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStageClick(stage)}
              className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg transition-colors ${
                isSelected ? "bg-muted" : ""
              } ${isClickable ? "cursor-pointer hover:bg-muted/50" : "cursor-default"}`}
            >
              {/* Icon */}
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center ${
                  state === "completed"
                    ? "bg-green-500/10 text-green-600"
                    : state === "current"
                      ? "bg-blue-500/10 text-blue-600"
                      : state === "stopped"
                        ? "bg-gray-500/10 text-gray-500"
                        : "bg-muted text-muted-foreground"
                }`}
              >
                {state === "completed" && <Check className="h-4 w-4" />}
                {state === "current" && <Loader2 className="h-4 w-4 animate-spin" />}
                {state === "stopped" && <Square className="h-3.5 w-3.5" />}
                {state === "pending" && <Circle className="h-4 w-4" />}
              </div>
              {/* Label */}
              <span
                className={`text-[11px] font-medium ${
                  state === "completed"
                    ? "text-green-600"
                    : state === "current"
                      ? "text-blue-600"
                      : "text-muted-foreground"
                }`}
              >
                {STAGE_LABELS[stage]}
              </span>
            </button>

            {/* Connector line */}
            {i < STAGES.length - 1 && (
              <div
                className={`h-0.5 w-6 ${
                  getStepState(STAGES[i + 1], currentStage, stoppedAt) !== "pending"
                    ? "bg-green-500/30"
                    : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/pipeline-stepper.tsx
git commit -m "feat(dashboard): add pipeline stepper component"
```

---

### Task 5: Stage Output Renderers

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/stage-output-panel.tsx`
- Create: `apps/dashboard/src/components/creative-pipeline/trend-output.tsx`
- Create: `apps/dashboard/src/components/creative-pipeline/hook-output.tsx`
- Create: `apps/dashboard/src/components/creative-pipeline/script-output.tsx`
- Create: `apps/dashboard/src/components/creative-pipeline/storyboard-output.tsx`
- Create: `apps/dashboard/src/components/creative-pipeline/production-output.tsx`

**Context:**

- Zod schemas are in `packages/schemas/src/creative-job.ts` — import from `@switchboard/schemas`
- Each renderer parses `output: unknown` through its Zod schema for type safety
- If parsing fails, show raw JSON fallback
- **Dashboard uses extensionless imports** — do NOT add `.js` to import paths

- [ ] **Step 1: Create trend-output renderer**

Create `apps/dashboard/src/components/creative-pipeline/trend-output.tsx`:

```typescript
"use client";

import { TrendAnalysisOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";

interface TrendOutputProps {
  output: unknown;
}

export function TrendOutput({ output }: TrendOutputProps) {
  const parsed = TrendAnalysisOutput.safeParse(output);
  if (!parsed.success) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Unable to display formatted output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="space-y-6">
      {/* Angles */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Angles</h4>
        <div className="space-y-3">
          {data.angles.map((angle, i) => (
            <div key={i} className="rounded-lg border border-border/50 p-4 space-y-2">
              <p className="text-[14px] font-medium">{angle.theme}</p>
              <p className="text-[13px] text-muted-foreground">{angle.rationale}</p>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-[11px]">{angle.motivator}</Badge>
                <Badge variant="secondary" className="text-[11px]">{angle.platformFit}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audience Insights */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Audience Insights</h4>
        <div className="rounded-lg border border-border/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Awareness:</span>
            <Badge variant="outline" className="text-[11px] capitalize">
              {data.audienceInsights.awarenessLevel.replace(/_/g, " ")}
            </Badge>
          </div>
          <div>
            <p className="text-[13px] text-muted-foreground mb-1">Top Drivers</p>
            <ul className="list-disc list-inside text-[13px] space-y-0.5">
              {data.audienceInsights.topDrivers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-[13px] text-muted-foreground mb-1">Objections</p>
            <ul className="list-disc list-inside text-[13px] space-y-0.5">
              {data.audienceInsights.objections.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          </div>
        </div>
      </div>

      {/* Trend Signals */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Trend Signals</h4>
        <div className="overflow-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-medium text-muted-foreground">Platform</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Trend</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Relevance</th>
              </tr>
            </thead>
            <tbody>
              {data.trendSignals.map((s, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 capitalize">{s.platform}</td>
                  <td className="py-2">{s.trend}</td>
                  <td className="py-2 text-muted-foreground">{s.relevance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create hook-output renderer**

Create `apps/dashboard/src/components/creative-pipeline/hook-output.tsx`:

```typescript
"use client";

import { HookGeneratorOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";

interface HookOutputProps {
  output: unknown;
}

export function HookOutput({ output }: HookOutputProps) {
  const parsed = HookGeneratorOutput.safeParse(output);
  if (!parsed.success) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Unable to display formatted output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="space-y-6">
      {/* Hooks */}
      <div>
        <h4 className="text-[14px] font-medium mb-3">Hooks</h4>
        <div className="space-y-3">
          {data.hooks.map((hook, i) => (
            <div key={i} className="rounded-lg border border-border/50 p-4 space-y-2">
              <p className="text-[14px]">&ldquo;{hook.text}&rdquo;</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] capitalize">
                  {hook.type.replace(/_/g, " ")}
                </Badge>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${hook.platformScore * 10}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{hook.platformScore}/10</span>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">{hook.rationale}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top Combos */}
      {data.topCombos.length > 0 && (
        <div>
          <h4 className="text-[14px] font-medium mb-3">Top Combos</h4>
          <div className="space-y-2">
            {data.topCombos.map((combo, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
              >
                <span className="text-[13px]">
                  Angle &ldquo;{combo.angleRef}&rdquo; + Hook &ldquo;{combo.hookRef}&rdquo;
                </span>
                <Badge variant="secondary" className="text-[11px]">{combo.score}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create script-output renderer**

Create `apps/dashboard/src/components/creative-pipeline/script-output.tsx`:

```typescript
"use client";

import { ScriptWriterOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";

const SECTION_COLORS: Record<string, string> = {
  hook: "border-l-red-500",
  problem: "border-l-orange-500",
  solution: "border-l-green-500",
  proof: "border-l-blue-500",
  cta: "border-l-purple-500",
};

interface ScriptOutputProps {
  output: unknown;
}

export function ScriptOutput({ output }: ScriptOutputProps) {
  const parsed = ScriptWriterOutput.safeParse(output);
  if (!parsed.success) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Unable to display formatted output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="space-y-6">
      {data.scripts.map((script, i) => (
        <div key={i} className="rounded-lg border border-border/50 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">{script.format.replace(/_/g, " ")}</Badge>
            <Badge variant="secondary" className="text-[11px] capitalize">{script.platform}</Badge>
          </div>

          {/* Full script */}
          <p className="text-[13px] whitespace-pre-wrap">{script.fullScript}</p>

          {/* Timing sections */}
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-muted-foreground">Timing</p>
            {script.timing.map((t, j) => (
              <div
                key={j}
                className={`border-l-2 pl-3 py-1 ${SECTION_COLORS[t.section] ?? "border-l-border"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium capitalize">{t.section}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t.startSec}s - {t.endSec}s
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground">{t.content}</p>
              </div>
            ))}
          </div>

          {/* Production notes */}
          {script.productionNotes && (
            <div>
              <p className="text-[12px] font-medium text-muted-foreground mb-1">Production Notes</p>
              <p className="text-[12px] text-muted-foreground">{script.productionNotes}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create storyboard-output renderer**

Create `apps/dashboard/src/components/creative-pipeline/storyboard-output.tsx`:

```typescript
"use client";

import { StoryboardOutput } from "@switchboard/schemas";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

interface StoryboardOutputProps {
  output: unknown;
}

export function StoryboardOutputRenderer({ output }: StoryboardOutputProps) {
  const parsed = StoryboardOutput.safeParse(output);
  if (!parsed.success) {
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Unable to display formatted output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="space-y-6">
      {data.storyboards.map((sb, i) => (
        <div key={i} className="space-y-3">
          <p className="text-[13px] font-medium text-muted-foreground">
            Storyboard for script &ldquo;{sb.scriptRef}&rdquo;
          </p>
          <div className="space-y-4">
            {sb.scenes.map((scene) => (
              <SceneCard key={scene.sceneNumber} scene={scene} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface SceneProps {
  scene: {
    sceneNumber: number;
    description: string;
    visualDirection: string;
    duration: number;
    textOverlay: string | null;
    referenceImageUrl: string | null;
  };
}

function SceneCard({ scene }: SceneProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium">Scene {scene.sceneNumber}</span>
        <Badge variant="secondary" className="text-[11px]">{scene.duration}s</Badge>
      </div>
      <p className="text-[13px]">{scene.description}</p>
      <p className="text-[12px] text-muted-foreground">{scene.visualDirection}</p>
      {scene.textOverlay && (
        <div className="bg-muted/30 rounded px-3 py-2">
          <p className="text-[12px] font-medium text-muted-foreground">Text Overlay</p>
          <p className="text-[13px]">{scene.textOverlay}</p>
        </div>
      )}
      {scene.referenceImageUrl && !imageError ? (
        <img
          src={scene.referenceImageUrl}
          alt={`Scene ${scene.sceneNumber} reference`}
          className="rounded-lg max-h-64 object-cover"
          onError={() => setImageError(true)}
        />
      ) : scene.referenceImageUrl && imageError ? (
        <div className="rounded-lg bg-muted/30 h-32 flex items-center justify-center">
          <span className="text-[12px] text-muted-foreground">Image expired</span>
        </div>
      ) : (
        <div className="rounded-lg bg-muted/30 h-32 flex items-center justify-center">
          <span className="text-[12px] text-muted-foreground">No image</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create production-output placeholder renderer**

Create `apps/dashboard/src/components/creative-pipeline/production-output.tsx`:

```typescript
"use client";

interface ProductionOutputProps {
  output: unknown;
}

export function ProductionOutput({ output }: ProductionOutputProps) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground mb-2">
        Production output (SP5 — placeholder)
      </p>
      <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
        {JSON.stringify(output, null, 2)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 6: Create stage-output-panel dispatcher**

Create `apps/dashboard/src/components/creative-pipeline/stage-output-panel.tsx`:

```typescript
"use client";

import { TrendOutput } from "./trend-output";
import { HookOutput } from "./hook-output";
import { ScriptOutput } from "./script-output";
import { StoryboardOutputRenderer } from "./storyboard-output";
import { ProductionOutput } from "./production-output";

interface StageOutputPanelProps {
  stageName: string;
  output: unknown;
}

const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
};

export function StageOutputPanel({ stageName, output }: StageOutputPanelProps) {
  if (!output) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[13px] text-muted-foreground">
          No output yet for {STAGE_LABELS[stageName] ?? stageName}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-[15px] font-medium mb-4">
        Stage Output: {STAGE_LABELS[stageName] ?? stageName}
      </h3>
      {stageName === "trends" && <TrendOutput output={output} />}
      {stageName === "hooks" && <HookOutput output={output} />}
      {stageName === "scripts" && <ScriptOutput output={output} />}
      {stageName === "storyboard" && <StoryboardOutputRenderer output={output} />}
      {stageName === "production" && <ProductionOutput output={output} />}
    </div>
  );
}
```

- [ ] **Step 7: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/
git commit -m "feat(dashboard): add stage output renderers and pipeline stepper"
```

Wait — pipeline stepper was committed in Task 4. Only commit the output renderers here:

```bash
git add apps/dashboard/src/components/creative-pipeline/stage-output-panel.tsx apps/dashboard/src/components/creative-pipeline/trend-output.tsx apps/dashboard/src/components/creative-pipeline/hook-output.tsx apps/dashboard/src/components/creative-pipeline/script-output.tsx apps/dashboard/src/components/creative-pipeline/storyboard-output.tsx apps/dashboard/src/components/creative-pipeline/production-output.tsx
git commit -m "feat(dashboard): add stage output renderers for creative pipeline"
```

---

### Task 6: Action Bar Component

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`

**Context:**

- Toast hook: `import { useToast } from "@/components/ui/use-toast"`
- Usage: `const { toast } = useToast(); toast({ title: "...", description: "..." })`
- `stoppedAt` stores a stage name, not a timestamp
- The `STAGE_ORDER` array (`["trends", "hooks", "scripts", "storyboard", "production"]`) determines next stage

- [ ] **Step 1: Create the action bar**

Create `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useApproveStage } from "@/hooks/use-creative-pipeline";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production"] as const;
const STAGE_LABELS: Record<string, string> = {
  trends: "Trends",
  hooks: "Hooks",
  scripts: "Scripts",
  storyboard: "Storyboard",
  production: "Production",
};

function getNextStageLabel(currentStage: string): string {
  const idx = STAGES.indexOf(currentStage as (typeof STAGES)[number]);
  if (idx === -1 || idx >= STAGES.length - 1) return "Complete";
  return STAGE_LABELS[STAGES[idx + 1]] ?? "Next";
}

interface ActionBarProps {
  jobId: string;
  currentStage: string;
  stoppedAt: string | null;
}

export function ActionBar({ jobId, currentStage, stoppedAt }: ActionBarProps) {
  const { toast } = useToast();
  const approveMutation = useApproveStage();
  const [confirmStop, setConfirmStop] = useState(false);

  // Hide when job is complete or stopped
  if (currentStage === "complete" || stoppedAt) return null;

  const handleApprove = () => {
    approveMutation.mutate(
      { jobId, action: "continue" },
      {
        onSuccess: () => {
          toast({ title: "Stage approved", description: "Pipeline continuing to next stage." });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update pipeline. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleStop = () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    approveMutation.mutate(
      { jobId, action: "stop" },
      {
        onSuccess: () => {
          toast({ title: "Pipeline stopped" });
          setConfirmStop(false);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update pipeline. Please try again.",
            variant: "destructive",
          });
          setConfirmStop(false);
        },
      },
    );
  };

  return (
    <div className="sticky bottom-0 bg-background border-t border-border p-4 flex items-center justify-end gap-3">
      <Button
        variant="destructive"
        size="sm"
        onClick={handleStop}
        disabled={approveMutation.isPending}
      >
        {confirmStop ? "Are you sure?" : "Stop Pipeline"}
      </Button>
      <Button size="sm" onClick={handleApprove} disabled={approveMutation.isPending}>
        {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Approve & Continue to {getNextStageLabel(currentStage)}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/action-bar.tsx
git commit -m "feat(dashboard): add creative pipeline action bar"
```

---

### Task 7: Job Detail Page (Server + Client)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/creative-job-detail-client.tsx`

**Context:**

- Server page pattern: see `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`
- Server fetches data, passes as `initialData` prop to client component
- Client component uses `useCreativeJob(id)` with `initialData` for hydration (avoids redundant fetch)
- `stoppedAt` is a stage name (e.g., `"hooks"`), not a timestamp
- `stageOutputs` is a `Record<string, unknown>` — keys are stage names like `"trends"`, `"hooks"`, etc.
- Dashboard uses extensionless imports

- [ ] **Step 1: Create the server page**

Create `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/page.tsx`:

```typescript
import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { CreativeJobDetailClient } from "./creative-job-detail-client";

interface PageProps {
  params: Promise<{ id: string; jobId: string }>;
}

export default async function CreativeJobDetailPage({ params }: PageProps) {
  const { id: deploymentId, jobId } = await params;

  try {
    const client = await getApiClient();
    const { job } = await client.getCreativeJob(jobId);
    if (!job) notFound();
    return <CreativeJobDetailClient deploymentId={deploymentId} initialJob={job} />;
  } catch {
    notFound();
  }
}
```

- [ ] **Step 2: Create the client component**

Create `apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/[jobId]/creative-job-detail-client.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCreativeJob } from "@/hooks/use-creative-pipeline";
import { PipelineStepper } from "@/components/creative-pipeline/pipeline-stepper";
import { StageOutputPanel } from "@/components/creative-pipeline/stage-output-panel";
import { ActionBar } from "@/components/creative-pipeline/action-bar";
import type { CreativeJobSummary } from "@/lib/api-client";

const STAGES = ["trends", "hooks", "scripts", "storyboard", "production"] as const;

function getLatestCompletedStage(job: CreativeJobSummary): string {
  if (job.currentStage === "complete") return "production";
  const currentIdx = STAGES.indexOf(job.currentStage as (typeof STAGES)[number]);
  if (currentIdx <= 0) return STAGES[0];
  return STAGES[currentIdx - 1];
}

function getStatusInfo(job: CreativeJobSummary): {
  label: string;
  className: string;
} {
  if (job.stoppedAt) return { label: "Stopped", className: "bg-gray-500/10 text-gray-600" };
  if (job.currentStage === "complete")
    return { label: "Complete", className: "bg-green-500/10 text-green-600" };
  return { label: "Running", className: "bg-blue-500/10 text-blue-600" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface CreativeJobDetailClientProps {
  deploymentId: string;
  initialJob: CreativeJobSummary;
}

export function CreativeJobDetailClient({
  deploymentId,
  initialJob,
}: CreativeJobDetailClientProps) {
  const router = useRouter();
  const { data: job } = useCreativeJob(initialJob.id);
  const currentJob = job ?? initialJob;

  const [selectedStage, setSelectedStage] = useState(() =>
    getLatestCompletedStage(currentJob),
  );

  const status = getStatusInfo(currentJob);
  const stageOutput = (currentJob.stageOutputs as Record<string, unknown>)[selectedStage];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push(`/deployments/${deploymentId}`)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to deployment
      </button>

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          Creative Job #{currentJob.id.slice(0, 8)}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <Badge className={`text-[11px] ${status.className}`}>{status.label}</Badge>
          <span className="text-[13px] text-muted-foreground">
            {timeAgo(currentJob.createdAt)}
          </span>
        </div>
      </div>

      {/* Pipeline Stepper */}
      <PipelineStepper
        currentStage={currentJob.currentStage}
        stoppedAt={currentJob.stoppedAt}
        onStageClick={setSelectedStage}
        selectedStage={selectedStage}
      />

      {/* Stage Output */}
      <StageOutputPanel stageName={selectedStage} output={stageOutput} />

      {/* Action Bar */}
      <ActionBar
        jobId={currentJob.id}
        currentStage={currentJob.currentStage}
        stoppedAt={currentJob.stoppedAt}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/deployments/[id]/creative-jobs/"
git commit -m "feat(dashboard): add creative job detail page with stepper and output views"
```

---

## Verification

After all tasks are complete:

- [ ] Run `cd apps/dashboard && npx tsc --noEmit` — no type errors
- [ ] Run `pnpm lint` — no lint errors
- [ ] Run `pnpm --filter @switchboard/dashboard build` — build succeeds
- [ ] Verify all new files follow extensionless imports (no `.js` in dashboard code)
- [ ] Verify no `console.log` statements (only `console.warn` / `console.error` allowed)
