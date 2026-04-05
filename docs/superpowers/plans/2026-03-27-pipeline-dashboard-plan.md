# Pipeline Funnel Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pipeline funnel visualization to the owner dashboard and wire the revenue stat card to real data from the `GET /api/lifecycle/pipeline` endpoint.

**Architecture:** Dashboard proxy route → React Query hook → PipelineFunnel component embedded in OwnerToday. Single fetch shared between revenue stat card and funnel. Also fixes Dockerfile `--no-frozen-lockfile` (already done).

**Tech Stack:** Next.js App Router, React Query, Tailwind CSS, Zod (PipelineSnapshot schema)

---

### Task 1: Add `pipeline` to query keys

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`

- [ ] **Step 1: Add pipeline key group**

Add after the `escalations` block (line 116):

```typescript
  pipeline: {
    all: ["pipeline"] as const,
    snapshot: () => ["pipeline", "snapshot"] as const,
  },
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add pipeline query keys"
```

---

### Task 2: Add `getPipeline` to SwitchboardClient

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`

- [ ] **Step 1: Add getPipeline method**

Add after the `listEscalations` block (after line 578), before the closing `}` of the class:

```typescript
  // Pipeline
  async getPipeline() {
    return this.request<{
      organizationId: string;
      stages: Array<{ stage: string; count: number; totalValue: number }>;
      totalContacts: number;
      totalRevenue: number;
      generatedAt: string;
    }>("/api/lifecycle/pipeline");
  }
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add getPipeline to SwitchboardClient"
```

---

### Task 3: Create pipeline proxy route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/pipeline/route.ts`

- [ ] **Step 1: Create the proxy route**

Follow the exact pattern from `apps/dashboard/src/app/api/dashboard/approvals/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.getPipeline();
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

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add pipeline dashboard proxy route"
```

---

### Task 4: Create `usePipeline` hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-pipeline.ts`

- [ ] **Step 1: Create the hook**

Follow the pattern from `apps/dashboard/src/hooks/use-leads.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface PipelineStage {
  stage: string;
  count: number;
  totalValue: number;
}

export interface PipelineSnapshot {
  organizationId: string;
  stages: PipelineStage[];
  totalContacts: number;
  totalRevenue: number;
  generatedAt: string;
}

async function fetchPipeline(): Promise<PipelineSnapshot> {
  const res = await fetch("/api/dashboard/pipeline");
  if (!res.ok) throw new Error("Failed to fetch pipeline");
  return res.json();
}

export function usePipeline() {
  return useQuery({
    queryKey: queryKeys.pipeline.snapshot(),
    queryFn: fetchPipeline,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add usePipeline React Query hook"
```

---

### Task 5: Create `PipelineFunnel` component

**Files:**

