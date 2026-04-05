# Frontend — Marketplace + Deploy Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dashboard frontend for browsing the agent marketplace, viewing agent trust scores, deploying agents with a 3-step wizard, and reviewing task outputs.

**Architecture:** Next.js App Router pages proxy to existing Fastify marketplace API routes (`/api/marketplace/*`) via server-side API route handlers. TanStack React Query manages all data fetching. The deploy wizard is a multi-step `useState`-based flow following the existing onboarding wizard pattern.

**Tech Stack:** Next.js 14 (App Router), TanStack React Query v5, Tailwind CSS, shadcn/ui (Radix + CVA), lucide-react icons, Zod

---

## Conventions (read before implementing)

**Dashboard-specific conventions that differ from the rest of the monorepo:**

- **NO `.js` extensions** on imports — Next.js webpack requires extensionless imports
- **Path alias**: `@/*` maps to `./src/*` — use `@/hooks/use-listings` not `../../hooks/use-listings`
- **Every client component** starts with `"use client";` directive
- **Font sizes**: pixel-based Tailwind literals (`text-[13px]`, `text-[14.5px]`, `text-[22px]`), not standard `text-sm`/`text-lg`
- **Section headers**: use `section-label` CSS class (11px uppercase, muted, tracking)
- **Colors**: `text-foreground`, `text-muted-foreground`, `bg-surface`, `bg-background`, `border-border`, `bg-positive`, `bg-negative`, `bg-caution`
- **Transitions**: `duration-fast` (120ms), not `duration-150`
- **Rounded corners**: `rounded-xl` for cards, `rounded-lg` for buttons/inputs
- **Touch targets**: `min-h-[44px]` on interactive elements
- **`cn()`**: import from `@/lib/utils` — standard `clsx` + `tailwind-merge`
- **Icons**: import individual icons from `lucide-react`
- **No global state** — React Query for server state, `useState` for local
- **Tests**: This package has no test infrastructure (no vitest config). Skip test files — the data layer (API routes, hooks) is tested via the backend API tests and manual verification.

**Data fetching pattern (two-layer proxy):**

1. Client-side hooks fetch from `/api/dashboard/marketplace/*` (Next.js API routes)
2. Next.js API routes use `getApiClient()` to proxy to Fastify API at `/api/marketplace/*`
3. `getApiClient()` runs server-side, decrypts user's API key from Prisma, creates authenticated `SwitchboardClient`

---

## File Structure

### New files to create:

| File                                                                             | Responsibility                                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Data layer**                                                                   |                                                                                     |
| `apps/dashboard/src/app/api/dashboard/marketplace/listings/route.ts`             | Proxy: GET listings                                                                 |
| `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/route.ts`        | Proxy: GET listing detail                                                           |
| `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/route.ts`  | Proxy: GET trust score breakdown                                                    |
| `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts` | Proxy: POST deploy listing                                                          |
| `apps/dashboard/src/app/api/dashboard/marketplace/deployments/route.ts`          | Proxy: GET deployments                                                              |
| `apps/dashboard/src/app/api/dashboard/marketplace/tasks/route.ts`                | Proxy: GET/POST tasks                                                               |
| `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/submit/route.ts`    | Proxy: POST submit output                                                           |
| `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/review/route.ts`    | Proxy: POST review task                                                             |
| `apps/dashboard/src/hooks/use-marketplace.ts`                                    | React Query hooks: useListings, useListing, useTrustScore, useDeployments, useTasks |
| **Pages**                                                                        |                                                                                     |
| `apps/dashboard/src/app/marketplace/page.tsx`                                    | Marketplace browse — grid of agent listing cards                                    |
| `apps/dashboard/src/app/marketplace/[id]/page.tsx`                               | Agent detail — trust score, stats, deploy button                                    |
| `apps/dashboard/src/app/marketplace/[id]/deploy/page.tsx`                        | Deploy wizard — 3-step flow                                                         |
| `apps/dashboard/src/app/tasks/page.tsx`                                          | Task review queue — pending + history tabs                                          |
| **Components**                                                                   |                                                                                     |
| `apps/dashboard/src/components/marketplace/listing-card.tsx`                     | Agent listing card (name, type, score, category badges, price tier)                 |
| `apps/dashboard/src/components/marketplace/trust-score-badge.tsx`                | Trust score display with autonomy level indicator                                   |
| `apps/dashboard/src/components/marketplace/category-filter.tsx`                  | Task category filter bar                                                            |
| `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`              | Deploy wizard chrome (step indicator, nav buttons)                                  |
| `apps/dashboard/src/components/marketplace/deploy-step-config.tsx`               | Step 1: Input configuration form                                                    |
| `apps/dashboard/src/components/marketplace/deploy-step-connect.tsx`              | Step 2: Connect integrations                                                        |
| `apps/dashboard/src/components/marketplace/deploy-step-governance.tsx`           | Step 3: Governance settings                                                         |
| `apps/dashboard/src/components/tasks/task-card.tsx`                              | Task card (status, output preview, approve/reject buttons)                          |
| `apps/dashboard/src/components/tasks/task-review-dialog.tsx`                     | Confirmation dialog for approve/reject                                              |

### Files to modify:

| File                                                  | Change                                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `apps/dashboard/src/lib/query-keys.ts`                | Add `marketplace` and `tasks` query key groups         |
| `apps/dashboard/src/lib/api-client.ts`                | Add marketplace types and methods to SwitchboardClient |
| `apps/dashboard/src/components/layout/owner-tabs.tsx` | Add "Hire" tab (marketplace)                           |
| `apps/dashboard/src/components/layout/staff-nav.tsx`  | Add "Marketplace" and "Tasks" nav items                |

---

### Task 1: Data layer — API client, proxy routes, query keys, hooks

**Files:**

- Create: `apps/dashboard/src/lib/api-client-marketplace.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/listings/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/submit/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/review/route.ts`
- Create: `apps/dashboard/src/hooks/use-marketplace.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`

This task establishes the full data layer: API client methods, Next.js proxy routes, query keys, and React Query hooks. Everything else depends on this.

- [ ] **Step 1: Add marketplace query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add these entries to the `queryKeys` object (after `knowledge`):

```typescript
  marketplace: {
    all: ["marketplace"] as const,
    listings: (filters?: Record<string, string | undefined>) =>
      ["marketplace", "listings", filters] as const,
    listing: (id: string) => ["marketplace", "listing", id] as const,
    trust: (id: string) => ["marketplace", "trust", id] as const,
    deployments: () => ["marketplace", "deployments"] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (filters?: Record<string, string | undefined>) =>
      ["tasks", "list", filters] as const,
  },
```

- [ ] **Step 2: Add marketplace methods to SwitchboardClient**

In `apps/dashboard/src/lib/api-client.ts`, add a new `// ── Marketplace ──` section at the bottom of the `SwitchboardClient` class (before the closing `}`). The class extends `SwitchboardClientBase` which has a `protected request<T>(path, init?)` method. All methods use `this.request()`.

First, add these type exports at the top of the file (after the existing imports):

```typescript
// Marketplace types
export interface MarketplaceListing {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  status: string;
  taskCategories: string[];
  trustScore: number;
  autonomyLevel: string;
  priceTier: string;
  priceMonthly: number;
  webhookUrl: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceDeployment {
  id: string;
  organizationId: string;
  listingId: string;
  status: string;
  inputConfig: Record<string, unknown>;
  governanceSettings: Record<string, unknown>;
  outputDestination: Record<string, unknown> | null;
  connectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceTask {
  id: string;
  deploymentId: string;
  organizationId: string;
  listingId: string;
  category: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  acceptanceCriteria: string | null;
  reviewResult: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustScoreBreakdown {
  listingId: string;
  priceTier: string;
  breakdown: Array<{
    taskCategory: string;
    score: number;
    autonomyLevel: string;
    totalApprovals: number;
    totalRejections: number;
    consecutiveApprovals: number;
    lastActivityAt: string;
  }>;
}
```

Then add these methods inside the `SwitchboardClient` class:

```typescript
  // ── Marketplace ──

  async listMarketplaceListings(filters?: {
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.type) params.set("type", filters.type);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return this.request<{ listings: MarketplaceListing[] }>(
      `/api/marketplace/listings${qs ? `?${qs}` : ""}`,
    );
  }

  async getMarketplaceListing(id: string) {
    return this.request<{ listing: MarketplaceListing }>(`/api/marketplace/listings/${id}`);
  }

  async getListingTrustScore(id: string) {
    return this.request<TrustScoreBreakdown>(`/api/marketplace/listings/${id}/trust`);
  }

  async deployListing(
    id: string,
    config: {
      inputConfig?: Record<string, unknown>;
      governanceSettings?: Record<string, unknown>;
      outputDestination?: Record<string, unknown>;
      connectionIds?: string[];
    },
  ) {
    return this.request<{ deployment: MarketplaceDeployment }>(
      `/api/marketplace/listings/${id}/deploy`,
      { method: "POST", body: JSON.stringify(config) },
    );
  }

  async listDeployments() {
    return this.request<{ deployments: MarketplaceDeployment[] }>(`/api/marketplace/deployments`);
  }

  async createTask(data: {
    deploymentId: string;
    listingId: string;
    category: string;
    input?: Record<string, unknown>;
    acceptanceCriteria?: string;
  }) {
    return this.request<{ task: MarketplaceTask }>(`/api/marketplace/tasks`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listTasks(filters?: { status?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    return this.request<{ tasks: MarketplaceTask[] }>(
      `/api/marketplace/tasks${qs ? `?${qs}` : ""}`,
    );
  }

  async submitTaskOutput(taskId: string, output: Record<string, unknown>) {
    return this.request<{ task: MarketplaceTask }>(
      `/api/marketplace/tasks/${taskId}/submit`,
      { method: "POST", body: JSON.stringify({ output }) },
    );
  }

  async reviewTask(taskId: string, result: "approved" | "rejected", reviewResult?: string) {
    return this.request<{ task: MarketplaceTask }>(
      `/api/marketplace/tasks/${taskId}/review`,
      { method: "POST", body: JSON.stringify({ result, reviewResult }) },
    );
  }
```

**Note**: No separate `api-client-marketplace.ts` file needed — the methods and types go directly into `api-client.ts` (the file is 270 lines, adding ~100 brings it to ~370 which is under the 400-line warning).

- [ ] **Step 3: Create proxy route — GET listings**

Create `apps/dashboard/src/app/api/dashboard/marketplace/listings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const type = request.nextUrl.searchParams.get("type") ?? undefined;
    const limit = request.nextUrl.searchParams.get("limit") ?? undefined;
    const offset = request.nextUrl.searchParams.get("offset") ?? undefined;
    const data = await client.listMarketplaceListings({
      status,
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
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

**Note**: No POST handler — listings are admin-curated via the backend API directly.

- [ ] **Step 4: Create proxy route — GET listing detail**

Create `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.getMarketplaceListing(id);
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

- [ ] **Step 5: Create proxy route — GET trust score**

Create `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.getListingTrustScore(id);
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

- [ ] **Step 6: Create proxy route — POST deploy**

Create `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.deployListing(id, body);
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

- [ ] **Step 7: Create proxy route — GET deployments**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.listDeployments();
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

- [ ] **Step 8: Create proxy route — GET/POST tasks**

Create `apps/dashboard/src/app/api/dashboard/marketplace/tasks/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(request: NextRequest) {
  try {
    const client = await getApiClient();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const data = await client.listTasks({ status });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.createTask(body);
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

- [ ] **Step 9: Create proxy route — POST submit task output**

Create `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/submit/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.submitTaskOutput(id, body.output);
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

- [ ] **Step 10: Create proxy route — POST review task**

Create `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/review/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.reviewTask(id, body.result, body.reviewResult);
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

- [ ] **Step 11: Create React Query hooks**

Create `apps/dashboard/src/hooks/use-marketplace.ts`:

```typescript
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  TrustScoreBreakdown,
} from "@/lib/api-client";

// ── Listings ──

async function fetchListings(filters?: Record<string, string | undefined>): Promise<{
  listings: MarketplaceListing[];
}> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.type) params.set("type", filters.type);
  const qs = params.toString();
  const res = await fetch(`/api/dashboard/marketplace/listings${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch listings");
  return res.json();
}

export function useListings(filters?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: queryKeys.marketplace.listings(filters),
    queryFn: () => fetchListings(filters),
  });
}

async function fetchListing(id: string): Promise<{ listing: MarketplaceListing }> {
  const res = await fetch(`/api/dashboard/marketplace/listings/${id}`);
  if (!res.ok) throw new Error("Failed to fetch listing");
  return res.json();
}

export function useListing(id: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.listing(id),
    queryFn: () => fetchListing(id),
    enabled: !!id,
  });
}

// ── Trust Scores ──

async function fetchTrustScore(id: string): Promise<TrustScoreBreakdown> {
  const res = await fetch(`/api/dashboard/marketplace/listings/${id}/trust`);
  if (!res.ok) throw new Error("Failed to fetch trust score");
  return res.json();
}

export function useTrustScore(id: string) {
  return useQuery({
    queryKey: queryKeys.marketplace.trust(id),
    queryFn: () => fetchTrustScore(id),
    enabled: !!id,
  });
}

// ── Deployments ──

async function fetchDeployments(): Promise<{ deployments: MarketplaceDeployment[] }> {
  const res = await fetch("/api/dashboard/marketplace/deployments");
  if (!res.ok) throw new Error("Failed to fetch deployments");
  return res.json();
}

export function useDeployments() {
  return useQuery({
    queryKey: queryKeys.marketplace.deployments(),
    queryFn: fetchDeployments,
  });
}

export function useDeployListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      listingId,
      config,
    }: {
      listingId: string;
      config: {
        inputConfig?: Record<string, unknown>;
        governanceSettings?: Record<string, unknown>;
        outputDestination?: Record<string, unknown>;
        connectionIds?: string[];
      };
    }) => {
      const res = await fetch(`/api/dashboard/marketplace/listings/${listingId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? "Deploy failed");
      }
      return res.json() as Promise<{ deployment: MarketplaceDeployment }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.deployments() });
    },
  });
}

// ── Tasks ──

async function fetchTasks(filters?: Record<string, string | undefined>): Promise<{
  tasks: MarketplaceTask[];
}> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  const qs = params.toString();
  const res = await fetch(`/api/dashboard/marketplace/tasks${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json();
}

export function useTasks(filters?: Record<string, string | undefined>) {
  return useQuery({
    queryKey: queryKeys.tasks.list(filters),
    queryFn: () => fetchTasks(filters),
    refetchInterval: 60_000, // Poll for new task outputs
  });
}

export function useReviewTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      result,
      reviewResult,
    }: {
      taskId: string;
      result: "approved" | "rejected";
      reviewResult?: string;
    }) => {
      const res = await fetch(`/api/dashboard/marketplace/tasks/${taskId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, reviewResult }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? "Review failed");
      }
      return res.json() as Promise<{ task: MarketplaceTask }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all });
    },
  });
}

export function useSubmitTaskOutput() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, output }: { taskId: string; output: Record<string, unknown> }) => {
      const res = await fetch(`/api/dashboard/marketplace/tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? "Submit failed");
      }
      return res.json() as Promise<{ task: MarketplaceTask }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}
```

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add marketplace data layer — API client, proxy routes, hooks

Adds SwitchboardClient marketplace methods, 9 Next.js API proxy
routes for listings/deployments/tasks, query keys, and React Query
hooks for all marketplace operations.
EOF
)"
```

---

### Task 2: Marketplace browse page + listing card

**Files:**

- Create: `apps/dashboard/src/app/marketplace/page.tsx`
- Create: `apps/dashboard/src/components/marketplace/listing-card.tsx`
- Create: `apps/dashboard/src/components/marketplace/trust-score-badge.tsx`
- Create: `apps/dashboard/src/components/marketplace/category-filter.tsx`

- [ ] **Step 1: Create TrustScoreBadge component**

Create `apps/dashboard/src/components/marketplace/trust-score-badge.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";

function getAutonomyLevel(score: number): "supervised" | "guided" | "autonomous" {
  if (score < 40) return "supervised";
  if (score < 70) return "guided";
  return "autonomous";
}

const LEVEL_STYLES = {
  supervised: "bg-negative/10 text-negative",
  guided: "bg-caution/10 text-caution",
  autonomous: "bg-positive/10 text-positive",
} as const;

const LEVEL_LABELS = {
  supervised: "Supervised",
  guided: "Guided",
  autonomous: "Autonomous",
} as const;

export function TrustScoreBadge({
  score,
  size = "default",
}: {
  score: number;
  size?: "default" | "lg";
}) {
  const level = getAutonomyLevel(score);

  return (
    <div className={cn("flex items-center gap-2", size === "lg" && "gap-3")}>
      <span
        className={cn(
          "font-semibold tabular-nums",
          size === "default" ? "text-[15px]" : "text-[28px]",
          score >= 70 ? "text-positive" : score >= 40 ? "text-caution" : "text-negative",
        )}
      >
        {Math.round(score)}
      </span>
      <span
        className={cn(
          "px-2 py-0.5 rounded-md font-medium",
          size === "default" ? "text-[11px]" : "text-[12px]",
          LEVEL_STYLES[level],
        )}
      >
        {LEVEL_LABELS[level]}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create ListingCard component**

Create `apps/dashboard/src/components/marketplace/listing-card.tsx`:

```typescript
"use client";

import Link from "next/link";
import { Bot, User, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TrustScoreBadge } from "./trust-score-badge";
import type { MarketplaceListing } from "@/lib/api-client";

const TYPE_ICON = {
  switchboard_native: Bot,
  third_party: ExternalLink,
  open_source: ExternalLink,
} as const;

const PRICE_LABELS: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  elite: "Elite",
};

export function ListingCard({ listing }: { listing: MarketplaceListing }) {
  const Icon = TYPE_ICON[listing.type as keyof typeof TYPE_ICON] ?? Bot;

  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className="block rounded-xl border border-border bg-surface p-6 space-y-4 hover:border-border/80 hover:bg-surface-raised transition-colors duration-fast"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-foreground leading-snug">
              {listing.name}
            </h3>
            <p className="text-[12px] text-muted-foreground capitalize">{listing.type.replace(/_/g, " ")}</p>
          </div>
        </div>
        <TrustScoreBadge score={listing.trustScore} />
      </div>

      <p className="text-[13.5px] text-muted-foreground leading-relaxed line-clamp-2">
        {listing.description}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {listing.taskCategories.slice(0, 3).map((cat) => (
            <Badge key={cat} variant="secondary" className="text-[11px] font-normal">
              {cat}
            </Badge>
          ))}
          {listing.taskCategories.length > 3 && (
            <Badge variant="secondary" className="text-[11px] font-normal">
              +{listing.taskCategories.length - 3}
            </Badge>
          )}
        </div>
        <span className="text-[12px] text-muted-foreground shrink-0">
          {PRICE_LABELS[listing.priceTier] ?? listing.priceTier}
          {listing.priceMonthly > 0 && ` · $${listing.priceMonthly}/mo`}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Create CategoryFilter component**

Create `apps/dashboard/src/components/marketplace/category-filter.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-fast whitespace-nowrap min-h-[44px]",
          selected === null
            ? "bg-foreground text-background font-medium"
            : "bg-muted text-muted-foreground hover:text-foreground",
        )}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat === selected ? null : cat)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-fast whitespace-nowrap min-h-[44px] capitalize",
            cat === selected
              ? "bg-foreground text-background font-medium"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create marketplace browse page**

Create `apps/dashboard/src/app/marketplace/page.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useListings } from "@/hooks/use-marketplace";
import { ListingCard } from "@/components/marketplace/listing-card";
import { CategoryFilter } from "@/components/marketplace/category-filter";

export default function MarketplacePage() {
  const { status } = useSession();
  const { data, isLoading } = useListings({ status: "listed" });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (status === "unauthenticated") redirect("/login");

  const listings = data?.listings ?? [];

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const l of listings) {
      for (const c of l.taskCategories) cats.add(c);
    }
    return [...cats].sort();
  }, [listings]);

  const filtered = selectedCategory
    ? listings.filter((l) => l.taskCategories.includes(selectedCategory))
    : listings;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Marketplace
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Pre-vetted AI agents rated on real task outcomes. Deploy with one click.
        </p>
      </section>

      {allCategories.length > 0 && (
        <CategoryFilter
          categories={allCategories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {status === "loading" || isLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[15px] text-foreground font-medium">No agents found.</p>
          <p className="text-[14px] text-muted-foreground mt-1.5">
            {selectedCategory
              ? "Try a different category."
              : "Check back soon for new listings."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add marketplace browse page with listing cards

Grid view of agent listings with category filtering, trust score
badges, price tier display. Links to agent detail pages.
EOF
)"
```

---

### Task 3: Agent detail page

**Files:**

- Create: `apps/dashboard/src/app/marketplace/[id]/page.tsx`

- [ ] **Step 1: Create agent detail page**

Create `apps/dashboard/src/app/marketplace/[id]/page.tsx`:

```typescript
"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft, Bot, ExternalLink, Rocket } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListing, useTrustScore, useDeployments } from "@/hooks/use-marketplace";
import { TrustScoreBadge } from "@/components/marketplace/trust-score-badge";
import { cn } from "@/lib/utils";

const PRICE_LABELS: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  elite: "Elite",
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const router = useRouter();
  const { data: listingData, isLoading: listingLoading } = useListing(id);
  const { data: trustData, isLoading: trustLoading } = useTrustScore(id);
  const { data: deploymentsData } = useDeployments();

  if (status === "unauthenticated") redirect("/login");

  const listing = listingData?.listing;
  const isDeployed = deploymentsData?.deployments.some((d) => d.listingId === id) ?? false;

  if (status === "loading" || listingLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] text-foreground font-medium">Agent not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push("/marketplace")}>
          Back to marketplace
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push("/marketplace")}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-fast"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Marketplace
      </button>

      {/* Header */}
      <section className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Bot className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
              {listing.name}
            </h1>
            <p className="text-[13px] text-muted-foreground capitalize mt-0.5">
              {listing.type.replace(/_/g, " ")}
              {listing.sourceUrl && (
                <>
                  {" · "}
                  <a
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {isDeployed ? (
            <Badge variant="secondary" className="text-[12px]">Deployed</Badge>
          ) : (
            <Button onClick={() => router.push(`/marketplace/${id}/deploy`)}>
              <Rocket className="h-4 w-4 mr-1.5" />
              Deploy
            </Button>
          )}
        </div>
      </section>

      {/* Description */}
      <section>
        <p className="text-[14.5px] text-foreground leading-relaxed">
          {listing.description}
        </p>
      </section>

      {/* Trust Score */}
      <section>
        <h2 className="section-label mb-4">Trust Score</h2>
        <div className="rounded-xl border border-border bg-surface p-6">
          <TrustScoreBadge score={listing.trustScore} size="lg" />

          {trustLoading ? (
            <Skeleton className="h-20 mt-4" />
          ) : trustData?.breakdown && trustData.breakdown.length > 0 ? (
            <div className="mt-6 space-y-3">
              <p className="section-label">Per-category breakdown</p>
              {trustData.breakdown.map((item) => (
                <div
                  key={item.taskCategory}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                >
                  <div>
                    <p className="text-[14px] text-foreground capitalize">{item.taskCategory}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {item.totalApprovals} approved · {item.totalRejections} rejected
                      {item.consecutiveApprovals > 0 &&
                        ` · ${item.consecutiveApprovals} streak`}
                    </p>
                  </div>
                  <TrustScoreBadge score={item.score} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground mt-4">
              No task history yet. Deploy this agent to start building trust.
            </p>
          )}
        </div>
      </section>

      {/* Categories & Pricing */}
      <section className="flex gap-8">
        <div className="flex-1">
          <h2 className="section-label mb-3">Task Categories</h2>
          <div className="flex flex-wrap gap-1.5">
            {listing.taskCategories.map((cat) => (
              <Badge key={cat} variant="secondary" className="text-[12px] capitalize">
                {cat}
              </Badge>
            ))}
          </div>
        </div>
        <div className="shrink-0">
          <h2 className="section-label mb-3">Pricing</h2>
          <p className="text-[15px] font-medium text-foreground">
            {PRICE_LABELS[listing.priceTier] ?? listing.priceTier}
            {listing.priceMonthly > 0 && (
              <span className="text-muted-foreground font-normal">
                {" "}· ${listing.priceMonthly}/mo
              </span>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add agent detail page with trust score breakdown

Shows agent profile, trust score with per-category breakdown,
task categories, pricing, and deploy button. Links to deploy wizard.
EOF
)"
```

---

### Task 4: Deploy wizard

**Files:**

- Create: `apps/dashboard/src/app/marketplace/[id]/deploy/page.tsx`
- Create: `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`
- Create: `apps/dashboard/src/components/marketplace/deploy-step-config.tsx`
- Create: `apps/dashboard/src/components/marketplace/deploy-step-connect.tsx`
- Create: `apps/dashboard/src/components/marketplace/deploy-step-governance.tsx`

The deploy wizard follows the same pattern as the existing onboarding wizard (`apps/dashboard/src/app/onboarding/page.tsx`): `useState` for step index, separate component per step, `WizardShell`-style chrome for step indicator and nav buttons.

- [ ] **Step 1: Create DeployWizardShell**

Create `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DeployWizardShellProps {
  steps: string[];
  currentStep: number;
  canProceed: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onNext: () => void;
  onDeploy: () => void;
  children: React.ReactNode;
}

export function DeployWizardShell({
  steps,
  currentStep,
  canProceed,
  isSubmitting,
  onBack,
  onNext,
  onDeploy,
  children,
}: DeployWizardShellProps) {
  const isLast = currentStep === steps.length - 1;

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 text-[13px]",
                i === currentStep
                  ? "text-foreground font-medium"
                  : i < currentStep
                    ? "text-positive"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-medium",
                  i === currentStep
                    ? "bg-foreground text-background"
                    : i < currentStep
                      ? "bg-positive/20 text-positive"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < currentStep ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px w-8 sm:w-12",
                  i < currentStep ? "bg-positive/40" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div>{children}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border/60">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={currentStep === 0}
          className="text-[13px]"
        >
          Back
        </Button>
        {isLast ? (
          <Button
            onClick={onDeploy}
            disabled={!canProceed || isSubmitting}
            className="text-[13px]"
          >
            {isSubmitting ? "Deploying..." : "Deploy Agent"}
          </Button>
        ) : (
          <Button
            onClick={onNext}
            disabled={!canProceed}
            className="text-[13px]"
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create DeployStepConfig**

Create `apps/dashboard/src/components/marketplace/deploy-step-config.tsx`:

```typescript
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface DeployStepConfigProps {
  config: {
    taskDescription: string;
    acceptanceCriteria: string;
    outputFormat: string;
  };
  onChange: (config: DeployStepConfigProps["config"]) => void;
}

export function DeployStepConfig({ config, onChange }: DeployStepConfigProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-medium text-foreground">Configure Input</h2>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Tell the agent what kind of work you need done.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="taskDescription" className="text-[13px]">
            Default task description
          </Label>
          <Textarea
            id="taskDescription"
            value={config.taskDescription}
            onChange={(e) => onChange({ ...config, taskDescription: e.target.value })}
            placeholder="e.g., Write Instagram captions for product launches"
            className="mt-1.5"
            rows={3}
          />
        </div>

        <div>
          <Label htmlFor="acceptanceCriteria" className="text-[13px]">
            Acceptance criteria (optional)
          </Label>
          <Textarea
            id="acceptanceCriteria"
            value={config.acceptanceCriteria}
            onChange={(e) => onChange({ ...config, acceptanceCriteria: e.target.value })}
            placeholder="e.g., Must include product name and CTA, under 150 characters"
            className="mt-1.5"
            rows={2}
          />
        </div>

        <div>
          <Label htmlFor="outputFormat" className="text-[13px]">
            Expected output format
          </Label>
          <Input
            id="outputFormat"
            value={config.outputFormat}
            onChange={(e) => onChange({ ...config, outputFormat: e.target.value })}
            placeholder="e.g., Plain text, JSON, Markdown"
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DeployStepConnect**

Create `apps/dashboard/src/components/marketplace/deploy-step-connect.tsx`:

```typescript
"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const INTEGRATIONS = [
  { id: "gmail", name: "Gmail", description: "Send and receive emails" },
  { id: "slack", name: "Slack", description: "Post to channels and DMs" },
  { id: "notion", name: "Notion", description: "Read and write pages" },
  { id: "sheets", name: "Google Sheets", description: "Read and write spreadsheets" },
] as const;

interface DeployStepConnectProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function DeployStepConnect({ selectedIds, onChange }: DeployStepConnectProps) {
  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-medium text-foreground">Connect Tools</h2>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Choose which integrations this agent can access. You can change these later.
        </p>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {INTEGRATIONS.map((integration) => {
          const selected = selectedIds.includes(integration.id);
          return (
            <button
              key={integration.id}
              onClick={() => toggle(integration.id)}
              className={cn(
                "flex items-center gap-3 p-4 rounded-xl border text-left transition-colors duration-fast min-h-[44px]",
                selected
                  ? "border-foreground/30 bg-surface-raised"
                  : "border-border bg-surface hover:border-border/80",
              )}
            >
              <div
                className={cn(
                  "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                  selected
                    ? "bg-foreground border-foreground"
                    : "border-border",
                )}
              >
                {selected && <Check className="h-3 w-3 text-background" />}
              </div>
              <div>
                <p className="text-[14px] text-foreground font-medium">{integration.name}</p>
                <p className="text-[12px] text-muted-foreground">{integration.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[12px] text-muted-foreground">
        Integrations are optional. The agent can also receive work via copy-paste.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Create DeployStepGovernance**

Create `apps/dashboard/src/components/marketplace/deploy-step-governance.tsx`:

```typescript
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface GovernanceConfig {
  requireApproval: boolean;
  dailySpendLimit: string;
  maxTasksPerDay: string;
  autoPauseBelow: string;
}

interface DeployStepGovernanceProps {
  config: GovernanceConfig;
  onChange: (config: GovernanceConfig) => void;
}

export function DeployStepGovernance({ config, onChange }: DeployStepGovernanceProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-medium text-foreground">Governance Settings</h2>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Set guardrails for this agent. Smart defaults are pre-configured — adjust only what you need.
        </p>
      </div>

      <div className="space-y-5">
        {/* Require approval */}
        <div className="flex items-center justify-between gap-4 py-3 border-b border-border/50">
          <div>
            <Label className="text-[14px] font-medium">Require my approval</Label>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Override trust score — always require approval for this agent's output
            </p>
          </div>
          <Switch
            checked={config.requireApproval}
            onCheckedChange={(checked) => onChange({ ...config, requireApproval: checked })}
          />
        </div>

        {/* Daily spend limit */}
        <div>
          <Label htmlFor="dailySpendLimit" className="text-[13px]">
            Daily spend limit ($)
          </Label>
          <Input
            id="dailySpendLimit"
            type="number"
            min="0"
            value={config.dailySpendLimit}
            onChange={(e) => onChange({ ...config, dailySpendLimit: e.target.value })}
            placeholder="50"
            className="mt-1.5 max-w-[200px]"
          />
        </div>

        {/* Max tasks per day */}
        <div>
          <Label htmlFor="maxTasksPerDay" className="text-[13px]">
            Max tasks per day
          </Label>
          <Input
            id="maxTasksPerDay"
            type="number"
            min="1"
            value={config.maxTasksPerDay}
            onChange={(e) => onChange({ ...config, maxTasksPerDay: e.target.value })}
            placeholder="10"
            className="mt-1.5 max-w-[200px]"
          />
        </div>

        {/* Auto-pause threshold */}
        <div>
          <Label htmlFor="autoPauseBelow" className="text-[13px]">
            Auto-pause if trust drops below
          </Label>
          <Input
            id="autoPauseBelow"
            type="number"
            min="0"
            max="100"
            value={config.autoPauseBelow}
            onChange={(e) => onChange({ ...config, autoPauseBelow: e.target.value })}
            placeholder="30"
            className="mt-1.5 max-w-[200px]"
          />
          <p className="text-[12px] text-muted-foreground mt-1">
            Agent pauses automatically if score drops below this threshold.
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create deploy wizard page**

Create `apps/dashboard/src/app/marketplace/[id]/deploy/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useListing, useDeployListing } from "@/hooks/use-marketplace";
import { DeployWizardShell } from "@/components/marketplace/deploy-wizard-shell";
import { DeployStepConfig } from "@/components/marketplace/deploy-step-config";
import { DeployStepConnect } from "@/components/marketplace/deploy-step-connect";
import { DeployStepGovernance } from "@/components/marketplace/deploy-step-governance";

const STEPS = ["Configure", "Connect", "Governance"];

export default function DeployPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const { data: listingData, isLoading } = useListing(id);
  const deployMutation = useDeployListing();

  const [step, setStep] = useState(0);

  // Step 1: Config
  const [inputConfig, setInputConfig] = useState({
    taskDescription: "",
    acceptanceCriteria: "",
    outputFormat: "",
  });

  // Step 2: Connections
  const [connectionIds, setConnectionIds] = useState<string[]>([]);

  // Step 3: Governance
  const [governance, setGovernance] = useState({
    requireApproval: false,
    dailySpendLimit: "",
    maxTasksPerDay: "10",
    autoPauseBelow: "30",
  });

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const listing = listingData?.listing;
  if (!listing) {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] text-foreground font-medium">Agent not found.</p>
      </div>
    );
  }

  const handleDeploy = async () => {
    try {
      await deployMutation.mutateAsync({
        listingId: id,
        config: {
          inputConfig,
          governanceSettings: {
            requireApproval: governance.requireApproval,
            dailySpendLimit: governance.dailySpendLimit
              ? (parseFloat(governance.dailySpendLimit) || null)
              : null,
            maxTasksPerDay: governance.maxTasksPerDay
              ? (parseInt(governance.maxTasksPerDay, 10) || null)
              : null,
            autoPauseBelow: governance.autoPauseBelow
              ? (parseInt(governance.autoPauseBelow, 10) || null)
              : null,
          },
          connectionIds,
        },
      });
      toast({
        title: "Agent deployed",
        description: `${listing.name} is now active in your workspace.`,
      });
      router.push("/marketplace");
    } catch (err) {
      toast({
        title: "Deploy failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push(`/marketplace/${id}`)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-fast"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {listing.name}
      </button>

      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Deploy {listing.name}
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Set up this agent for your workspace in three steps.
        </p>
      </div>

      <DeployWizardShell
        steps={STEPS}
        currentStep={step}
        canProceed={true}
        isSubmitting={deployMutation.isPending}
        onBack={() => setStep((s) => Math.max(0, s - 1))}
        onNext={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
        onDeploy={handleDeploy}
      >
        {step === 0 && <DeployStepConfig config={inputConfig} onChange={setInputConfig} />}
        {step === 1 && <DeployStepConnect selectedIds={connectionIds} onChange={setConnectionIds} />}
        {step === 2 && <DeployStepGovernance config={governance} onChange={setGovernance} />}
      </DeployWizardShell>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add 3-step deploy wizard for marketplace agents

Configure → Connect → Governance flow with wizard shell,
step indicator, and deploy mutation. Smart governance defaults
included (require approval, spend limits, auto-pause threshold).
EOF
)"
```

---

### Task 5: Task review queue

**Files:**

- Create: `apps/dashboard/src/app/tasks/page.tsx`
- Create: `apps/dashboard/src/components/tasks/task-card.tsx`
- Create: `apps/dashboard/src/components/tasks/task-review-dialog.tsx`

- [ ] **Step 1: Create TaskReviewDialog**

Create `apps/dashboard/src/components/tasks/task-review-dialog.tsx`:

```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface TaskReviewDialogProps {
  open: boolean;
  onClose: () => void;
  action: "approved" | "rejected";
  taskCategory: string;
  isLoading: boolean;
  onConfirm: (reviewResult?: string) => void;
}

export function TaskReviewDialog({
  open,
  onClose,
  action,
  taskCategory,
  isLoading,
  onConfirm,
}: TaskReviewDialogProps) {
  const [feedback, setFeedback] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === "approved" ? "Approve" : "Reject"} this output?
          </DialogTitle>
          <DialogDescription>
            {action === "approved"
              ? `This will improve the agent's trust score for "${taskCategory}" tasks.`
              : `This will lower the agent's trust score for "${taskCategory}" tasks.`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Label htmlFor="feedback" className="text-[13px]">
            Feedback (optional)
          </Label>
          <Textarea
            id="feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={
              action === "approved"
                ? "What was good about this output?"
                : "What needs to improve?"
            }
            className="mt-1.5"
            rows={2}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant={action === "approved" ? "default" : "destructive"}
            onClick={() => {
              onConfirm(feedback || undefined);
              setFeedback("");
            }}
            disabled={isLoading}
          >
            {isLoading
              ? "Submitting..."
              : action === "approved"
                ? "Approve"
                : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create TaskCard**

Create `apps/dashboard/src/components/tasks/task-card.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { MarketplaceTask } from "@/lib/api-client";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-caution/10 text-caution",
  awaiting_review: "bg-agent-attention/10 text-agent-attention",
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

interface TaskCardProps {
  task: MarketplaceTask;
  onApprove?: (task: MarketplaceTask) => void;
  onReject?: (task: MarketplaceTask) => void;
}

export function TaskCard({ task, onApprove, onReject }: TaskCardProps) {
  const isReviewable = task.status === "awaiting_review" && task.output;

  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] text-foreground font-medium capitalize">
            {task.category} task
          </p>
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

      {/* Input summary */}
      {task.input && Object.keys(task.input).length > 0 && (
        <div>
          <p className="section-label mb-1">Input</p>
          <p className="text-[13px] text-muted-foreground line-clamp-2">
            {typeof task.input === "object"
              ? JSON.stringify(task.input).slice(0, 200)
              : String(task.input)}
          </p>
        </div>
      )}

      {/* Output preview */}
      {task.output && (
        <div>
          <p className="section-label mb-1">Output</p>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-[13px] text-foreground whitespace-pre-wrap line-clamp-4">
              {typeof task.output === "object"
                ? JSON.stringify(task.output, null, 2).slice(0, 300)
                : String(task.output)}
            </p>
          </div>
        </div>
      )}

      {/* Acceptance criteria */}
      {task.acceptanceCriteria && (
        <p className="text-[12px] text-muted-foreground italic">
          Criteria: {task.acceptanceCriteria}
        </p>
      )}

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

- [ ] **Step 3: Create tasks page**

Create `apps/dashboard/src/app/tasks/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useTasks, useReviewTask } from "@/hooks/use-marketplace";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskReviewDialog } from "@/components/tasks/task-review-dialog";
import { cn } from "@/lib/utils";
import type { MarketplaceTask } from "@/lib/api-client";

export default function TasksPage() {
  const { status } = useSession();
  const { data, isLoading } = useTasks();
  const reviewMutation = useReviewTask();
  const { toast } = useToast();

  const [tab, setTab] = useState<"review" | "all">("review");
  const [dialog, setDialog] = useState<{
    open: boolean;
    action: "approved" | "rejected";
    task: MarketplaceTask;
  } | null>(null);

  if (status === "unauthenticated") redirect("/login");

  const tasks = data?.tasks ?? [];
  const reviewable = tasks.filter((t) => t.status === "awaiting_review" && t.output);
  const displayed = tab === "review" ? reviewable : tasks;

  const handleReview = async (result: "approved" | "rejected", reviewResult?: string) => {
    if (!dialog) return;
    try {
      await reviewMutation.mutateAsync({
        taskId: dialog.task.id,
        result,
        reviewResult,
      });
      toast({
        title: result === "approved" ? "Approved" : "Rejected",
        description:
          result === "approved"
            ? "Trust score updated. Agent earns more autonomy."
            : "Trust score updated. Agent requires more oversight.",
      });
      setDialog(null);
    } catch (err) {
      toast({
        title: "Review failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Tasks</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Review agent outputs. Your decisions shape their trust scores.
        </p>
      </section>

      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-border/60">
        {(
          [
            {
              key: "review" as const,
              label: `Review${reviewable.length > 0 ? ` · ${reviewable.length}` : ""}`,
            },
            { key: "all" as const, label: "All tasks" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast",
              tab === t.key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Task list */}
      {status === "loading" || isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[15px] text-foreground font-medium">
            {tab === "review" ? "Nothing to review." : "No tasks yet."}
          </p>
          <p className="text-[14px] text-muted-foreground mt-1.5">
            {tab === "review"
              ? "Agent outputs will appear here when they need your approval."
              : "Deploy an agent from the marketplace to start assigning tasks."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayed.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onApprove={(t) =>
                setDialog({ open: true, action: "approved", task: t })
              }
              onReject={(t) =>
                setDialog({ open: true, action: "rejected", task: t })
              }
            />
          ))}
        </div>
      )}

      {/* Review dialog */}
      {dialog && (
        <TaskReviewDialog
          open={dialog.open}
          onClose={() => setDialog(null)}
          action={dialog.action}
          taskCategory={dialog.task.category}
          isLoading={reviewMutation.isPending}
          onConfirm={(reviewResult) => handleReview(dialog.action, reviewResult)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add task review queue with approve/reject flow

Tasks page with review/all tabs, task cards showing input/output
preview, and review dialog with optional feedback. Trust scores
update on approve/reject.
EOF
)"
```

---

### Task 6: Navigation updates

**Files:**

- Modify: `apps/dashboard/src/components/layout/owner-tabs.tsx`
- Modify: `apps/dashboard/src/components/layout/staff-nav.tsx`

- [ ] **Step 1: Update OwnerTabs**

In `apps/dashboard/src/components/layout/owner-tabs.tsx`, update the `TABS` array and add the `Store` icon import:

Change the import line to add `Store`:

```typescript
import { Home, ShieldCheck, User, Store } from "lucide-react";
```

Update the TABS array to add "Hire" between "Today" and "Decide":

```typescript
const TABS = [
  { href: "/", label: "Today", icon: Home },
  { href: "/marketplace", label: "Hire", icon: Store },
  { href: "/decide", label: "Decide", icon: ShieldCheck },
  { href: "/me", label: "Me", icon: User },
] as const;
```

The existing tab link uses `w-1/4` — update to `w-1/5` since there are now 5 tabs.

Read the file before editing to confirm the exact current state.

- [ ] **Step 2: Update StaffNav**

In `apps/dashboard/src/components/layout/staff-nav.tsx`, update the `NAV` array to add "Marketplace" and "Tasks":

```typescript
const NAV = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/tasks", label: "Tasks" },
  { href: "/decide", label: "Decide" },
] as const;
```

Read the file before editing to confirm the exact current state.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: add marketplace and tasks to navigation

OwnerTabs: add "Hire" tab with Store icon.
StaffNav: add "Marketplace" and "Tasks" nav items.
EOF
)"
```

---

### Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck
```

Expected: PASS (modulo known pre-existing errors)

- [ ] **Step 2: Run lint**

```bash
npx pnpm@9.15.4 --filter @switchboard/dashboard lint
```

Expected: PASS

- [ ] **Step 3: Verify all pages render**

Start the dev server and manually verify:

1. `/marketplace` — shows grid of listing cards (or empty state)
2. `/marketplace/[id]` — shows agent detail with trust score
3. `/marketplace/[id]/deploy` — 3-step deploy wizard
4. `/tasks` — task review queue with tabs
5. Navigation tabs updated in both Owner and Staff views

```bash
npx pnpm@9.15.4 --filter @switchboard/dashboard dev
```

- [ ] **Step 4: Commit any fixes**

If any issues are found, fix and commit.

---

## Summary

| What           | Count                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| New files      | 18 (8 proxy routes, 1 hooks, 4 pages, 8 components)                                                    |
| Modified files | 3 (query-keys + api-client, owner-tabs, staff-nav)                                                     |
| Pages          | 4 (marketplace browse, agent detail, deploy wizard, tasks)                                             |
| Components     | 8 (listing card, trust badge, category filter, wizard shell, 3 deploy steps, task card, review dialog) |

### User flow after implementation:

```
Founder opens Dashboard
  → Clicks "Hire" / "Marketplace" in nav
  → Browses agent listings (grid with filters)
  → Clicks agent card → sees detail page with trust score
  → Clicks "Deploy" → 3-step wizard:
    1. Configure input (task description, criteria, format)
    2. Connect tools (Gmail, Slack, Notion, Sheets)
    3. Set governance (approval rules, spend limits, auto-pause)
  → Agent deployed to workspace
  → Agent produces output → appears in Tasks queue
  → Founder reviews → Approve/Reject
    → Trust score updates → autonomy level adjusts
```
