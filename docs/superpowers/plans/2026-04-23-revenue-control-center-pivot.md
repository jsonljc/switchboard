# Revenue Control Center Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the marketplace product surface with a module-based revenue control center on the authenticated dashboard, without changing any backend data models.

**Architecture:** The dashboard home (`/dashboard`) gains a module status layer above existing operational content. A new server-side `ModuleStateResolver` computes deterministic status for three modules (Creative, Ad Optimizer, Lead-to-Booking) from existing deployment/connection/config data. New `/modules/[module]` routes replace marketplace browse/deploy flows. Marketplace routes are deleted outright.

**Tech Stack:** Next.js 14 (App Router), React, TanStack React Query, Tailwind CSS, shadcn/ui components, TypeScript. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-23-revenue-control-center-pivot-design.md`

---

## File Structure

### New files

| File                                                                   | Responsibility                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/module-state-resolver.ts`                      | Server-side state resolution: deployment + connection + config → `ModuleStatus[]`. Shared by status API and setup flow. |
| `apps/dashboard/src/lib/module-types.ts`                               | `ModuleId`, `ModuleState`, `ModuleStatus` type definitions                                                              |
| `apps/dashboard/src/app/api/dashboard/modules/status/route.ts`         | `GET` handler — calls `ModuleStateResolver`, returns `ModuleStatus[]`                                                   |
| `apps/dashboard/src/hooks/use-module-status.ts`                        | React Query hook wrapping the status endpoint                                                                           |
| `apps/dashboard/src/components/dashboard/module-card.tsx`              | Single module card component (badge, subtext, CTA, clickable surface)                                                   |
| `apps/dashboard/src/components/dashboard/module-cards.tsx`             | Grid of three `ModuleCard` instances                                                                                    |
| `apps/dashboard/src/components/dashboard/recommendation-bar.tsx`       | Single recommendation with priority logic                                                                               |
| `apps/dashboard/src/components/dashboard/synergy-strip.tsx`            | Three loop-closure indicators                                                                                           |
| `apps/dashboard/src/app/(auth)/modules/[module]/page.tsx`              | Module detail page (server component, resolves deployment)                                                              |
| `apps/dashboard/src/components/modules/module-detail.tsx`              | Client component shell for module detail                                                                                |
| `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`        | Module setup wizard page                                                                                                |
| `apps/dashboard/src/components/modules/module-setup-wizard.tsx`        | Setup wizard shell with step routing                                                                                    |
| `apps/dashboard/src/components/modules/convert-leads-setup.tsx`        | Convert Leads step components                                                                                           |
| `apps/dashboard/src/components/modules/create-ads-setup.tsx`           | Create Ads step components                                                                                              |
| `apps/dashboard/src/components/modules/improve-spend-setup.tsx`        | Improve Spend step components                                                                                           |
| `apps/dashboard/src/app/(auth)/modules/[module]/traces/page.tsx`       | Traces page (thin redirect wrapper)                                                                                     |
| `apps/dashboard/src/app/(auth)/modules/creative/jobs/[jobId]/page.tsx` | Creative job detail (thin redirect wrapper)                                                                             |

### Modified files

| File                                                      | Change                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/dashboard/src/components/layout/owner-tabs.tsx`     | Remove "Hire" tab, rename "Today" → "Home"                                   |
| `apps/dashboard/src/components/dashboard/owner-today.tsx` | Add module cards + recommendation bar + synergy strip above existing content |
| `apps/dashboard/src/lib/query-keys.ts`                    | Add `modules` namespace                                                      |
| `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx` | Replace with redirect to `/modules/[resolved]`                               |

### Deleted files

| File                                                                      | Reason                                  |
| ------------------------------------------------------------------------- | --------------------------------------- |
| `apps/dashboard/src/app/(auth)/marketplace/page.tsx`                      | Marketplace browse removed              |
| `apps/dashboard/src/app/(auth)/marketplace/[id]/page.tsx`                 | Marketplace detail removed              |
| `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`                    | Replaced by `/modules/[module]/setup`   |
| `apps/dashboard/src/components/marketplace/public-marketplace-browse.tsx` | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/listing-card.tsx`              | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/category-filter.tsx`           | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/storefront-page.tsx`           | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/install-instructions.tsx`      | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`       | Replaced by module setup wizard         |
| `apps/dashboard/src/components/marketplace/connection-step.tsx`           | Replaced by module-specific setup steps |
| `apps/dashboard/src/components/marketplace/dynamic-setup-form.tsx`        | Replaced by module-specific setup steps |
| `apps/dashboard/src/components/marketplace/scan-step.tsx`                 | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/review-persona-step.tsx`       | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/deploy-persona-form.tsx`       | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/deploy-persona-form.test.tsx`  | Test for deleted file                   |
| `apps/dashboard/src/components/marketplace/website-scan-review.tsx`       | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/agent-profile-header.tsx`      | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/business-facts-form.tsx`       | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/test-chat-step.tsx`            | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/telegram-setup-modal.tsx`      | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/widget-setup-modal.tsx`        | Marketplace-only, no reuse              |
| `apps/dashboard/src/components/marketplace/trust-bar.tsx`                 | Marketplace-only, no reuse              |

### Kept in `components/marketplace/` (repurposed by module detail)

| File                          | Reused by                                    |
| ----------------------------- | -------------------------------------------- |
| `channels-section.tsx`        | Module detail — connection health            |
| `trust-score-badge.tsx`       | Module detail — execution history badge      |
| `trust-history-chart.tsx`     | Module detail — execution history chart      |
| `work-log-list.tsx`           | Module detail — activity feed                |
| `faq-review-queue.tsx`        | Module detail — Convert Leads secondary view |
| `conversation-transcript.tsx` | Module detail — traces                       |
| `__tests__/`                  | Keep tests for kept components               |

---

## Task Sequence

### Task 1: Module Types & State Resolver

**Files:**

- Create: `apps/dashboard/src/lib/module-types.ts`
- Create: `apps/dashboard/src/lib/module-state-resolver.ts`
- Create: `apps/dashboard/src/lib/__tests__/module-state-resolver.test.ts`

- [ ] **Step 1: Write module type definitions**

Create `apps/dashboard/src/lib/module-types.ts`:

```typescript
export const MODULE_IDS = ["lead-to-booking", "creative", "ad-optimizer"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleState =
  | "not_setup"
  | "needs_connection"
  | "partial_setup"
  | "connection_broken"
  | "live";

export interface ModuleStatus {
  id: ModuleId;
  state: ModuleState;
  label: string;
  subtext: string;
  metric?: string;
  cta: { label: string; href: string };
  setupProgress?: { done: number; total: number };
  isPlatformBlocking?: boolean;
  lastUpdated: string;
}

export const MODULE_LABELS: Record<ModuleId, string> = {
  "lead-to-booking": "Convert Leads",
  creative: "Create Ads",
  "ad-optimizer": "Improve Spend",
};

export const STATE_PRIORITY: ModuleState[] = [
  "connection_broken",
  "needs_connection",
  "partial_setup",
  "not_setup",
  "live",
];
```

- [ ] **Step 2: Write failing tests for state resolver**

Create `apps/dashboard/src/lib/__tests__/module-state-resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveModuleStatuses } from "../module-state-resolver";
import type { ResolverInput } from "../module-state-resolver";

function makeInput(overrides: Partial<ResolverInput> = {}): ResolverInput {
  return {
    deployments: [],
    connections: [],
    orgConfig: { businessHours: null },
    creativeJobCount: 0,
    auditCount: 0,
    platformConfig: { hasAnthropicKey: true },
    ...overrides,
  };
}

describe("resolveModuleStatuses", () => {
  it("returns not_setup for all modules when no deployments exist", () => {
    const result = resolveModuleStatuses(makeInput());
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("lead-to-booking");
    expect(result[0].state).toBe("not_setup");
    expect(result[0].cta.label).toBe("Enable");
    expect(result[1].id).toBe("creative");
    expect(result[1].state).toBe("not_setup");
    expect(result[2].id).toBe("ad-optimizer");
    expect(result[2].state).toBe("not_setup");
  });

  it("returns live for lead-to-booking when calendar + business hours + active", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          { id: "d1", moduleType: "lead-to-booking", status: "active", inputConfig: {} },
        ],
        connections: [{ deploymentId: "d1", type: "google_calendar", status: "active" }],
        orgConfig: {
          businessHours: {
            timezone: "Asia/Singapore",
            days: [{ day: 1, open: "09:00", close: "17:00" }],
          },
        },
      }),
    );
    expect(result[0].state).toBe("live");
    expect(result[0].metric).toBeDefined();
  });

  it("returns connection_broken when calendar connection is expired", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          { id: "d1", moduleType: "lead-to-booking", status: "active", inputConfig: {} },
        ],
        connections: [{ deploymentId: "d1", type: "google_calendar", status: "expired" }],
        orgConfig: {
          businessHours: {
            timezone: "Asia/Singapore",
            days: [{ day: 1, open: "09:00", close: "17:00" }],
          },
        },
      }),
    );
    expect(result[0].state).toBe("connection_broken");
    expect(result[0].cta.label).toBe("Fix");
  });

  it("returns needs_connection for creative when platform key missing", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d2", moduleType: "creative", status: "active", inputConfig: {} }],
        platformConfig: { hasAnthropicKey: false },
      }),
    );
    expect(result[1].state).toBe("needs_connection");
    expect(result[1].isPlatformBlocking).toBe(true);
  });

  it("returns partial_setup for creative when no jobs submitted", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d2", moduleType: "creative", status: "active", inputConfig: {} }],
        creativeJobCount: 0,
      }),
    );
    expect(result[1].state).toBe("partial_setup");
  });

  it("returns live for creative when deployment active and jobs exist", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d2", moduleType: "creative", status: "active", inputConfig: {} }],
        creativeJobCount: 3,
      }),
    );
    expect(result[1].state).toBe("live");
  });

  it("returns needs_connection for ad-optimizer when no credentials", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d3", moduleType: "ad-optimizer", status: "active", inputConfig: {} }],
        connections: [],
      }),
    );
    expect(result[2].state).toBe("needs_connection");
  });

  it("returns partial_setup for ad-optimizer when token exists but no accountId", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d3", moduleType: "ad-optimizer", status: "active", inputConfig: {} }],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "active" }],
      }),
    );
    expect(result[2].state).toBe("partial_setup");
  });

  it("returns connection_broken for ad-optimizer when token expired", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d3",
            moduleType: "ad-optimizer",
            status: "active",
            inputConfig: { accountId: "act_123", targetCPA: 100 },
          },
        ],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "expired" }],
        auditCount: 1,
      }),
    );
    expect(result[2].state).toBe("connection_broken");
  });

  it("connection_broken overrides live state", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d3",
            moduleType: "ad-optimizer",
            status: "active",
            inputConfig: { accountId: "act_123", targetCPA: 100, targetROAS: 3 },
          },
        ],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "revoked" }],
        auditCount: 5,
      }),
    );
    expect(result[2].state).toBe("connection_broken");
  });

  it("metric is only populated when state is live", () => {
    const result = resolveModuleStatuses(makeInput());
    for (const mod of result) {
      if (mod.state !== "live") {
        expect(mod.metric).toBeUndefined();
      }
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/module-state-resolver.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the state resolver**

Create `apps/dashboard/src/lib/module-state-resolver.ts`:

```typescript
import type { ModuleId, ModuleState, ModuleStatus } from "./module-types";
import { MODULE_IDS, MODULE_LABELS } from "./module-types";

export interface DeploymentRecord {
  id: string;
  moduleType: string;
  status: string;
  inputConfig: Record<string, unknown>;
}

export interface ConnectionRecord {
  deploymentId: string;
  type: string;
  status: string;
}

export interface ResolverInput {
  deployments: DeploymentRecord[];
  connections: ConnectionRecord[];
  orgConfig: {
    businessHours: {
      timezone: string;
      days: Array<{ day: number; open: string; close: string }>;
    } | null;
  };
  creativeJobCount: number;
  auditCount: number;
  platformConfig: { hasAnthropicKey: boolean };
}

interface CTA {
  label: string;
  href: string;
}

const CTA_MAP: Record<ModuleState, string> = {
  connection_broken: "Fix",
  needs_connection: "Connect",
  partial_setup: "Continue",
  not_setup: "Enable",
  live: "View",
};

function resolveLeadToBooking(
  deployment: DeploymentRecord | undefined,
  connections: ConnectionRecord[],
  orgConfig: ResolverInput["orgConfig"],
): {
  state: ModuleState;
  subtext: string;
  isPlatformBlocking?: boolean;
  setupProgress?: { done: number; total: number };
} {
  if (!deployment) {
    return { state: "not_setup", subtext: "Enable to start converting leads" };
  }

  const calendarConn = connections.find(
    (c) => c.deploymentId === deployment.id && c.type === "google_calendar",
  );

  if (calendarConn && (calendarConn.status === "expired" || calendarConn.status === "revoked")) {
    return {
      state: "connection_broken",
      subtext: "Calendar connection expired",
      setupProgress: { done: 2, total: 3 },
    };
  }

  const needsGoogleCalendar = !calendarConn;
  if (needsGoogleCalendar && deployment.status === "active") {
    // Local scheduling mode — no Google connection needed, check business hours
  } else if (needsGoogleCalendar) {
    return {
      state: "needs_connection",
      subtext: "Calendar connection required",
      setupProgress: { done: 0, total: 3 },
    };
  }

  if (!orgConfig.businessHours) {
    return {
      state: "partial_setup",
      subtext: "Business hours not configured",
      setupProgress: { done: calendarConn ? 2 : 1, total: 3 },
    };
  }

  return { state: "live", subtext: "" };
}

function resolveCreative(
  deployment: DeploymentRecord | undefined,
  platformConfig: ResolverInput["platformConfig"],
  jobCount: number,
): {
  state: ModuleState;
  subtext: string;
  isPlatformBlocking?: boolean;
  setupProgress?: { done: number; total: number };
} {
  if (!deployment) {
    return { state: "not_setup", subtext: "Enable to generate ad creative" };
  }

  if (!platformConfig.hasAnthropicKey) {
    return {
      state: "needs_connection",
      subtext: "Platform configuration required",
      isPlatformBlocking: true,
      setupProgress: { done: 0, total: 2 },
    };
  }

  if (jobCount === 0) {
    return {
      state: "partial_setup",
      subtext: "No creative jobs submitted yet",
      setupProgress: { done: 1, total: 2 },
    };
  }

  return { state: "live", subtext: "" };
}

function resolveAdOptimizer(
  deployment: DeploymentRecord | undefined,
  connections: ConnectionRecord[],
  auditCount: number,
): {
  state: ModuleState;
  subtext: string;
  isPlatformBlocking?: boolean;
  setupProgress?: { done: number; total: number };
} {
  if (!deployment) {
    return { state: "not_setup", subtext: "Connect Meta Ads to optimize spend" };
  }

  const metaConn = connections.find(
    (c) => c.deploymentId === deployment.id && c.type === "meta_ads",
  );

  if (metaConn && (metaConn.status === "expired" || metaConn.status === "revoked")) {
    return {
      state: "connection_broken",
      subtext: "Meta Ads token expired",
      setupProgress: { done: 3, total: 4 },
    };
  }

  if (!metaConn) {
    return {
      state: "needs_connection",
      subtext: "Meta Ads account required",
      setupProgress: { done: 0, total: 4 },
    };
  }

  const config = deployment.inputConfig;
  const hasAccountId = Boolean(config.accountId);
  const hasTargets = Boolean(config.targetCPA || config.targetROAS);

  if (!hasAccountId || !hasTargets) {
    return {
      state: "partial_setup",
      subtext: !hasAccountId ? "Select an ad account" : "Set optimization targets",
      setupProgress: { done: hasAccountId ? 2 : 1, total: 4 },
    };
  }

  if (auditCount === 0) {
    return {
      state: "partial_setup",
      subtext: "Waiting for first audit",
      setupProgress: { done: 3, total: 4 },
    };
  }

  return { state: "live", subtext: "" };
}

function buildCta(moduleId: ModuleId, state: ModuleState): CTA {
  const label = CTA_MAP[state];
  if (state === "live") return { label, href: `/modules/${moduleId}` };
  if (state === "not_setup") return { label, href: `/modules/${moduleId}/setup` };

  const stepMap: Record<ModuleId, string> = {
    "lead-to-booking": "connect-calendar",
    creative: "enable",
    "ad-optimizer": "connect-meta",
  };

  if (state === "connection_broken" || state === "needs_connection") {
    return { label, href: `/modules/${moduleId}/setup?step=${stepMap[moduleId]}` };
  }

  return { label, href: `/modules/${moduleId}/setup` };
}

function getLiveMetric(moduleId: ModuleId, input: ResolverInput): string | undefined {
  switch (moduleId) {
    case "lead-to-booking":
      return "Booking pipeline active";
    case "creative":
      return `${input.creativeJobCount} job${input.creativeJobCount === 1 ? "" : "s"} completed`;
    case "ad-optimizer":
      return `${input.auditCount} audit${input.auditCount === 1 ? "" : "s"} completed`;
    default:
      return undefined;
  }
}

export function resolveModuleStatuses(input: ResolverInput): ModuleStatus[] {
  const now = new Date().toISOString();
  const deploymentsByType = new Map<string, DeploymentRecord>();
  for (const d of input.deployments) {
    deploymentsByType.set(d.moduleType, d);
  }

  const resolvers: Array<{
    id: ModuleId;
    resolve: () => {
      state: ModuleState;
      subtext: string;
      isPlatformBlocking?: boolean;
      setupProgress?: { done: number; total: number };
    };
  }> = [
    {
      id: "lead-to-booking",
      resolve: () =>
        resolveLeadToBooking(
          deploymentsByType.get("lead-to-booking"),
          input.connections,
          input.orgConfig,
        ),
    },
    {
      id: "creative",
      resolve: () =>
        resolveCreative(
          deploymentsByType.get("creative"),
          input.platformConfig,
          input.creativeJobCount,
        ),
    },
    {
      id: "ad-optimizer",
      resolve: () =>
        resolveAdOptimizer(
          deploymentsByType.get("ad-optimizer"),
          input.connections,
          input.auditCount,
        ),
    },
  ];

  return resolvers.map(({ id, resolve }) => {
    const { state, subtext, isPlatformBlocking, setupProgress } = resolve();
    const isLive = state === "live";
    return {
      id,
      state,
      label: MODULE_LABELS[id],
      subtext: isLive ? (getLiveMetric(id, input) ?? "Active") : subtext,
      metric: isLive ? getLiveMetric(id, input) : undefined,
      cta: buildCta(id, state),
      setupProgress,
      isPlatformBlocking,
      lastUpdated: now,
    };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/module-state-resolver.test.ts`

Expected: All 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add ModuleStateResolver for revenue control center

Deterministic state resolution for three revenue modules (Convert Leads,
Create Ads, Improve Spend) from existing deployment/connection/config data.
Shared resolver used by both status API and setup flow routing.
EOF
)"
```

---

### Task 2: Module Status API Endpoint

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/app/api/dashboard/modules/status/route.ts`
- Create: `apps/dashboard/src/hooks/use-module-status.ts`

- [ ] **Step 1: Add modules namespace to query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add a `modules` namespace alongside the existing ones:

```typescript
modules: {
  all: ["modules"] as const,
  status: () => [...queryKeys.modules.all, "status"] as const,
},
```

- [ ] **Step 2: Create the API route handler**

Create `apps/dashboard/src/app/api/dashboard/modules/status/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { getApiClient } from "@/lib/get-api-client";
import { resolveModuleStatuses } from "@/lib/module-state-resolver";
import type { ResolverInput } from "@/lib/module-state-resolver";

export async function GET() {
  try {
    await requireDashboardSession();
    const client = await getApiClient();

    const [deploymentsResult, connectionsResult, orgConfigResult] = await Promise.all([
      client.listDeployments(),
      client.listConnections().catch(() => ({ connections: [] })),
      client.getOrgConfig().catch(() => ({ config: { businessHours: null } })),
    ]);

    const deployments = deploymentsResult.deployments.map((d) => ({
      id: d.id,
      moduleType: (d.listingId ?? d.id) as string,
      status: d.status,
      inputConfig: (d.inputConfig as Record<string, unknown>) ?? {},
    }));

    const connections = (connectionsResult.connections ?? []).map((c) => ({
      deploymentId: c.deploymentId,
      type: c.type,
      status: c.status,
    }));

    const input: ResolverInput = {
      deployments,
      connections,
      orgConfig: {
        businessHours: orgConfigResult.config?.businessHours ?? null,
      },
      creativeJobCount: 0,
      auditCount: 0,
      platformConfig: {
        hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      },
    };

    const statuses = resolveModuleStatuses(input);
    return NextResponse.json({ modules: statuses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

Note: The `moduleType` mapping from `listingId` to canonical module IDs will need adjustment during implementation based on how listings are typed in the actual DB. The resolver matches on `moduleType` field. Check how the existing deployment's listing relates to module type and adjust the mapping accordingly.

- [ ] **Step 3: Create the React Query hook**

Create `apps/dashboard/src/hooks/use-module-status.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ModuleStatus } from "@/lib/module-types";

export function useModuleStatus() {
  return useQuery({
    queryKey: queryKeys.modules.status(),
    queryFn: async () => {
      const res = await fetch("/api/dashboard/modules/status");
      if (!res.ok) throw new Error("Failed to fetch module status");
      const data = await res.json();
      return data.modules as ModuleStatus[];
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No type errors in new files.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add module status API endpoint and React Query hook

GET /api/dashboard/modules/status returns deterministic status for all
three revenue modules. Uses shared ModuleStateResolver.
EOF
)"
```

---

### Task 3: Module Card Components

**Files:**

- Create: `apps/dashboard/src/components/dashboard/module-card.tsx`
- Create: `apps/dashboard/src/components/dashboard/module-cards.tsx`

- [ ] **Step 1: Create the individual module card component**

Create `apps/dashboard/src/components/dashboard/module-card.tsx`:

```typescript
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ModuleStatus, ModuleState } from "@/lib/module-types";

const STATE_BADGE: Record<ModuleState, { text: string; className: string }> = {
  connection_broken: {
    text: "Attention needed",
    className: "bg-destructive/10 text-destructive",
  },
  needs_connection: {
    text: "Needs connection",
    className: "bg-caution/10 text-caution-foreground",
  },
  partial_setup: {
    text: "Continue setup",
    className: "bg-caution/10 text-caution-foreground",
  },
  not_setup: {
    text: "Not set up",
    className: "bg-muted text-muted-foreground",
  },
  live: {
    text: "Live",
    className: "bg-success/10 text-success",
  },
};

interface ModuleCardProps {
  module: ModuleStatus;
}

export function ModuleCard({ module }: ModuleCardProps) {
  const badge = STATE_BADGE[module.state];
  const href = module.cta.href;
  const isDisabled = module.isPlatformBlocking;

  return (
    <Link
      href={isDisabled ? "#" : href}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-5 transition-all duration-200",
        !isDisabled && "hover:border-foreground/20 hover:shadow-sm",
        isDisabled && "opacity-60 cursor-not-allowed",
      )}
      onClick={isDisabled ? (e) => e.preventDefault() : undefined}
    >
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {module.label}
        </h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badge.className)}>
          {badge.text}
        </span>
      </div>

      <p className="text-sm text-muted-foreground leading-snug">{module.subtext}</p>

      {module.setupProgress && module.state !== "live" && (
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-foreground/30 transition-all"
            style={{ width: `${(module.setupProgress.done / module.setupProgress.total) * 100}%` }}
          />
        </div>
      )}

      <div className="mt-auto pt-1">
        <span
          className={cn(
            "inline-flex items-center text-xs font-medium transition-colors",
            module.state === "connection_broken"
              ? "text-destructive"
              : module.state === "live"
                ? "text-muted-foreground group-hover:text-foreground"
                : "text-foreground",
          )}
        >
          {isDisabled ? "Contact administrator" : module.cta.label}
          {!isDisabled && <span className="ml-1 transition-transform group-hover:translate-x-0.5">→</span>}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create the module cards grid**

Create `apps/dashboard/src/components/dashboard/module-cards.tsx`:

```typescript
"use client";

import { ModuleCard } from "./module-card";
import type { ModuleStatus } from "@/lib/module-types";

interface ModuleCardsProps {
  modules: ModuleStatus[];
}

export function ModuleCards({ modules }: ModuleCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {modules.map((mod) => (
        <ModuleCard key={mod.id} module={mod} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add ModuleCard and ModuleCards grid components

Individual module card with status badge, subtext, progress bar, and
CTA. Entire card is clickable. Disabled state for platform-blocking.
EOF
)"
```

---

### Task 4: Recommendation Bar & Synergy Strip

**Files:**

- Create: `apps/dashboard/src/components/dashboard/recommendation-bar.tsx`
- Create: `apps/dashboard/src/components/dashboard/synergy-strip.tsx`
- Create: `apps/dashboard/src/lib/__tests__/recommendation-logic.test.ts`

- [ ] **Step 1: Write failing tests for recommendation logic**

Create `apps/dashboard/src/lib/__tests__/recommendation-logic.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pickRecommendation } from "../recommendation-logic";
import type { ModuleStatus } from "../module-types";

function makeStatus(id: string, state: string): ModuleStatus {
  return {
    id: id as ModuleStatus["id"],
    state: state as ModuleStatus["state"],
    label: id,
    subtext: "",
    cta: { label: "", href: "" },
    lastUpdated: new Date().toISOString(),
  };
}

describe("pickRecommendation", () => {
  it("prioritizes connection_broken over everything", () => {
    const modules = [
      makeStatus("lead-to-booking", "live"),
      makeStatus("creative", "connection_broken"),
      makeStatus("ad-optimizer", "not_setup"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.moduleId).toBe("creative");
    expect(rec.type).toBe("fix");
  });

  it("suggests closing a loop when neighbor is live", () => {
    const modules = [
      makeStatus("lead-to-booking", "live"),
      makeStatus("creative", "not_setup"),
      makeStatus("ad-optimizer", "not_setup"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.moduleId).toBe("ad-optimizer");
  });

  it("defaults to lead-to-booking when nothing is live", () => {
    const modules = [
      makeStatus("lead-to-booking", "not_setup"),
      makeStatus("creative", "not_setup"),
      makeStatus("ad-optimizer", "not_setup"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.moduleId).toBe("lead-to-booking");
  });

  it("returns all-live message when everything is live", () => {
    const modules = [
      makeStatus("lead-to-booking", "live"),
      makeStatus("creative", "live"),
      makeStatus("ad-optimizer", "live"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.type).toBe("all_live");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/recommendation-logic.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement recommendation logic**

Create `apps/dashboard/src/lib/recommendation-logic.ts`:

```typescript
import type { ModuleId, ModuleStatus, ModuleState } from "./module-types";
import { STATE_PRIORITY } from "./module-types";

export interface Recommendation {
  moduleId: ModuleId | null;
  type: "fix" | "connect" | "continue" | "enable" | "all_live";
  message: string;
  href: string;
}

const SYNERGY_NEIGHBORS: Record<ModuleId, ModuleId[]> = {
  "lead-to-booking": ["ad-optimizer"],
  creative: ["ad-optimizer"],
  "ad-optimizer": ["creative", "lead-to-booking"],
};

const FIX_MESSAGES: Record<ModuleId, string> = {
  "lead-to-booking": "Fix calendar connection to restore lead conversion",
  creative: "Fix Creative connection to restore ad generation",
  "ad-optimizer": "Fix Meta Ads connection to restore spend optimization",
};

const ENABLE_MESSAGES: Record<string, string> = {
  "creative+ad-optimizer": "Activate Improve Spend to close the learning loop",
  "ad-optimizer+creative": "Add Create Ads to generate testable variants",
  "lead-to-booking+ad-optimizer": "Activate Improve Spend for closed-loop attribution",
  default: "Start with Convert Leads to capture and book revenue",
};

function stateRank(state: ModuleState): number {
  return STATE_PRIORITY.indexOf(state);
}

export function pickRecommendation(modules: ModuleStatus[]): Recommendation {
  const byId = new Map(modules.map((m) => [m.id, m]));

  const broken = modules.filter((m) => m.state === "connection_broken");
  if (broken.length > 0) {
    const target = broken[0];
    return {
      moduleId: target.id,
      type: "fix",
      message: FIX_MESSAGES[target.id],
      href: target.cta.href,
    };
  }

  const needsConn = modules.filter((m) => m.state === "needs_connection");
  if (needsConn.length > 0) {
    const target = needsConn[0];
    return {
      moduleId: target.id,
      type: "connect",
      message: `Connect to activate ${target.label}`,
      href: target.cta.href,
    };
  }

  const partial = modules.filter((m) => m.state === "partial_setup");
  if (partial.length > 0) {
    const target = partial[0];
    return {
      moduleId: target.id,
      type: "continue",
      message: `Finish setting up ${target.label} — ${target.subtext.toLowerCase()}`,
      href: target.cta.href,
    };
  }

  const notSetup = modules.filter((m) => m.state === "not_setup");
  if (notSetup.length > 0) {
    const liveModules = modules.filter((m) => m.state === "live");
    const liveIds = new Set(liveModules.map((m) => m.id));

    // Prefer module that closes a loop with a live neighbor
    const closesLoop = notSetup.find((m) => SYNERGY_NEIGHBORS[m.id]?.some((n) => liveIds.has(n)));

    if (closesLoop) {
      const liveNeighbor = liveModules.find((lm) =>
        SYNERGY_NEIGHBORS[closesLoop.id]?.includes(lm.id),
      );
      const key = `${liveNeighbor?.id}+${closesLoop.id}`;
      return {
        moduleId: closesLoop.id,
        type: "enable",
        message: ENABLE_MESSAGES[key] ?? `Activate ${closesLoop.label}`,
        href: closesLoop.cta.href,
      };
    }

    // Default: prefer lead-to-booking
    const ltb = notSetup.find((m) => m.id === "lead-to-booking");
    const target = ltb ?? notSetup[0];
    return {
      moduleId: target.id,
      type: "enable",
      message: ENABLE_MESSAGES.default,
      href: target.cta.href,
    };
  }

  return {
    moduleId: null,
    type: "all_live",
    message: "Revenue loop active — all modules operational",
    href: "/dashboard/roi",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard exec vitest run src/lib/__tests__/recommendation-logic.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 5: Create the RecommendationBar component**

Create `apps/dashboard/src/components/dashboard/recommendation-bar.tsx`:

```typescript
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { pickRecommendation } from "@/lib/recommendation-logic";
import type { ModuleStatus } from "@/lib/module-types";

interface RecommendationBarProps {
  modules: ModuleStatus[];
}

export function RecommendationBar({ modules }: RecommendationBarProps) {
  const rec = pickRecommendation(modules);

  const isSuccess = rec.type === "all_live";
  const isError = rec.type === "fix";

  return (
    <Link
      href={rec.href}
      className={cn(
        "flex items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors",
        isSuccess && "bg-success/5 text-success hover:bg-success/10",
        isError && "bg-destructive/5 text-destructive hover:bg-destructive/10",
        !isSuccess && !isError && "bg-muted/50 text-foreground hover:bg-muted",
      )}
    >
      <span>{rec.message}</span>
      <span className="ml-2 shrink-0">→</span>
    </Link>
  );
}
```

- [ ] **Step 6: Create the SynergyStrip component**

Create `apps/dashboard/src/components/dashboard/synergy-strip.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";
import type { ModuleStatus } from "@/lib/module-types";

interface SynergyStripProps {
  modules: ModuleStatus[];
}

interface Loop {
  label: string;
  requires: [string, string] | [string, string, string];
}

const LOOPS: Loop[] = [
  { label: "Top-of-funnel learning", requires: ["creative", "ad-optimizer"] },
  { label: "Closed-loop attribution", requires: ["lead-to-booking", "ad-optimizer"] },
  { label: "Full revenue loop", requires: ["lead-to-booking", "creative", "ad-optimizer"] },
];

export function SynergyStrip({ modules }: SynergyStripProps) {
  const liveIds = new Set(modules.filter((m) => m.state === "live").map((m) => m.id));

  const anyLive = modules.some((m) => m.state === "live");
  if (!anyLive) return null;

  return (
    <div className="flex items-center gap-6 text-xs text-muted-foreground">
      {LOOPS.map((loop) => {
        const active = loop.requires.every((id) => liveIds.has(id));
        return (
          <div key={loop.label} className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                active ? "bg-success" : "bg-muted-foreground/30",
              )}
            />
            <span className={cn(active && "text-foreground")}>{loop.label}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add RecommendationBar and SynergyStrip components

Deterministic recommendation logic with priority ordering and synergy
tie-breaking. Synergy strip shows loop closure state.
EOF
)"
```

---

### Task 5: Integrate Module Layer into Dashboard Home

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`

- [ ] **Step 1: Add module imports and hook to OwnerToday**

At the top of `apps/dashboard/src/components/dashboard/owner-today.tsx`, add these imports after the existing imports:

```typescript
import { useModuleStatus } from "@/hooks/use-module-status";
import { ModuleCards } from "@/components/dashboard/module-cards";
import { RecommendationBar } from "@/components/dashboard/recommendation-bar";
import { SynergyStrip } from "@/components/dashboard/synergy-strip";
```

Inside the `OwnerToday` function, after the existing `useToast()` call, add:

```typescript
const { data: modules } = useModuleStatus();
```

- [ ] **Step 2: Insert module layer above existing content**

In the return JSX, after the `DashboardHeader` `FadeIn` block and the FirstRunBanner block, insert a new section **before** the Wave 2 stat strip:

```typescript
{/* Module Control Center */}
{modules && (
  <FadeIn delay={animate ? 100 : 0} translateY={animate ? 8 : 0}>
    <div style={{ marginTop: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <ModuleCards modules={modules} />
      <RecommendationBar modules={modules} />
      <SynergyStrip modules={modules} />
    </div>
  </FadeIn>
)}
```

- [ ] **Step 3: Remove the "Manage agent →" link from header**

In the header section, remove the `Link` to `/my-agent`:

Replace:

```typescript
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
  <DashboardHeader overview={overview} />
  <Link
    href="/my-agent"
    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
  >
    Manage agent →
  </Link>
</div>
```

With:

```typescript
<DashboardHeader overview={overview} />
```

- [ ] **Step 4: Run dev server and verify visually**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard dev`

Navigate to `http://localhost:3002/dashboard` and verify:

- Three module cards appear above the stat grid
- Recommendation bar shows below cards
- Synergy strip shows when at least one module is live
- Existing operational content (stats, approvals, bookings, funnel, etc.) is preserved below

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: integrate module cards into dashboard home

Revenue control center layer added above existing operational content.
Module cards, recommendation bar, and synergy strip own the first screen.
EOF
)"
```

---

### Task 6: Navigation Changes

**Files:**

- Modify: `apps/dashboard/src/components/layout/owner-tabs.tsx`

- [ ] **Step 1: Update the tab configuration**

In `apps/dashboard/src/components/layout/owner-tabs.tsx`, replace the `TABS` array:

Replace:

```typescript
const TABS = [
  { href: "/dashboard", label: "Today", icon: Home },
  { href: "/marketplace", label: "Hire", icon: Store },
  { href: "/decide", label: "Decide", icon: ShieldCheck },
  { href: "/me", label: "Me", icon: User },
] as const;
```

With:

```typescript
const TABS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/decide", label: "Decide", icon: ShieldCheck },
  { href: "/me", label: "Me", icon: User },
] as const;
```

- [ ] **Step 2: Remove unused Store import**

Remove `Store` from the lucide-react import:

Replace:

```typescript
import { Home, ShieldCheck, Store, User } from "lucide-react";
```

With:

```typescript
import { Home, ShieldCheck, User } from "lucide-react";
```

- [ ] **Step 3: Update tab width**

The tabs now have 3 items instead of 4. Update the width class:

Replace:

```typescript
"flex flex-col items-center justify-center gap-0.5 w-1/4 min-h-[44px] text-[10px] tracking-wide transition-colors duration-fast",
```

With:

```typescript
"flex flex-col items-center justify-center gap-0.5 w-1/3 min-h-[44px] text-[10px] tracking-wide transition-colors duration-fast",
```

- [ ] **Step 4: Run dev server and verify**

Navigate to `http://localhost:3002/dashboard` and verify:

- Bottom tabs show Home / Decide / Me (3 tabs)
- No "Hire" tab visible
- "Home" label on the first tab
- Tabs are evenly spaced

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: update nav — remove Hire tab, rename Today to Home

Bottom tab bar reduced from 4 to 3 tabs. Marketplace entry point removed.
Module activation now lives on the dashboard home.
EOF
)"
```

---

### Task 7: Delete Marketplace Routes & Components

**Files:**

- Delete: `apps/dashboard/src/app/(auth)/marketplace/page.tsx`
- Delete: `apps/dashboard/src/app/(auth)/marketplace/[id]/page.tsx` (and any layout files in the directory)
- Delete: `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx` (and client component)
- Delete: marketplace-only components from `apps/dashboard/src/components/marketplace/`

- [ ] **Step 1: Delete marketplace route pages**

```bash
rm -rf apps/dashboard/src/app/\(auth\)/marketplace/
```

- [ ] **Step 2: Delete deploy wizard route**

```bash
rm -rf apps/dashboard/src/app/\(auth\)/deploy/
```

- [ ] **Step 3: Delete marketplace-only components**

Delete these files (keep the ones reused by module detail — channels-section, trust-score-badge, trust-history-chart, work-log-list, faq-review-queue, conversation-transcript, and the `__tests__/` directory):

```bash
cd apps/dashboard/src/components/marketplace/
rm -f public-marketplace-browse.tsx listing-card.tsx category-filter.tsx \
  storefront-page.tsx install-instructions.tsx deploy-wizard-shell.tsx \
  connection-step.tsx dynamic-setup-form.tsx scan-step.tsx \
  review-persona-step.tsx deploy-persona-form.tsx deploy-persona-form.test.tsx \
  website-scan-review.tsx agent-profile-header.tsx business-facts-form.tsx \
  test-chat-step.tsx telegram-setup-modal.tsx widget-setup-modal.tsx trust-bar.tsx
```

- [ ] **Step 4: Verify no broken imports**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No errors from deleted files. If there are import errors from files that imported deleted components (e.g., barrel files), fix those imports.

- [ ] **Step 5: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test`

Expected: Tests pass. Any tests for deleted components should have been removed in step 3.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove marketplace routes and marketplace-only components

Delete /marketplace, /marketplace/[id], and /deploy/[slug] routes.
Remove 17 marketplace-only components. Kept 6 components reused by
module detail (channels-section, trust-score-badge, etc.).
EOF
)"
```

---

### Task 8: Module Detail Page

**Files:**

- Create: `apps/dashboard/src/app/(auth)/modules/[module]/page.tsx`
- Create: `apps/dashboard/src/components/modules/module-detail.tsx`

- [ ] **Step 1: Create the module detail server page**

Create `apps/dashboard/src/app/(auth)/modules/[module]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { getApiClient } from "@/lib/get-api-client";
import { MODULE_IDS, MODULE_LABELS } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";
import { ModuleDetailClient } from "@/components/modules/module-detail";

interface PageProps {
  params: Promise<{ module: string }>;
}

export default async function ModuleDetailPage({ params }: PageProps) {
  const { module: moduleSlug } = await params;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  const moduleId = moduleSlug as ModuleId;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find(
      (d) => d.listingId === moduleId || d.id === moduleId,
    );

    if (!deployment) {
      notFound();
    }

    const [connectionsResult, trustResult] = await Promise.all([
      client.getDeploymentConnections(deployment.id).catch(() => ({ connections: [] })),
      client.getListingTrustScore(deployment.listingId).catch(() => null),
    ]);

    return (
      <ModuleDetailClient
        moduleId={moduleId}
        label={MODULE_LABELS[moduleId]}
        deploymentId={deployment.id}
        orgId={deployment.organizationId}
        listingId={deployment.listingId}
        connections={connectionsResult.connections ?? []}
        trustBreakdown={trustResult}
        inputConfig={(deployment.inputConfig as Record<string, unknown>) ?? {}}
      />
    );
  } catch {
    notFound();
  }
}
```

- [ ] **Step 2: Create the module detail client component**

Create `apps/dashboard/src/components/modules/module-detail.tsx`:

```typescript
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTasks, useTrustProgression } from "@/hooks/use-marketplace";
import { ChannelsSection } from "@/components/marketplace/channels-section";
import { TrustHistoryChart } from "@/components/marketplace/trust-history-chart";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { useModuleStatus } from "@/hooks/use-module-status";
import type { ModuleId } from "@/lib/module-types";
import type { TrustScoreBreakdown } from "@/lib/api-client-types";

interface ModuleDetailClientProps {
  moduleId: ModuleId;
  label: string;
  deploymentId: string;
  orgId: string;
  listingId: string;
  connections: Array<{ id: string; type: string; status: string }>;
  trustBreakdown: TrustScoreBreakdown | null;
  inputConfig: Record<string, unknown>;
}

export function ModuleDetailClient({
  moduleId,
  label,
  deploymentId,
  orgId,
  listingId,
  connections,
  trustBreakdown,
  inputConfig,
}: ModuleDetailClientProps) {
  const { data: tasks } = useTasks({ deploymentId });
  const { data: trustProgression } = useTrustProgression(listingId);
  const { data: modules } = useModuleStatus();
  const currentModule = modules?.find((m) => m.id === moduleId);

  return (
    <div className="dashboard-frame">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Home
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <h1
            className="text-xl font-semibold"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {label}
          </h1>
          {currentModule && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                currentModule.state === "live"
                  ? "bg-success/10 text-success"
                  : "bg-caution/10 text-caution-foreground",
              )}
            >
              {currentModule.state === "live" ? "Live" : currentModule.state.replace("_", " ")}
            </span>
          )}
        </div>
        <Link
          href={`/modules/${moduleId}/setup`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Configuration →
        </Link>
      </div>

      {/* Connection Health */}
      <div style={{ marginTop: "32px" }}>
        <ChannelsSection connections={connections} />
      </div>

      {/* Execution History */}
      {trustProgression && trustProgression.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Execution History</h2>
          <TrustHistoryChart progression={trustProgression} />
        </div>
      )}

      {/* Work Log */}
      {tasks && tasks.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Activity</h2>
          <WorkLogList tasks={tasks} />
        </div>
      )}

      {/* Traces link */}
      <div style={{ marginTop: "24px" }}>
        <Link
          href={`/modules/${moduleId}/traces`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View execution traces →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No type errors. If `TrustScoreBreakdown` or other types need import path adjustments, fix them.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add module detail page at /modules/[module]

Server component resolves org's active deployment for the module slug.
Client component reuses existing channels, trust history, and work log
components, relabeled as connection health, execution history, activity.
EOF
)"
```

---

### Task 9: Module Setup Wizard

**Files:**

- Create: `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`
- Create: `apps/dashboard/src/components/modules/module-setup-wizard.tsx`
- Create: `apps/dashboard/src/components/modules/convert-leads-setup.tsx`
- Create: `apps/dashboard/src/components/modules/create-ads-setup.tsx`
- Create: `apps/dashboard/src/components/modules/improve-spend-setup.tsx`

- [ ] **Step 1: Create the setup page**

Create `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`:

```typescript
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { notFound } from "next/navigation";
import { MODULE_IDS, MODULE_LABELS } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";
import { ModuleSetupWizard } from "@/components/modules/module-setup-wizard";

export default function ModuleSetupPage() {
  const params = useParams<{ module: string }>();
  const searchParams = useSearchParams();
  const moduleSlug = params.module;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  const moduleId = moduleSlug as ModuleId;
  const initialStep = searchParams.get("step") ?? undefined;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <ModuleSetupWizard
        moduleId={moduleId}
        label={MODULE_LABELS[moduleId]}
        initialStep={initialStep}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the setup wizard shell**

Create `apps/dashboard/src/components/modules/module-setup-wizard.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ModuleId } from "@/lib/module-types";
import { ConvertLeadsSetup } from "./convert-leads-setup";
import { CreateAdsSetup } from "./create-ads-setup";
import { ImproveSpendSetup } from "./improve-spend-setup";

interface ModuleSetupWizardProps {
  moduleId: ModuleId;
  label: string;
  initialStep?: string;
}

export function ModuleSetupWizard({ moduleId, label, initialStep }: ModuleSetupWizardProps) {
  const router = useRouter();

  const handleComplete = useCallback(() => {
    router.push(`/modules/${moduleId}`);
  }, [router, moduleId]);

  return (
    <div className="w-full max-w-lg">
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Home
        </Link>
        <h1
          className="mt-4 text-2xl font-semibold"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Set up {label}
        </h1>
      </div>

      {moduleId === "lead-to-booking" && (
        <ConvertLeadsSetup initialStep={initialStep} onComplete={handleComplete} />
      )}
      {moduleId === "creative" && (
        <CreateAdsSetup initialStep={initialStep} onComplete={handleComplete} />
      )}
      {moduleId === "ad-optimizer" && (
        <ImproveSpendSetup initialStep={initialStep} onComplete={handleComplete} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create Convert Leads setup steps**

Create `apps/dashboard/src/components/modules/convert-leads-setup.tsx`:

```typescript
"use client";

import { useState } from "react";

interface ConvertLeadsSetupProps {
  initialStep?: string;
  onComplete: () => void;
}

type Step = "scheduling-mode" | "connect-calendar" | "business-hours" | "activate";
const STEPS: Step[] = ["scheduling-mode", "connect-calendar", "business-hours", "activate"];

export function ConvertLeadsSetup({ initialStep, onComplete }: ConvertLeadsSetupProps) {
  const startIdx = initialStep ? Math.max(STEPS.indexOf(initialStep as Step), 0) : 0;
  const [currentStep, setCurrentStep] = useState<Step>(STEPS[startIdx]);
  const [schedulingMode, setSchedulingMode] = useState<"google" | "local">("local");

  const goNext = () => {
    const idx = STEPS.indexOf(currentStep);
    let nextIdx = idx + 1;
    if (currentStep === "scheduling-mode" && schedulingMode === "local") {
      nextIdx = STEPS.indexOf("business-hours");
    }
    if (nextIdx >= STEPS.length) {
      onComplete();
      return;
    }
    setCurrentStep(STEPS[nextIdx]);
  };

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex gap-1">
        {STEPS.filter((s) => schedulingMode === "local" ? s !== "connect-calendar" : true).map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full ${
              STEPS.indexOf(s) <= STEPS.indexOf(currentStep) ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {currentStep === "scheduling-mode" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Configure scheduling</h2>
          <p className="text-sm text-muted-foreground">
            Choose how you want to manage availability for bookings.
          </p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSchedulingMode("local")}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                schedulingMode === "local" ? "border-foreground bg-foreground/5" : "border-border hover:border-foreground/30"
              }`}
            >
              <div className="font-medium text-sm">Local scheduling</div>
              <div className="text-xs text-muted-foreground mt-1">
                Set business hours manually. No external calendar needed.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSchedulingMode("google")}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                schedulingMode === "google" ? "border-foreground bg-foreground/5" : "border-border hover:border-foreground/30"
              }`}
            >
              <div className="font-medium text-sm">Google Calendar</div>
              <div className="text-xs text-muted-foreground mt-1">
                Sync with Google Calendar for real-time availability.
              </div>
            </button>
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {currentStep === "connect-calendar" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Connect Google Calendar</h2>
          <p className="text-sm text-muted-foreground">
            Grant access to check availability and create booking events.
          </p>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Connect Google Calendar
          </button>
          <p className="text-xs text-center text-muted-foreground">
            OAuth flow will be wired when Google Calendar credentials are provisioned.
          </p>
        </div>
      )}

      {currentStep === "business-hours" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Set business hours</h2>
          <p className="text-sm text-muted-foreground">
            Define when bookings can be scheduled.
          </p>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Business hours configuration form will be rendered here.
            Uses existing BusinessHoursConfig schema.
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Save &amp; continue
          </button>
        </div>
      )}

      {currentStep === "activate" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Activate Convert Leads</h2>
          <p className="text-sm text-muted-foreground">
            Your lead-to-booking pipeline is ready. Activate to start converting leads into booked revenue.
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Activate module
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create Create Ads setup steps**

Create `apps/dashboard/src/components/modules/create-ads-setup.tsx`:

```typescript
"use client";

import { useState } from "react";

interface CreateAdsSetupProps {
  initialStep?: string;
  onComplete: () => void;
}

type Step = "enable" | "first-job";

export function CreateAdsSetup({ initialStep, onComplete }: CreateAdsSetupProps) {
  const [currentStep, setCurrentStep] = useState<Step>(
    initialStep === "first-job" ? "first-job" : "enable",
  );
  const [isPlatformBlocking] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex gap-1">
        {(["enable", "first-job"] as Step[]).map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full ${
              (s === "enable" && currentStep === "enable") || currentStep === "first-job"
                ? "bg-foreground"
                : s === "first-job" && currentStep === "enable"
                  ? "bg-muted"
                  : "bg-foreground"
            }`}
          />
        ))}
      </div>

      {currentStep === "enable" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Enable Create Ads</h2>
          {isPlatformBlocking ? (
            <>
              <p className="text-sm text-muted-foreground">
                Platform configuration required. Contact your administrator to set up the AI provider.
              </p>
              <button
                type="button"
                disabled
                className="w-full rounded-lg bg-muted text-muted-foreground py-2.5 text-sm font-medium cursor-not-allowed"
              >
                Platform setup required
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Activate the creative pipeline to generate ad creative — trend analysis,
                hooks, scripts, storyboards, and video production.
              </p>
              <button
                type="button"
                onClick={() => setCurrentStep("first-job")}
                className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
              >
                Enable module
              </button>
            </>
          )}
        </div>
      )}

      {currentStep === "first-job" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Submit your first creative job</h2>
          <p className="text-sm text-muted-foreground">
            Optional — you can skip this and submit a job later from the module detail page.
          </p>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Creative brief form (industry, tone, key messages) will be rendered here.
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onComplete}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={onComplete}
              className="flex-1 rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Submit job
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create Improve Spend setup steps**

Create `apps/dashboard/src/components/modules/improve-spend-setup.tsx`:

```typescript
"use client";

import { useState } from "react";

interface ImproveSpendSetupProps {
  initialStep?: string;
  onComplete: () => void;
}

type Step = "connect-meta" | "select-account" | "set-targets" | "connect-capi" | "activate";
const STEPS: Step[] = ["connect-meta", "select-account", "set-targets", "connect-capi", "activate"];

export function ImproveSpendSetup({ initialStep, onComplete }: ImproveSpendSetupProps) {
  const startIdx = initialStep ? Math.max(STEPS.indexOf(initialStep as Step), 0) : 0;
  const [currentStep, setCurrentStep] = useState<Step>(STEPS[startIdx]);

  const goNext = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx + 1 >= STEPS.length) {
      onComplete();
      return;
    }
    setCurrentStep(STEPS[idx + 1]);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-1">
        {STEPS.map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full ${
              STEPS.indexOf(s) <= STEPS.indexOf(currentStep) ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {currentStep === "connect-meta" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Connect Meta Ads</h2>
          <p className="text-sm text-muted-foreground">
            Sign in with Facebook to grant access to your ad accounts.
          </p>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Connect with Facebook
          </button>
          <p className="text-xs text-center text-muted-foreground">
            Uses existing Facebook OAuth flow from ad-optimizer package.
          </p>
        </div>
      )}

      {currentStep === "select-account" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Select ad account</h2>
          <p className="text-sm text-muted-foreground">
            Choose which Meta ad account to monitor and optimize.
          </p>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Ad account list from listAdAccounts() will be rendered here.
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Select &amp; continue
          </button>
        </div>
      )}

      {currentStep === "set-targets" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Set optimization targets</h2>
          <p className="text-sm text-muted-foreground">
            Define your performance goals. These can be changed later.
          </p>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Target CPA, target ROAS, and monthly budget inputs will be rendered here.
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Save &amp; continue
          </button>
        </div>
      )}

      {currentStep === "connect-capi" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Connect Conversions API</h2>
          <p className="text-sm text-muted-foreground">
            Optional — provide your Meta Pixel ID to enable closed-loop conversion tracking.
          </p>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Pixel ID input will be rendered here.
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Connect CAPI
            </button>
          </div>
        </div>
      )}

      {currentStep === "activate" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Activate Improve Spend</h2>
          <p className="text-sm text-muted-foreground">
            Your ad optimizer is ready. Weekly audits will run automatically every Monday at 9am.
            Daily health checks run at 8am.
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Activate module
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No type errors.

- [ ] **Step 7: Run dev server and test setup flows**

Navigate to:

- `http://localhost:3002/modules/lead-to-booking/setup`
- `http://localhost:3002/modules/creative/setup`
- `http://localhost:3002/modules/ad-optimizer/setup`

Verify: each wizard renders, step navigation works, progress bar updates, deep-link params work (e.g., `?step=connect-meta`).

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add module setup wizards for all three modules

/modules/[module]/setup with semantic step routing. Convert Leads has
scheduling mode selector (Google/local). Create Ads is one-click enable.
Improve Spend has 5-step Meta Ads connection flow.
EOF
)"
```

---

### Task 10: Deployment Redirects & Thin Wrapper Pages

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/modules/[module]/traces/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/modules/creative/jobs/[jobId]/page.tsx`

- [ ] **Step 1: Replace deployment detail with redirect**

Replace the contents of `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import { getApiClient } from "@/lib/get-api-client";
import { MODULE_IDS } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeploymentRedirectPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => d.id === id);

    if (deployment) {
      const moduleType = deployment.listingId as string;
      if (MODULE_IDS.includes(moduleType as ModuleId)) {
        redirect(`/modules/${moduleType}`);
      }
    }
  } catch {
    // Fall through to dashboard redirect
  }

  redirect("/dashboard");
}
```

- [ ] **Step 2: Create traces thin wrapper page**

Create `apps/dashboard/src/app/(auth)/modules/[module]/traces/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { MODULE_IDS } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";

interface PageProps {
  params: Promise<{ module: string }>;
}

export default async function ModuleTracesPage({ params }: PageProps) {
  const { module: moduleSlug } = await params;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  return (
    <div className="dashboard-frame">
      <h1
        className="text-xl font-semibold"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Execution Traces
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Trace viewer for {moduleSlug} module will be wired here.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create creative job detail thin wrapper**

Create `apps/dashboard/src/app/(auth)/modules/creative/jobs/[jobId]/page.tsx`:

```typescript
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function CreativeJobDetailPage({ params }: PageProps) {
  const { jobId } = await params;

  if (!jobId) notFound();

  return (
    <div className="dashboard-frame">
      <h1
        className="text-xl font-semibold"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Creative Job
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Creative job detail for {jobId} will be wired here. Reuses existing creative job components.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck && npx pnpm@9.15.4 test`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add deployment redirects and module sub-pages

/deployments/[id] now redirects to /modules/[resolved-module].
Traces and creative job detail pages added as thin wrappers.
EOF
)"
```

---

### Task 11: Onboarding Copy Adjustments

**Files:**

- Modify: onboarding components (check `apps/dashboard/src/app/(auth)/onboarding/` for the Go Live step)

- [ ] **Step 1: Find and update Go Live copy**

Search for "launch your agent" or "launch" in onboarding components. Update to module-based language:

- "Connect channels and launch your agent" → "Connect channels and enable your first revenue module"
- "Your agent is live" → "Your revenue system is live"

These are copy-only changes — no structural changes to the onboarding flow.

- [ ] **Step 2: Run dev server and verify onboarding**

Navigate to `http://localhost:3002/onboarding` and step through to the Go Live screen. Verify the copy reads correctly.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: update onboarding copy for revenue module framing

Replace agent-centric language with module-based language in the
Go Live onboarding step. No structural changes.
EOF
)"
```

---

### Task 12: Final Integration Test & Cleanup

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test`

Expected: All tests pass. Fix any failures from deleted components or broken imports.

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint`

Expected: No lint errors in new files. Fix any issues.

- [ ] **Step 4: Verify full user flow in browser**

Test these flows:

1. Load `/dashboard` → module cards visible, recommendation bar shows, synergy strip renders
2. Click module card (not_setup) → navigates to `/modules/[module]/setup`
3. Step through a setup wizard → completes and redirects to `/modules/[module]`
4. Module detail page renders with execution history and connection health
5. Bottom nav shows Home / Decide / Me (3 tabs)
6. `/marketplace` returns 404 (route deleted)
7. `/deployments/[id]` redirects to `/modules/[resolved]`

- [ ] **Step 5: Commit any remaining fixes**

```bash
git commit -m "$(cat <<'EOF'
chore: final integration fixes for revenue control center pivot
EOF
)"
```