- Create: `apps/dashboard/src/components/dashboard/pipeline-funnel.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import type { PipelineSnapshot } from "@/hooks/use-pipeline";

const FUNNEL_STAGES = [
  "interested",
  "qualified",
  "quoted",
  "booked",
  "showed",
  "won",
] as const;

const STAGE_LABELS: Record<string, string> = {
  interested: "Interested",
  qualified: "Qualified",
  quoted: "Quoted",
  booked: "Booked",
  showed: "Showed",
  won: "Won",
};

const STAGE_COLORS: Record<string, string> = {
  interested: "bg-blue-400/70",
  qualified: "bg-blue-500/70",
  quoted: "bg-blue-600/70",
  booked: "bg-blue-700/70",
  showed: "bg-blue-800/70",
  won: "bg-blue-900/80",
};

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function SkeletonBars() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div
            className="h-6 rounded bg-muted animate-pulse"
            style={{ width: `${100 - i * 12}%`, minWidth: "8%" }}
          />
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

interface PipelineFunnelProps {
  data: PipelineSnapshot | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function PipelineFunnel({ data, isLoading, isError }: PipelineFunnelProps) {
  if (isError) return null;

  if (isLoading) {
    return (
      <section>
        <h2 className="section-label mb-3">Your pipeline</h2>
        <div className="rounded-xl border border-border/60 bg-surface p-5">
          <SkeletonBars />
        </div>
      </section>
    );
  }

  if (!data || data.stages.length === 0) {
    return (
      <section>
        <h2 className="section-label mb-3">Your pipeline</h2>
        <div className="rounded-xl border border-border/60 bg-surface-raised px-6 py-6 text-center">
          <p className="text-[14px] text-foreground font-medium">
            No leads in your pipeline yet
          </p>
        </div>
      </section>
    );
  }

  const stageMap = new Map(data.stages.map((s) => [s.stage, s]));
  const maxCount = Math.max(
    ...FUNNEL_STAGES.map((s) => stageMap.get(s)?.count ?? 0),
    1,
  );

  const lost = stageMap.get("lost");
  const nurturing = stageMap.get("nurturing");

  return (
    <section>
      <h2 className="section-label mb-3">Your pipeline</h2>
      <div className="rounded-xl border border-border/60 bg-surface p-5 space-y-2.5">
        {FUNNEL_STAGES.map((stage) => {
          const entry = stageMap.get(stage);
          const count = entry?.count ?? 0;
          const value = entry?.totalValue ?? 0;
          const widthPct = Math.max((count / maxCount) * 100, 8);

          return (
            <div key={stage} className="flex items-center gap-3">
              <div
                className={`h-6 rounded ${STAGE_COLORS[stage] ?? "bg-blue-500/70"}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className="text-[12.5px] text-muted-foreground whitespace-nowrap min-w-[70px]">
                {STAGE_LABELS[stage] ?? stage}
              </span>
              <span className="text-[13px] text-foreground font-medium tabular-nums">
                {count}
              </span>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {formatCurrency(value)}
              </span>
            </div>
          );
        })}

        {(lost || nurturing) && (
          <p className="text-[12px] text-muted-foreground pt-1">
            {[
              lost && `${lost.count} lost`,
              nurturing && `${nurturing.count} nurturing`,
            ]
              .filter(Boolean)
              .join(" \u00b7 ")}
          </p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add PipelineFunnel component"
```

---

### Task 6: Wire PipelineFunnel and revenue into OwnerToday

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`

- [ ] **Step 1: Add imports**

Add these imports at the top of the file (after the existing imports):

```typescript
import { usePipeline } from "@/hooks/use-pipeline";
import { PipelineFunnel } from "@/components/dashboard/pipeline-funnel";
```

- [ ] **Step 2: Add usePipeline hook call**

Inside `OwnerToday()`, after the `const { toast } = useToast();` line (line 29), add:

```typescript
const { data: pipelineData, isLoading: pipelineLoading, isError: pipelineError } = usePipeline();
```

- [ ] **Step 3: Add formatCurrency import**

Add to the imports at the top:

```typescript
import { formatCurrency } from "@/components/dashboard/pipeline-funnel";
```

- [ ] **Step 4: Wire revenue stat card**

Replace the hardcoded `"$0"` in the StatCards `stats` array (line 96):

```typescript
// Before:
{ label: "Revenue", value: "$0" },

// After:
{ label: "Revenue", value: formatCurrency(pipelineData?.totalRevenue ?? 0) },
```

- [ ] **Step 5: Add PipelineFunnel between StatCards and approvals**

Insert after the `<StatCards>` closing tag (after line 98), before the `{topApproval && (` block (line 100):

```tsx
<PipelineFunnel data={pipelineData} isLoading={pipelineLoading} isError={pipelineError} />
```

- [ ] **Step 6: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: wire pipeline funnel and revenue into OwnerToday"
```

---

### Task 7: Add component test for PipelineFunnel

**Files:**

- Create: `apps/dashboard/src/components/dashboard/__tests__/pipeline-funnel.test.tsx`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineFunnel } from "../pipeline-funnel";
import type { PipelineSnapshot } from "@/hooks/use-pipeline";

const MOCK_SNAPSHOT: PipelineSnapshot = {
  organizationId: "org-1",
  stages: [
    { stage: "interested", count: 12, totalValue: 600000 },
    { stage: "qualified", count: 8, totalValue: 450000 },
    { stage: "quoted", count: 5, totalValue: 320000 },
    { stage: "booked", count: 4, totalValue: 280000 },
    { stage: "showed", count: 3, totalValue: 150000 },
    { stage: "won", count: 2, totalValue: 120000 },
    { stage: "lost", count: 4, totalValue: 0 },
    { stage: "nurturing", count: 2, totalValue: 0 },
  ],
  totalContacts: 40,
  totalRevenue: 120000,
  generatedAt: "2026-03-27T10:00:00Z",
};

describe("PipelineFunnel", () => {
  it("renders all 6 funnel stages with counts and values", () => {
    render(<PipelineFunnel data={MOCK_SNAPSHOT} isLoading={false} isError={false} />);

    expect(screen.getByText("Your pipeline")).toBeDefined();
    expect(screen.getByText("Interested")).toBeDefined();
    expect(screen.getByText("Qualified")).toBeDefined();
    expect(screen.getByText("Quoted")).toBeDefined();
    expect(screen.getByText("Booked")).toBeDefined();
    expect(screen.getByText("Showed")).toBeDefined();
    expect(screen.getByText("Won")).toBeDefined();

    // Counts
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("8")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();

    // Currency values
    expect(screen.getByText("$6,000")).toBeDefined();
    expect(screen.getByText("$1,200")).toBeDefined();
  });

  it("renders lost and nurturing summary", () => {
    render(<PipelineFunnel data={MOCK_SNAPSHOT} isLoading={false} isError={false} />);

    expect(screen.getByText(/4 lost/)).toBeDefined();
    expect(screen.getByText(/2 nurturing/)).toBeDefined();
  });

  it("renders loading skeleton", () => {
    const { container } = render(
      <PipelineFunnel data={undefined} isLoading={true} isError={false} />,
    );

    expect(screen.getByText("Your pipeline")).toBeDefined();
    const pulsingBars = container.querySelectorAll(".animate-pulse");
    expect(pulsingBars.length).toBeGreaterThan(0);
  });

  it("renders empty state when no stages", () => {
    const emptyData: PipelineSnapshot = {
      ...MOCK_SNAPSHOT,
      stages: [],
    };
    render(<PipelineFunnel data={emptyData} isLoading={false} isError={false} />);

    expect(screen.getByText("No leads in your pipeline yet")).toBeDefined();
  });

  it("renders nothing on error", () => {
    const { container } = render(
      <PipelineFunnel data={undefined} isLoading={false} isError={true} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("handles missing lost/nurturing gracefully", () => {
    const dataWithoutLost: PipelineSnapshot = {
      ...MOCK_SNAPSHOT,
      stages: MOCK_SNAPSHOT.stages.filter(
        (s) => s.stage !== "lost" && s.stage !== "nurturing",
      ),
    };
    render(<PipelineFunnel data={dataWithoutLost} isLoading={false} isError={false} />);

    expect(screen.getByText("Interested")).toBeDefined();
    expect(screen.queryByText(/lost/)).toBeNull();
    expect(screen.queryByText(/nurturing/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run pipeline-funnel`
Expected: 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add PipelineFunnel component tests"
```

---

### Task 8: Add hook test for usePipeline

**Files:**

- Create: `apps/dashboard/src/hooks/__tests__/use-pipeline.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { usePipeline } from "../use-pipeline";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const MOCK_RESPONSE = {
  organizationId: "org-1",
  stages: [{ stage: "interested", count: 5, totalValue: 100000 }],
  totalContacts: 5,
  totalRevenue: 100000,
  generatedAt: "2026-03-27T00:00:00Z",
};

describe("usePipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches from /api/dashboard/pipeline", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => usePipeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/pipeline", expect.anything());
    expect(result.current.data?.totalRevenue).toBe(100000);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { result } = renderHook(() => usePipeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run use-pipeline`
Expected: 2 tests PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add usePipeline hook tests"
```

---

### Task 9: Dockerfile fix (already done — verify and commit)

**Files:**

- Verify: `Dockerfile` (lines 26, 78, 126, 186)

- [ ] **Step 1: Verify all 4 lines use `--frozen-lockfile`**

Read `Dockerfile` and confirm lines 26, 78, 126, 186 all have `--frozen-lockfile` (not `--no-frozen-lockfile`).

- [ ] **Step 2: Commit if not already committed**

```bash
git commit -m "fix: use --frozen-lockfile for reproducible Docker builds"
```

---

### Task 10: Run full test suite and typecheck

- [ ] **Step 1: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 2: Run tests**

Run: `npx pnpm@9.15.4 test -- --run`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS
