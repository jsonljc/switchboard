# Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 3-step onboarding wizard with a playbook-first, scan-assisted, split-screen training experience that makes Alex configuration feel alive and non-technical.

**Architecture:** 4-screen onboarding flow (Entry → Training → Test Center → Go Live) with a post-launch first-run dashboard layer. The playbook is stored as a JSON draft on the org config during onboarding, then decomposed into existing config structures on launch. Website scan uses Claude API for lightweight extraction. The interview engine is a deterministic state machine with LLM-generated phrasing. Test Center runs the real skill executor with a simulation flag.

**Tech Stack:** Next.js 15 (App Router), React 19, TanStack React Query, Zod, Prisma, framer-motion, shadcn/ui, Tailwind CSS, @anthropic-ai/sdk, vitest + @testing-library/react

---

## File Structure

### New Files

```
packages/schemas/src/playbook.ts                              — Playbook Zod schema + types
packages/schemas/src/website-scan.ts                          — Scan request/response schemas

apps/api/src/routes/playbook.ts                               — Playbook CRUD API routes
apps/api/src/routes/website-scan.ts                           — Website scan API route
apps/api/src/routes/test-prompts.ts                           — Test prompt generation route
apps/api/src/routes/simulate.ts                               — Skill simulation route

apps/dashboard/src/app/(auth)/onboarding/page.tsx             — REWRITE: new 4-screen orchestrator
apps/dashboard/src/app/api/dashboard/playbook/route.ts        — Playbook proxy route
apps/dashboard/src/app/api/dashboard/website-scan/route.ts    — Scan proxy route
apps/dashboard/src/app/api/dashboard/test-prompts/route.ts    — Test prompt proxy route
apps/dashboard/src/app/api/dashboard/simulate/route.ts        — Simulation proxy route

apps/dashboard/src/hooks/use-playbook.ts                      — Playbook query + mutations
apps/dashboard/src/hooks/use-website-scan.ts                  — Scan mutation
apps/dashboard/src/hooks/use-test-prompts.ts                  — Test prompt generation
apps/dashboard/src/hooks/use-simulate.ts                      — Simulation hook
apps/dashboard/src/hooks/use-first-run.ts                     — First-run state tracking

apps/dashboard/src/components/onboarding/onboarding-entry.tsx         — Screen 1
apps/dashboard/src/components/onboarding/training-shell.tsx           — Screen 2 layout
apps/dashboard/src/components/onboarding/alex-chat.tsx                — Chat panel
apps/dashboard/src/components/onboarding/chat-message.tsx             — Message bubble
apps/dashboard/src/components/onboarding/playbook-panel.tsx           — Playbook panel
apps/dashboard/src/components/onboarding/playbook-section.tsx         — Collapsible section
apps/dashboard/src/components/onboarding/service-card.tsx             — Editable service card
apps/dashboard/src/components/onboarding/approval-scenario.tsx        — Scenario selector
apps/dashboard/src/components/onboarding/test-center.tsx              — Screen 3
apps/dashboard/src/components/onboarding/prompt-card.tsx              — Clickable prompt
apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx      — Correction panel
apps/dashboard/src/components/onboarding/go-live.tsx                  — Screen 4
apps/dashboard/src/components/onboarding/launch-sequence.tsx          — Animated launch
apps/dashboard/src/components/onboarding/channel-connect-card.tsx     — Channel row + inline form
apps/dashboard/src/components/dashboard/first-run-banner.tsx          — Welcome overlay
apps/dashboard/src/components/settings/playbook-view.tsx              — Settings playbook surface

apps/dashboard/src/lib/interview-engine.ts                    — Deterministic interview state machine
apps/dashboard/src/lib/playbook-utils.ts                      — Readiness checks, section helpers
```

### Modified Files

```
packages/db/prisma/schema.prisma                              — Add onboardingPlaybook, onboardingStep to OrganizationConfig
packages/schemas/src/index.ts                                 — Export new schemas
apps/api/src/server.ts                                        — Register new routes
apps/dashboard/src/components/layout/app-shell.tsx            — Update onboarding redirect
apps/dashboard/src/components/layout/settings-layout.tsx      — Add "Your Playbook" nav item
apps/dashboard/src/components/dashboard/owner-today.tsx       — Add first-run layer
apps/dashboard/src/components/dashboard/staff-dashboard.tsx   — Add first-run layer
apps/dashboard/src/lib/query-keys.ts                          — Add playbook, scan, simulate keys
apps/dashboard/src/lib/api-client.ts                          — Add playbook, scan, simulate methods
```

### Test Files (co-located `__tests__/`)

```
packages/schemas/src/__tests__/playbook.test.ts
apps/dashboard/src/lib/__tests__/interview-engine.test.ts
apps/dashboard/src/lib/__tests__/playbook-utils.test.ts
apps/dashboard/src/hooks/__tests__/use-playbook.test.ts
apps/dashboard/src/components/onboarding/__tests__/onboarding-entry.test.tsx
apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx
apps/dashboard/src/components/onboarding/__tests__/service-card.test.tsx
apps/dashboard/src/components/onboarding/__tests__/approval-scenario.test.tsx
apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx
apps/dashboard/src/components/onboarding/__tests__/training-shell.test.tsx
apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx
apps/dashboard/src/components/onboarding/__tests__/prompt-card.test.tsx
apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx
apps/dashboard/src/components/onboarding/__tests__/launch-sequence.test.tsx
apps/dashboard/src/components/onboarding/__tests__/channel-connect-card.test.tsx
apps/dashboard/src/components/dashboard/__tests__/first-run-banner.test.tsx
```

---

## Phase 1: Foundation

### Task 1: Playbook Zod Schema

**Files:**

- Create: `packages/schemas/src/playbook.ts`
- Create: `packages/schemas/src/__tests__/playbook.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/playbook.test.ts
import { describe, it, expect } from "vitest";
import {
  PlaybookSchema,
  PlaybookSectionStatus,
  PlaybookServiceSchema,
  PlaybookReadinessSchema,
  type Playbook,
  type PlaybookService,
} from "../playbook.js";

describe("PlaybookSchema", () => {
  it("validates a complete playbook", () => {
    const playbook: Playbook = {
      businessIdentity: {
        name: "Bright Smile Dental",
        category: "dental",
        tagline: "Your family dentist",
        location: "Singapore",
        status: "ready",
        source: "scan",
      },
      services: [
        {
          id: "svc-1",
          name: "Teeth Whitening",
          price: 350,
          duration: 60,
          bookingBehavior: "book_directly",
          details: "Professional LED whitening",
          status: "ready",
          source: "scan",
        },
      ],
      hours: {
        timezone: "Asia/Singapore",
        schedule: { mon: "09:00-18:00", tue: "09:00-18:00" },
        afterHoursBehavior: "Take message, respond next business day",
        status: "check_this",
        source: "scan",
      },
      bookingRules: {
        leadVsBooking: "Alex qualifies first, then offers to book",
        status: "missing",
        source: "manual",
      },
      approvalMode: {
        bookingApproval: "book_if_open_ask_if_odd",
        pricingApproval: "share_if_in_playbook",
        status: "missing",
        source: "manual",
      },
      escalation: {
        triggers: [],
        toneBoundaries: "",
        status: "missing",
        source: "manual",
      },
      channels: {
        recommended: "whatsapp",
        configured: [],
        status: "missing",
        source: "manual",
      },
    };

    const result = PlaybookSchema.safeParse(playbook);
    expect(result.success).toBe(true);
  });

  it("rejects a service without a name", () => {
    const service = {
      id: "svc-1",
      name: "",
      bookingBehavior: "book_directly",
      status: "ready",
      source: "manual",
    };
    const result = PlaybookServiceSchema.safeParse(service);
    expect(result.success).toBe(false);
  });

  it("computes readiness from playbook", () => {
    const readiness = PlaybookReadinessSchema.parse({
      businessIdentity: "ready",
      services: "ready",
      hours: "check_this",
      bookingRules: "missing",
      approvalMode: "ready",
    });
    expect(readiness.businessIdentity).toBe("ready");
    expect(readiness.bookingRules).toBe("missing");
  });
});

describe("PlaybookSectionStatus", () => {
  it("accepts valid statuses", () => {
    expect(PlaybookSectionStatus.safeParse("ready").success).toBe(true);
    expect(PlaybookSectionStatus.safeParse("check_this").success).toBe(true);
    expect(PlaybookSectionStatus.safeParse("missing").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(PlaybookSectionStatus.safeParse("done").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run playbook.test`
Expected: FAIL — module `../playbook.js` not found

- [ ] **Step 3: Write the playbook schema**

```typescript
// packages/schemas/src/playbook.ts
import { z } from "zod";

export const PlaybookSectionStatus = z.enum(["ready", "check_this", "missing"]);
export type PlaybookSectionStatus = z.infer<typeof PlaybookSectionStatus>;

export const PlaybookSource = z.enum(["scan", "interview", "manual"]);
export type PlaybookSource = z.infer<typeof PlaybookSource>;

export const BookingBehavior = z.enum(["book_directly", "consultation_only", "ask_first"]);
export type BookingBehavior = z.infer<typeof BookingBehavior>;

export const BookingApproval = z.enum([
  "book_then_notify",
  "ask_before_booking",
  "book_if_open_ask_if_odd",
]);
export type BookingApproval = z.infer<typeof BookingApproval>;

export const PricingApproval = z.enum([
  "quote_from_playbook",
  "describe_but_confirm_pricing",
  "always_ask_before_pricing",
]);
export type PricingApproval = z.infer<typeof PricingApproval>;

export const PlaybookServiceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  price: z.number().optional(),
  duration: z.number().optional(),
  bookingBehavior: BookingBehavior.default("ask_first"),
  details: z.string().optional(),
  status: PlaybookSectionStatus,
  source: PlaybookSource,
});
export type PlaybookService = z.infer<typeof PlaybookServiceSchema>;

export const PlaybookSchema = z.object({
  businessIdentity: z.object({
    name: z.string().default(""),
    category: z.string().default(""),
    tagline: z.string().default(""),
    location: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  services: z.array(PlaybookServiceSchema).default([]),
  hours: z.object({
    timezone: z.string().default(""),
    schedule: z.record(z.string()).default({}),
    afterHoursBehavior: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  bookingRules: z.object({
    leadVsBooking: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  approvalMode: z.object({
    bookingApproval: BookingApproval.optional(),
    pricingApproval: PricingApproval.optional(),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  escalation: z.object({
    triggers: z.array(z.string()).default([]),
    toneBoundaries: z.string().default(""),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
  channels: z.object({
    recommended: z.string().optional(),
    configured: z.array(z.string()).default([]),
    status: PlaybookSectionStatus,
    source: PlaybookSource,
  }),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const PlaybookReadinessSchema = z.object({
  businessIdentity: PlaybookSectionStatus,
  services: PlaybookSectionStatus,
  hours: PlaybookSectionStatus,
  bookingRules: PlaybookSectionStatus,
  approvalMode: PlaybookSectionStatus,
});
export type PlaybookReadiness = z.infer<typeof PlaybookReadinessSchema>;

export const REQUIRED_SECTIONS = [
  "businessIdentity",
  "services",
  "hours",
  "bookingRules",
  "approvalMode",
] as const;

export const RECOMMENDED_SECTIONS = ["escalation", "channels"] as const;

export function getPlaybookReadiness(playbook: Playbook): PlaybookReadiness {
  return {
    businessIdentity: playbook.businessIdentity.status,
    services:
      playbook.services.length > 0 && playbook.services.some((s) => s.status === "ready")
        ? "ready"
        : playbook.services.length > 0
          ? "check_this"
          : "missing",
    hours: playbook.hours.status,
    bookingRules: playbook.bookingRules.status,
    approvalMode: playbook.approvalMode.status,
  };
}

export function isPlaybookReady(playbook: Playbook): boolean {
  const readiness = getPlaybookReadiness(playbook);
  return Object.values(readiness).every((s) => s === "ready");
}

export function createEmptyPlaybook(): Playbook {
  const base = { status: "missing" as const, source: "manual" as const };
  return {
    businessIdentity: { name: "", category: "", tagline: "", location: "", ...base },
    services: [],
    hours: { timezone: "", schedule: {}, afterHoursBehavior: "", ...base },
    bookingRules: { leadVsBooking: "", ...base },
    approvalMode: { ...base },
    escalation: { triggers: [], toneBoundaries: "", ...base },
    channels: { configured: [], ...base },
  };
}
```

- [ ] **Step 4: Export from barrel file**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./playbook.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run playbook.test`
Expected: PASS — all 4 tests

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/playbook.ts packages/schemas/src/__tests__/playbook.test.ts packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add playbook Zod schema for onboarding redesign

Defines the structured playbook type with sections, statuses, services,
approval scenarios, and readiness computation.
EOF
)"
```

---

### Task 2: Prisma Migration — Add Playbook Draft Fields

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add fields to OrganizationConfig model**

In `packages/db/prisma/schema.prisma`, find the `OrganizationConfig` model and add two fields after `businessHours`:

```prisma
  onboardingPlaybook Json?
  onboardingStep     Int      @default(1)
  firstRunPhase      Json?
```

`onboardingPlaybook` stores the draft `Playbook` JSON during onboarding.
`onboardingStep` tracks which screen the user is on (1-4).
`firstRunPhase` tracks per-element fade-out state post-launch.

- [ ] **Step 2: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`
Expected: Prisma client generated successfully

- [ ] **Step 3: Create and run migration**

Run: `npx pnpm@9.15.4 db:migrate -- --name add_onboarding_playbook`
Expected: Migration created and applied

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat: add onboarding playbook fields to OrganizationConfig

Adds onboardingPlaybook (JSON draft), onboardingStep (screen tracker),
and firstRunPhase (post-launch element fade state).
EOF
)"
```

---

### Task 3: Playbook API Routes + Dashboard Proxy

**Files:**

- Create: `apps/api/src/routes/playbook.ts`
- Create: `apps/dashboard/src/app/api/dashboard/playbook/route.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`

- [ ] **Step 1: Write the API route**

```typescript
// apps/api/src/routes/playbook.ts
import type { FastifyPluginAsync } from "fastify";
import { PlaybookSchema, createEmptyPlaybook } from "@switchboard/schemas";

const playbookRoutes: FastifyPluginAsync = async (app) => {
  if (!app.prisma) {
    app.log.warn("Prisma not available — playbook routes disabled");
    return;
  }

  app.get("/api/playbook", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const config = await app.prisma.organizationConfig.findUnique({
      where: { id: orgId },
      select: {
        onboardingPlaybook: true,
        onboardingStep: true,
        onboardingComplete: true,
      },
    });

    if (!config) return reply.code(404).send({ error: "Org not found" });

    const playbook = config.onboardingPlaybook
      ? PlaybookSchema.parse(config.onboardingPlaybook)
      : createEmptyPlaybook();

    return reply.send({
      playbook,
      step: config.onboardingStep,
      complete: config.onboardingComplete,
    });
  });

  app.patch("/api/playbook", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const body = request.body as { playbook?: unknown; step?: number };
    const updates: Record<string, unknown> = {};

    if (body.playbook !== undefined) {
      const parsed = PlaybookSchema.safeParse(body.playbook);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid playbook", issues: parsed.error.issues });
      }
      updates.onboardingPlaybook = parsed.data;
    }

    if (body.step !== undefined) {
      if (typeof body.step !== "number" || body.step < 1 || body.step > 4) {
        return reply.code(400).send({ error: "Step must be 1-4" });
      }
      updates.onboardingStep = body.step;
    }

    const config = await app.prisma.organizationConfig.update({
      where: { id: orgId },
      data: updates,
    });

    return reply.send({
      playbook: config.onboardingPlaybook
        ? PlaybookSchema.parse(config.onboardingPlaybook)
        : createEmptyPlaybook(),
      step: config.onboardingStep,
    });
  });
};

export default playbookRoutes;
```

- [ ] **Step 2: Register the route in server.ts**

In `apps/api/src/server.ts`, add:

```typescript
import playbookRoutes from "./routes/playbook.js";
```

And register with `app.register(playbookRoutes);` alongside the other route registrations.

- [ ] **Step 3: Write the dashboard proxy route**

```typescript
// apps/dashboard/src/app/api/dashboard/playbook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.getPlaybook();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.updatePlaybook(body);
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

- [ ] **Step 4: Add API client methods**

In `apps/dashboard/src/lib/api-client.ts`, add to `SwitchboardClient`:

```typescript
async getPlaybook(): Promise<{
  playbook: Playbook;
  step: number;
  complete: boolean;
}> {
  return this.get("/api/playbook");
}

async updatePlaybook(body: {
  playbook?: Playbook;
  step?: number;
}): Promise<{ playbook: Playbook; step: number }> {
  return this.patch("/api/playbook", body);
}
```

Add the import at top: `import type { Playbook } from "@switchboard/schemas";`

- [ ] **Step 5: Add query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add:

```typescript
playbook: {
  all: ["playbook"] as const,
  current: () => [...queryKeys.playbook.all, "current"] as const,
},
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/playbook.ts apps/api/src/server.ts apps/dashboard/src/app/api/dashboard/playbook/route.ts apps/dashboard/src/lib/api-client.ts apps/dashboard/src/lib/query-keys.ts
git commit -m "$(cat <<'EOF'
feat: add playbook API routes and dashboard proxy

CRUD endpoints for draft playbook state during onboarding.
Playbook stored as JSON on OrganizationConfig, validated via Zod.
EOF
)"
```

---

### Task 4: Playbook React Hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-playbook.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-playbook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/hooks/__tests__/use-playbook.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("usePlaybook", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches and returns playbook data", async () => {
    const mockPlaybook = {
      playbook: {
        businessIdentity: {
          name: "Test Biz",
          status: "ready",
          source: "manual",
          category: "",
          tagline: "",
          location: "",
        },
        services: [],
        hours: {
          timezone: "",
          schedule: {},
          afterHoursBehavior: "",
          status: "missing",
          source: "manual",
        },
        bookingRules: { leadVsBooking: "", status: "missing", source: "manual" },
        approvalMode: { status: "missing", source: "manual" },
        escalation: { triggers: [], toneBoundaries: "", status: "missing", source: "manual" },
        channels: { configured: [], status: "missing", source: "manual" },
      },
      step: 1,
      complete: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlaybook),
    });

    const { usePlaybook } = await import("../use-playbook");
    const { result } = renderHook(() => usePlaybook(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.playbook.businessIdentity.name).toBe("Test Biz");
    expect(result.current.data?.step).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run use-playbook.test`
Expected: FAIL — module `../use-playbook` not found

- [ ] **Step 3: Write the hook**

```typescript
// apps/dashboard/src/hooks/use-playbook.ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Playbook } from "@switchboard/schemas";

interface PlaybookResponse {
  playbook: Playbook;
  step: number;
  complete: boolean;
}

interface PlaybookUpdate {
  playbook?: Playbook;
  step?: number;
}

async function fetchPlaybook(): Promise<PlaybookResponse> {
  const res = await fetch("/api/dashboard/playbook");
  if (!res.ok) throw new Error("Failed to fetch playbook");
  return res.json();
}

async function updatePlaybook(body: PlaybookUpdate): Promise<PlaybookResponse> {
  const res = await fetch("/api/dashboard/playbook", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update playbook");
  return res.json();
}

export function usePlaybook() {
  return useQuery({
    queryKey: queryKeys.playbook.current(),
    queryFn: fetchPlaybook,
  });
}

export function useUpdatePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePlaybook,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.playbook.current(), data);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run use-playbook.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-playbook.ts apps/dashboard/src/hooks/__tests__/use-playbook.test.ts
git commit -m "$(cat <<'EOF'
feat: add usePlaybook hook for onboarding state management
EOF
)"
```

---

### Task 5: Playbook Utility Functions

**Files:**

- Create: `apps/dashboard/src/lib/playbook-utils.ts`
- Create: `apps/dashboard/src/lib/__tests__/playbook-utils.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/lib/__tests__/playbook-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  getReadySectionCount,
  getRequiredSectionCount,
  getReadinessLabel,
  getNextMissingSection,
  getSectionDisplayName,
} from "../playbook-utils";
import { createEmptyPlaybook } from "@switchboard/schemas";
import type { Playbook } from "@switchboard/schemas";

describe("playbook-utils", () => {
  it("counts ready sections from empty playbook", () => {
    const playbook = createEmptyPlaybook();
    expect(getReadySectionCount(playbook)).toBe(0);
    expect(getRequiredSectionCount()).toBe(5);
  });

  it("returns correct readiness label when all missing", () => {
    const playbook = createEmptyPlaybook();
    expect(getReadinessLabel(playbook)).toBe("0 of 5 required sections ready");
  });

  it("returns 'Ready to test Alex' when all required are ready", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.services = [
      { id: "1", name: "Test", bookingBehavior: "ask_first", status: "ready", source: "manual" },
    ];
    playbook.hours.status = "ready";
    playbook.bookingRules.status = "ready";
    playbook.approvalMode.status = "ready";
    expect(getReadinessLabel(playbook)).toBe("Ready to test Alex");
  });

  it("names the remaining section when 1 left", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.services = [
      { id: "1", name: "Test", bookingBehavior: "ask_first", status: "ready", source: "manual" },
    ];
    playbook.hours.status = "ready";
    playbook.bookingRules.status = "ready";
    const label = getReadinessLabel(playbook);
    expect(label).toBe("Almost ready: set your Approval Mode");
  });

  it("finds next missing section", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    expect(getNextMissingSection(playbook)).toBe("services");
  });

  it("returns display names", () => {
    expect(getSectionDisplayName("businessIdentity")).toBe("Business Identity");
    expect(getSectionDisplayName("approvalMode")).toBe("Approval Mode");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run playbook-utils.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the utilities**

```typescript
// apps/dashboard/src/lib/playbook-utils.ts
import {
  REQUIRED_SECTIONS,
  getPlaybookReadiness,
  isPlaybookReady,
  type Playbook,
  type PlaybookSectionStatus,
} from "@switchboard/schemas";

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  businessIdentity: "Business Identity",
  services: "Services",
  hours: "Hours & Availability",
  bookingRules: "Booking Rules",
  approvalMode: "Approval Mode",
  escalation: "Escalation",
  channels: "Channels",
};

export function getSectionDisplayName(key: string): string {
  return SECTION_DISPLAY_NAMES[key] ?? key;
}

export function getRequiredSectionCount(): number {
  return REQUIRED_SECTIONS.length;
}

export function getReadySectionCount(playbook: Playbook): number {
  const readiness = getPlaybookReadiness(playbook);
  return Object.values(readiness).filter((s) => s === "ready").length;
}

export function getNextMissingSection(
  playbook: Playbook,
): (typeof REQUIRED_SECTIONS)[number] | null {
  const readiness = getPlaybookReadiness(playbook);
  for (const section of REQUIRED_SECTIONS) {
    if (readiness[section] !== "ready") return section;
  }
  return null;
}

export function getReadinessLabel(playbook: Playbook): string {
  if (isPlaybookReady(playbook)) return "Ready to test Alex";

  const ready = getReadySectionCount(playbook);
  const total = getRequiredSectionCount();
  const remaining = total - ready;

  if (remaining === 1) {
    const missing = getNextMissingSection(playbook);
    if (missing) {
      return `Almost ready: set your ${getSectionDisplayName(missing)}`;
    }
  }

  return `${ready} of ${total} required sections ready`;
}

export { getPlaybookReadiness, isPlaybookReady };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run playbook-utils.test`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/playbook-utils.ts apps/dashboard/src/lib/__tests__/playbook-utils.test.ts
git commit -m "$(cat <<'EOF'
feat: add playbook utility functions for readiness tracking
EOF
)"
```

---

### Task 6: Update AppShell Redirect + Onboarding Screen Scaffolding

**Files:**

- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`
- Modify: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Update AppShell to redirect to `/onboarding` instead of `/setup`**

In `apps/dashboard/src/components/layout/app-shell.tsx`, find the redirect condition that checks `orgData?.config?.onboardingComplete` and change the redirect target from `"/setup"` to `"/onboarding"`:

```typescript
// Change: router.replace("/setup")
// To:
router.replace("/onboarding");
```

Also update the chrome-hidden path list to include `/onboarding`:

```typescript
// Ensure the hideChromeRoutes includes "/onboarding"
```

- [ ] **Step 2: Rewrite the onboarding page as a 4-step orchestrator**

```typescript
// apps/dashboard/src/app/(auth)/onboarding/page.tsx
"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";
import type { Playbook } from "@switchboard/schemas";

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: playbookData, isLoading } = usePlaybook();
  const updatePlaybook = useUpdatePlaybook();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "loading" || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--sw-base)]">
        <div className="text-[var(--sw-text-muted)] text-[16px]">Loading...</div>
      </div>
    );
  }

  if (!session || !playbookData) return null;

  const step = playbookData.step;
  const playbook = playbookData.playbook;

  const handleUpdatePlaybook = (updates: Partial<{ playbook: Playbook; step: number }>) => {
    updatePlaybook.mutate({
      playbook: updates.playbook ?? playbook,
      step: updates.step,
    });
  };

  switch (step) {
    case 1:
      return (
        <OnboardingEntry
          onScan={(url) => handleUpdatePlaybook({ step: 2 })}
          onSkip={(category) => handleUpdatePlaybook({ step: 2 })}
        />
      );
    case 2:
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--sw-base)]">
          <p className="text-[var(--sw-text-muted)]">Training — coming in Phase 2</p>
        </div>
      );
    case 3:
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--sw-base)]">
          <p className="text-[var(--sw-text-muted)]">Test Center — coming in Phase 4</p>
        </div>
      );
    case 4:
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--sw-base)]">
          <p className="text-[var(--sw-text-muted)]">Go Live — coming in Phase 5</p>
        </div>
      );
    default:
      return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/app-shell.tsx apps/dashboard/src/app/\(auth\)/onboarding/page.tsx
git commit -m "$(cat <<'EOF'
feat: wire onboarding routing and 4-screen orchestrator scaffold

AppShell now redirects to /onboarding. Page orchestrates screens
by step number from playbook state. Screen 1 renders, 2-4 are placeholders.
EOF
)"
```

---

### Task 7: Screen 1 — OnboardingEntry Component

**Files:**

- Create: `apps/dashboard/src/components/onboarding/onboarding-entry.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/onboarding-entry.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/onboarding-entry.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingEntry } from "../onboarding-entry";

describe("OnboardingEntry", () => {
  it("renders the headline and URL input", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText("Let Alex learn your business")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://yourwebsite.com")).toBeTruthy();
  });

  it("disables CTA when input is empty", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    const button = screen.getByRole("button", { name: /start scanning/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables CTA when URL is entered", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://yourwebsite.com");
    fireEvent.change(input, { target: { value: "https://example.com" } });
    const button = screen.getByRole("button", { name: /start scanning/i });
    expect(button).toHaveProperty("disabled", false);
  });

  it("calls onScan with URL when submitted", () => {
    const onScan = vi.fn();
    render(<OnboardingEntry onScan={onScan} onSkip={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://yourwebsite.com");
    fireEvent.change(input, { target: { value: "https://example.com" } });
    const button = screen.getByRole("button", { name: /start scanning/i });
    fireEvent.click(button);
    expect(onScan).toHaveBeenCalledWith("https://example.com");
  });

  it("shows category selector when skip is clicked", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    const skipLink = screen.getByText(/no website/i);
    fireEvent.click(skipLink);
    expect(screen.getByText("Dental")).toBeTruthy();
    expect(screen.getByText("Salon")).toBeTruthy();
  });

  it("calls onSkip with category when selected", () => {
    const onSkip = vi.fn();
    render(<OnboardingEntry onScan={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByText(/no website/i));
    fireEvent.click(screen.getByText("Dental"));
    expect(onSkip).toHaveBeenCalledWith("dental");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run onboarding-entry.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/onboarding-entry.tsx
"use client";

import { useState } from "react";
import { AgentMark } from "@/components/character/agent-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CATEGORIES = [
  { label: "Dental", value: "dental" },
  { label: "Salon", value: "salon" },
  { label: "Fitness", value: "fitness" },
  { label: "Med Spa", value: "med_spa" },
  { label: "Coaching", value: "coaching" },
  { label: "Other", value: "other" },
];

const SECONDARY_SOURCES = ["Instagram", "Google Business", "Facebook"];

interface OnboardingEntryProps {
  onScan: (url: string) => void;
  onSkip: (category: string) => void;
}

export function OnboardingEntry({ onScan, onSkip }: OnboardingEntryProps) {
  const [url, setUrl] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = () => {
    if (!url.trim()) return;
    setIsScanning(true);
    onScan(url.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && url.trim()) handleScan();
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      {/* Wordmark */}
      <div className="fixed left-6 top-6 z-10">
        <span
          className="text-[16px] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--sw-text-primary)",
          }}
        >
          Switchboard
        </span>
      </div>

      {/* Centered content — 40/60 upward bias */}
      <div className="flex flex-1 items-center justify-center" style={{ paddingBottom: "10vh" }}>
        <div className="mx-auto w-full max-w-[480px] px-6 text-center">
          {/* Alex mark */}
          <div className="mb-8 flex justify-center">
            <AgentMark agent="alex" size="lg" />
          </div>

          {/* Headline */}
          <h1
            className="mb-3 text-[32px] font-semibold leading-[40px]"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--sw-text-primary)",
            }}
          >
            Let Alex learn your business
          </h1>

          {/* Subtext */}
          <p
            className="mb-12 text-[16px] leading-[24px]"
            style={{ color: "var(--sw-text-secondary)" }}
          >
            Paste your website and Alex will draft your services, hours, rules, and lead flow.
          </p>

          {/* URL input */}
          <div className="mb-2">
            <Input
              type="url"
              placeholder="https://yourwebsite.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-[56px] rounded-lg px-5 text-[16px] transition-all duration-200"
              style={{
                borderColor: "var(--sw-border)",
                backgroundColor: "white",
                color: "var(--sw-text-primary)",
              }}
            />
          </div>

          {/* Helper text */}
          <p className="mb-6 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            We&apos;ll draft your setup from this. You can edit everything before going live.
          </p>

          {/* CTA */}
          <Button
            onClick={handleScan}
            disabled={!url.trim() || isScanning}
            className="h-[48px] rounded-lg px-8 text-[16px] font-medium transition-all duration-200"
            style={{
              backgroundColor:
                isScanning || !url.trim() ? "var(--sw-text-primary)" : "var(--sw-text-primary)",
              color: "white",
              opacity: !url.trim() ? 0.4 : 1,
            }}
          >
            {isScanning ? "Scanning..." : "Start scanning"}
          </Button>

          {/* Separator */}
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1" style={{ backgroundColor: "var(--sw-border)" }} />
            <span className="text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
              or use another page
            </span>
            <div className="h-px flex-1" style={{ backgroundColor: "var(--sw-border)" }} />
          </div>

          {/* Secondary sources */}
          <div className="mb-6 flex justify-center gap-4">
            {SECONDARY_SOURCES.map((source) => (
              <button
                key={source}
                onClick={() => {
                  /* same as primary, just primes context */
                }}
                className="text-[14px] underline-offset-2 transition-colors hover:underline"
                style={{ color: "var(--sw-text-secondary)" }}
              >
                {source}
              </button>
            ))}
          </div>

          {/* Skip path */}
          <div>
            <button
              onClick={() => setShowCategories(!showCategories)}
              className="text-[14px] transition-colors"
              style={{ color: "var(--sw-text-muted)" }}
            >
              No website? Start from a few questions →
            </button>

            {/* Category pills */}
            {showCategories && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => onSkip(cat.value)}
                    className="h-[36px] rounded-full border px-4 text-[14px] transition-all duration-200 hover:border-[var(--sw-accent)] hover:text-[var(--sw-accent)]"
                    style={{
                      borderColor: "var(--sw-border)",
                      color: "var(--sw-text-secondary)",
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run onboarding-entry.test`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/onboarding/onboarding-entry.tsx apps/dashboard/src/components/onboarding/__tests__/onboarding-entry.test.tsx
git commit -m "$(cat <<'EOF'
feat: add OnboardingEntry component (Screen 1)

URL input, secondary source links, skip path with category pills.
Dark neutral CTA, centered 40/60 layout, Alex mark with aura-breathe.
EOF
)"
```

---

## Phase 2: Training Core

### Task 8: Interview Engine — State Machine

**Files:**

- Create: `apps/dashboard/src/lib/interview-engine.ts`
- Create: `apps/dashboard/src/lib/__tests__/interview-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/lib/__tests__/interview-engine.test.ts
import { describe, it, expect } from "vitest";
import { InterviewEngine, type InterviewQuestion } from "../interview-engine";
import { createEmptyPlaybook, type Playbook } from "@switchboard/schemas";

describe("InterviewEngine", () => {
  it("returns business identity question for empty playbook", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question = engine.getNextQuestion();
    expect(question).not.toBeNull();
    expect(question!.targetSection).toBe("businessIdentity");
  });

  it("skips sections that are already ready", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.businessIdentity.name = "Test Biz";
    const engine = new InterviewEngine(playbook);
    const question = engine.getNextQuestion();
    expect(question!.targetSection).toBe("services");
  });

  it("asks confirmation for check_this sections", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "check_this";
    playbook.businessIdentity.name = "Bright Smile Dental";
    const engine = new InterviewEngine(playbook);
    const question = engine.getNextQuestion();
    expect(question!.type).toBe("confirm");
    expect(question!.targetSection).toBe("businessIdentity");
  });

  it("returns null when all required sections are ready", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.businessIdentity.name = "Test";
    playbook.services = [
      { id: "1", name: "Test", bookingBehavior: "ask_first", status: "ready", source: "manual" },
    ];
    playbook.hours.status = "ready";
    playbook.bookingRules.status = "ready";
    playbook.approvalMode.status = "ready";
    const engine = new InterviewEngine(playbook);
    const question = engine.getNextQuestion();
    expect(question).toBeNull();
  });

  it("generates category-seeded questions when category is provided", () => {
    const playbook = createEmptyPlaybook();
    const engine = new InterviewEngine(playbook, "dental");
    const question = engine.getNextQuestion();
    expect(question!.contextHint).toContain("dental");
  });

  it("processes user response and returns playbook update", () => {
    const engine = new InterviewEngine(createEmptyPlaybook());
    const question = engine.getNextQuestion()!;
    const update = engine.processResponse(
      question,
      "Bright Smile Dental, a dental clinic in Singapore",
    );
    expect(update.section).toBe("businessIdentity");
    expect(update.fields).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run interview-engine.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the interview engine**

```typescript
// apps/dashboard/src/lib/interview-engine.ts
import { REQUIRED_SECTIONS, RECOMMENDED_SECTIONS, type Playbook } from "@switchboard/schemas";

export type QuestionType = "ask" | "confirm" | "collect";

export interface InterviewQuestion {
  id: string;
  targetSection: string;
  type: QuestionType;
  prompt: string;
  contextHint: string;
}

export interface ResponseUpdate {
  section: string;
  fields: Record<string, unknown>;
  newStatus: "ready" | "check_this";
}

const CATEGORY_HINTS: Record<string, string> = {
  dental: "dental clinic or practice",
  salon: "hair salon or beauty studio",
  fitness: "gym, fitness studio, or personal training",
  med_spa: "medical spa or aesthetic clinic",
  coaching: "coaching or consulting practice",
  other: "service business",
};

const SECTION_QUESTIONS: Record<string, { ask: string; confirm: string; collect: string }> = {
  businessIdentity: {
    ask: "What's your business called, and what do you do?",
    confirm: "I found your business details. Does this look right, or should I adjust anything?",
    collect: "What's the best way to describe what your business offers?",
  },
  services: {
    ask: "What services do you offer? Include prices and duration if you have them.",
    confirm: "I found these services on your site. Are they accurate? Any missing?",
    collect: "Tell me about your most popular service — name, price, and how long it takes.",
  },
  hours: {
    ask: "What are your operating hours? And what should Alex do when someone messages after hours?",
    confirm: "I found these hours on your site. Look right?",
    collect: "What days and times are you open?",
  },
  bookingRules: {
    ask: "When someone wants to book, should Alex qualify them first or go straight to scheduling?",
    confirm:
      "Here's how I'd handle booking requests based on your site. Does this match how you work?",
    collect: "How do you want Alex to handle booking requests?",
  },
  approvalMode: {
    ask: "For bookings and pricing questions — should Alex handle them directly, or check with you first?",
    confirm: "I've set these default behaviors. Want to adjust any?",
    collect: "How much autonomy should Alex have?",
  },
  escalation: {
    ask: "Are there any situations where Alex should always hand off to you? Like complaints, refund requests, or specific topics?",
    confirm: "I've set some default escalation rules. Want to refine them?",
    collect: "What topics should Alex always escalate to you?",
  },
  channels: {
    ask: "Which messaging channel do your customers use most — WhatsApp, Telegram, or something else?",
    confirm: "I found contact methods on your site. Which channels should Alex operate on?",
    collect: "Where do your customers usually reach you?",
  },
};

export class InterviewEngine {
  private playbook: Playbook;
  private category: string | undefined;
  private askedSections: Set<string> = new Set();

  constructor(playbook: Playbook, category?: string) {
    this.playbook = playbook;
    this.category = category;
  }

  getNextQuestion(): InterviewQuestion | null {
    for (const section of REQUIRED_SECTIONS) {
      const status = this.getSectionStatus(section);
      if (status === "ready") continue;
      if (this.askedSections.has(section)) continue;

      return this.buildQuestion(section, status);
    }

    for (const section of RECOMMENDED_SECTIONS) {
      const status = this.getSectionStatus(section);
      if (status === "ready") continue;
      if (this.askedSections.has(section)) continue;

      return this.buildQuestion(section, status);
    }

    return null;
  }

  markAsked(section: string): void {
    this.askedSections.add(section);
  }

  processResponse(question: InterviewQuestion, _response: string): ResponseUpdate {
    this.askedSections.add(question.targetSection);
    return {
      section: question.targetSection,
      fields: {},
      newStatus: "ready",
    };
  }

  private getSectionStatus(section: string): string {
    const sectionData = this.playbook[section as keyof Playbook];
    if (!sectionData || typeof sectionData !== "object") return "missing";
    if (Array.isArray(sectionData)) {
      return sectionData.length > 0 ? "check_this" : "missing";
    }
    return (sectionData as { status: string }).status;
  }

  private buildQuestion(section: string, status: string): InterviewQuestion {
    const templates = SECTION_QUESTIONS[section];
    if (!templates) {
      return {
        id: `q-${section}`,
        targetSection: section,
        type: "ask",
        prompt: `Tell me about your ${section}.`,
        contextHint: "",
      };
    }

    const type: QuestionType = status === "check_this" ? "confirm" : "ask";
    const prompt = type === "confirm" ? templates.confirm : templates.ask;
    const categoryHint = this.category ? (CATEGORY_HINTS[this.category] ?? this.category) : "";

    return {
      id: `q-${section}`,
      targetSection: section,
      type,
      prompt,
      contextHint: categoryHint ? `The user runs a ${categoryHint}.` : "",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run interview-engine.test`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/interview-engine.ts apps/dashboard/src/lib/__tests__/interview-engine.test.ts
git commit -m "$(cat <<'EOF'
feat: add interview engine state machine for onboarding

Deterministic priority-ordered interview that tracks which sections
are populated, confirmed, or missing. LLM generates phrasing later;
this controls the flow.
EOF
)"
```

---

### Task 9: PlaybookSection Component

**Files:**

- Create: `apps/dashboard/src/components/onboarding/playbook-section.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaybookSection } from "../playbook-section";

describe("PlaybookSection", () => {
  it("renders section title and status", () => {
    render(
      <PlaybookSection title="Services" status="ready" required>
        <p>Content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("renders missing status with gray indicator", () => {
    render(
      <PlaybookSection title="Hours" status="missing" required>
        <p>Content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  it("renders check_this status", () => {
    render(
      <PlaybookSection title="Business" status="check_this" required>
        <p>Content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Check this")).toBeTruthy();
  });

  it("collapses and expands on header click", () => {
    render(
      <PlaybookSection title="Services" status="ready" required>
        <p>Section content</p>
      </PlaybookSection>,
    );
    expect(screen.getByText("Section content")).toBeTruthy();
    fireEvent.click(screen.getByText("Services"));
    expect(screen.queryByText("Section content")).toBeNull();
    fireEvent.click(screen.getByText("Services"));
    expect(screen.getByText("Section content")).toBeTruthy();
  });

  it("starts collapsed when status is missing", () => {
    render(
      <PlaybookSection title="Hours" status="missing" required defaultCollapsed>
        <p>Hidden content</p>
      </PlaybookSection>,
    );
    expect(screen.queryByText("Hidden content")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run playbook-section.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/playbook-section.tsx
"use client";

import { useState } from "react";
import type { PlaybookSectionStatus } from "@switchboard/schemas";

const STATUS_CONFIG: Record<
  PlaybookSectionStatus,
  { label: string; dotColor: string; borderColor: string }
> = {
  ready: {
    label: "Ready",
    dotColor: "hsl(145, 45%, 42%)",
    borderColor: "hsl(145, 45%, 42%)",
  },
  check_this: {
    label: "Check this",
    dotColor: "var(--sw-accent)",
    borderColor: "var(--sw-accent)",
  },
  missing: {
    label: "Missing",
    dotColor: "var(--sw-text-muted)",
    borderColor: "var(--sw-border)",
  },
};

interface PlaybookSectionProps {
  title: string;
  status: PlaybookSectionStatus;
  required: boolean;
  defaultCollapsed?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}

export function PlaybookSection({
  title,
  status,
  required,
  defaultCollapsed = false,
  highlight = false,
  children,
}: PlaybookSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const config = STATUS_CONFIG[status];

  return (
    <div
      className="overflow-hidden rounded-xl border transition-all duration-200"
      style={{
        borderColor: required ? "var(--sw-border-strong)" : "var(--sw-border)",
        borderLeftWidth: "3px",
        borderLeftColor: highlight ? "var(--sw-accent)" : config.borderColor,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[var(--sw-surface)]"
      >
        <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
          {title}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[14px]" style={{ color: config.dotColor }}>
            {config.label}
          </span>
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: config.dotColor }}
          />
        </span>
      </button>

      {/* Content */}
      {!collapsed && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run playbook-section.test`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/onboarding/playbook-section.tsx apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx
git commit -m "$(cat <<'EOF'
feat: add PlaybookSection component with status indicators

Collapsible section with 3-state status (ready/check_this/missing),
left border accent, required vs recommended visual weight.
EOF
)"
```

---

### Task 10: ServiceCard Component

**Files:**

- Create: `apps/dashboard/src/components/onboarding/service-card.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/service-card.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/service-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServiceCard } from "../service-card";
import type { PlaybookService } from "@switchboard/schemas";

const mockService: PlaybookService = {
  id: "svc-1",
  name: "Teeth Whitening",
  price: 350,
  duration: 60,
  bookingBehavior: "book_directly",
  details: "Professional whitening",
  status: "ready",
  source: "scan",
};

describe("ServiceCard", () => {
  it("renders service name and price", () => {
    render(
      <ServiceCard service={mockService} onChange={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Teeth Whitening")).toBeTruthy();
    expect(screen.getByText(/\$350/)).toBeTruthy();
  });

  it("shows 'Needs price' when price is missing", () => {
    const noPrice = { ...mockService, price: undefined };
    render(
      <ServiceCard service={noPrice} onChange={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText("Needs price")).toBeTruthy();
  });

  it("shows scan tint for scan-sourced services", () => {
    const { container } = render(
      <ServiceCard service={mockService} onChange={vi.fn()} onDelete={vi.fn()} />,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.style.backgroundColor).toContain("rgba");
  });

  it("calls onChange when name is edited", () => {
    const onChange = vi.fn();
    render(
      <ServiceCard service={mockService} onChange={onChange} onDelete={vi.fn()} />,
    );
    const input = screen.getByDisplayValue("Teeth Whitening");
    fireEvent.change(input, { target: { value: "Laser Whitening" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalled();
  });

  it("shows delete confirmation when delete is clicked", () => {
    render(
      <ServiceCard service={mockService} onChange={vi.fn()} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("✕"));
    expect(screen.getByText("Remove?")).toBeTruthy();
  });

  it("calls onDelete when confirmed", () => {
    const onDelete = vi.fn();
    render(
      <ServiceCard service={mockService} onChange={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByText("✕"));
    fireEvent.click(screen.getByText("Yes"));
    expect(onDelete).toHaveBeenCalledWith("svc-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run service-card.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/service-card.tsx
"use client";

import { useState } from "react";
import type { PlaybookService, BookingBehavior } from "@switchboard/schemas";

const BOOKING_OPTIONS: { label: string; value: BookingBehavior }[] = [
  { label: "Book directly", value: "book_directly" },
  { label: "Consultation only", value: "consultation_only" },
  { label: "Ask first", value: "ask_first" },
];

interface ServiceCardProps {
  service: PlaybookService;
  onChange: (updated: PlaybookService) => void;
  onDelete: (id: string) => void;
}

export function ServiceCard({ service, onChange, onDelete }: ServiceCardProps) {
  const [name, setName] = useState(service.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isScanSourced = service.source === "scan";

  const handleNameBlur = () => {
    if (name !== service.name) {
      onChange({ ...service, name, source: "manual", status: "ready" });
    }
  };

  const handleBookingChange = (value: BookingBehavior) => {
    onChange({ ...service, bookingBehavior: value, source: "manual", status: "ready" });
  };

  return (
    <div
      className="rounded-lg border p-4 transition-all duration-200"
      style={{
        borderColor: "var(--sw-border)",
        backgroundColor:
          isScanSourced && service.status !== "ready" ? "rgba(160, 120, 80, 0.06)" : "white",
      }}
    >
      {/* Top row: name + delete */}
      <div className="mb-2 flex items-center justify-between">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="flex-1 bg-transparent text-[16px] font-semibold outline-none focus:border-b focus:border-[var(--sw-accent)]"
          style={{ color: "var(--sw-text-primary)" }}
        />
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="ml-2 text-[14px] transition-colors hover:text-[var(--sw-text-primary)]"
            style={{ color: "var(--sw-text-muted)" }}
          >
            ✕
          </button>
        ) : (
          <span className="ml-2 flex items-center gap-2 text-[14px]">
            <span style={{ color: "var(--sw-text-secondary)" }}>Remove?</span>
            <button
              onClick={() => onDelete(service.id)}
              className="font-medium"
              style={{ color: "var(--sw-accent)" }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ color: "var(--sw-text-muted)" }}
            >
              Cancel
            </button>
          </span>
        )}
      </div>

      {/* Price + Duration */}
      <div className="mb-2 text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
        {service.price !== undefined ? (
          <span>${service.price}</span>
        ) : (
          <span style={{ color: "var(--sw-accent)" }}>Needs price</span>
        )}
        {service.duration !== undefined && <span> · {service.duration} min</span>}
      </div>

      {/* Booking behavior */}
      <select
        value={service.bookingBehavior}
        onChange={(e) => handleBookingChange(e.target.value as BookingBehavior)}
        className="h-[32px] rounded border bg-transparent px-2 text-[14px] outline-none"
        style={{
          borderColor: "var(--sw-border)",
          color: "var(--sw-text-secondary)",
        }}
      >
        {BOOKING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Source indicator */}
      {isScanSourced && service.status !== "ready" && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--sw-text-muted)" }}>
          from website
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run service-card.test`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/onboarding/service-card.tsx apps/dashboard/src/components/onboarding/__tests__/service-card.test.tsx
git commit -m "$(cat <<'EOF'
feat: add ServiceCard component for playbook services

Editable service card with inline name editing, booking behavior
dropdown, price display, delete confirmation, and scan-source tint.
EOF
)"
```

---

### Task 11: ApprovalScenario Component

**Files:**

- Create: `apps/dashboard/src/components/onboarding/approval-scenario.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/approval-scenario.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/approval-scenario.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalScenario } from "../approval-scenario";

describe("ApprovalScenario", () => {
  it("renders scenario question and options", () => {
    render(
      <ApprovalScenario
        question="A customer wants to book Thursday 2pm."
        prompt="What should Alex do?"
        options={[
          { label: "Alex books it, then notifies me", value: "book_then_notify" },
          { label: "Alex asks me before booking", value: "ask_before_booking" },
          { label: "Alex books if open, asks me if something looks off", value: "book_if_open_ask_if_odd" },
        ]}
        selected={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("A customer wants to book Thursday 2pm.")).toBeTruthy();
    expect(screen.getByText("Alex books it, then notifies me")).toBeTruthy();
  });

  it("highlights selected option with accent border", () => {
    const { container } = render(
      <ApprovalScenario
        question="A customer wants to book Thursday 2pm."
        prompt="What should Alex do?"
        options={[
          { label: "Alex books it", value: "book_then_notify" },
          { label: "Alex asks me", value: "ask_before_booking" },
        ]}
        selected="ask_before_booking"
        onChange={vi.fn()}
      />,
    );
    const options = container.querySelectorAll("[data-scenario-option]");
    const selectedOption = Array.from(options).find(
      (el) => el.getAttribute("data-value") === "ask_before_booking",
    );
    expect(selectedOption).toBeTruthy();
  });

  it("calls onChange when an option is clicked", () => {
    const onChange = vi.fn();
    render(
      <ApprovalScenario
        question="Test"
        prompt="Test"
        options={[
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ]}
        selected={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Option A"));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run approval-scenario.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/approval-scenario.tsx
"use client";

interface ScenarioOption {
  label: string;
  value: string;
}

interface ApprovalScenarioProps {
  question: string;
  prompt: string;
  options: ScenarioOption[];
  selected: string | undefined;
  onChange: (value: string) => void;
}

export function ApprovalScenario({
  question,
  prompt,
  options,
  selected,
  onChange,
}: ApprovalScenarioProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[16px] font-medium" style={{ color: "var(--sw-text-primary)" }}>
          {question}
        </p>
        <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
          {prompt}
        </p>
      </div>

      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              data-scenario-option
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200"
              style={{
                borderColor: isSelected ? "var(--sw-accent)" : "var(--sw-border)",
                borderLeftWidth: isSelected ? "3px" : "1px",
                borderLeftColor: isSelected ? "var(--sw-accent)" : undefined,
                backgroundColor: "white",
              }}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                style={{
                  borderColor: isSelected ? "var(--sw-accent)" : "var(--sw-border)",
                }}
              >
                {isSelected && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--sw-accent)" }}
                  />
                )}
              </span>
              <span className="text-[14px]" style={{ color: "var(--sw-text-primary)" }}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run approval-scenario.test`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/onboarding/approval-scenario.tsx apps/dashboard/src/components/onboarding/__tests__/approval-scenario.test.tsx
git commit -m "$(cat <<'EOF'
feat: add ApprovalScenario component for scenario-driven config

Interactive scenario cards where users choose Alex's behavior through
real business situations instead of abstract toggles.
EOF
)"
```

---

### Task 12: ChatMessage + AlexChat Components

**Files:**

- Create: `apps/dashboard/src/components/onboarding/chat-message.tsx`
- Create: `apps/dashboard/src/components/onboarding/alex-chat.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlexChat } from "../alex-chat";

describe("AlexChat", () => {
  it("renders messages", () => {
    render(
      <AlexChat
        messages={[
          { id: "1", role: "alex", text: "Hello! Let's set up your playbook." },
          { id: "2", role: "user", text: "Sure, let's go." },
        ]}
        onSendMessage={vi.fn()}
        isTyping={false}
      />,
    );
    expect(screen.getByText("Hello! Let's set up your playbook.")).toBeTruthy();
    expect(screen.getByText("Sure, let's go.")).toBeTruthy();
  });

  it("shows typing indicator when isTyping is true", () => {
    render(
      <AlexChat
        messages={[]}
        onSendMessage={vi.fn()}
        isTyping={true}
      />,
    );
    expect(screen.getByTestId("typing-indicator")).toBeTruthy();
  });

  it("calls onSendMessage when user submits", () => {
    const onSend = vi.fn();
    render(
      <AlexChat messages={[]} onSendMessage={onSend} isTyping={false} />,
    );
    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("clears input after sending", () => {
    render(
      <AlexChat messages={[]} onSendMessage={vi.fn()} isTyping={false} />,
    );
    const input = screen.getByPlaceholderText("Type a message...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run alex-chat.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write ChatMessage**

```tsx
// apps/dashboard/src/components/onboarding/chat-message.tsx
"use client";

import { AgentMark } from "@/components/character/agent-mark";

export interface ChatMessageData {
  id: string;
  role: "alex" | "user";
  text: string;
  isFirstInCluster?: boolean;
}

interface ChatMessageProps {
  message: ChatMessageData;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isAlex = message.role === "alex";

  return (
    <div className={`flex gap-2 ${isAlex ? "justify-start" : "justify-end"}`}>
      {isAlex && message.isFirstInCluster && (
        <div className="mt-1 shrink-0">
          <AgentMark agent="alex" size="xs" />
        </div>
      )}
      {isAlex && !message.isFirstInCluster && <div className="w-6 shrink-0" />}

      <div
        className="max-w-[85%] rounded-2xl px-4 py-3 text-[16px] leading-[24px]"
        style={
          isAlex
            ? {
                backgroundColor: "var(--sw-surface-raised)",
                color: "var(--sw-text-primary)",
              }
            : {
                backgroundColor: "rgba(160, 120, 80, 0.1)",
                color: "var(--sw-accent)",
              }
        }
      >
        {message.text}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write AlexChat**

```tsx
// apps/dashboard/src/components/onboarding/alex-chat.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { ChatMessage, type ChatMessageData } from "./chat-message";

interface AlexChatProps {
  messages: ChatMessageData[];
  onSendMessage: (text: string) => void;
  isTyping: boolean;
}

export function AlexChat({ messages, onSendMessage, isTyping }: AlexChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    if (isAtBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const messagesWithClusters = messages.map((msg, i) => ({
    ...msg,
    isFirstInCluster: i === 0 || messages[i - 1].role !== msg.role,
  }));

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messagesWithClusters.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="flex items-center gap-2" data-testid="typing-indicator">
            <div className="w-6 shrink-0">
              <AgentMark agent="alex" size="xs" />
            </div>
            <div
              className="rounded-2xl px-4 py-3"
              style={{ backgroundColor: "var(--sw-surface-raised)" }}
            >
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_0ms] rounded-full bg-[var(--sw-text-muted)]" />
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_200ms] rounded-full bg-[var(--sw-text-muted)]" />
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_400ms] rounded-full bg-[var(--sw-text-muted)]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-4" style={{ borderColor: "var(--sw-border)" }}>
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-[48px] w-full rounded-lg border bg-transparent px-4 text-[16px] outline-none transition-colors focus:border-[var(--sw-accent)]"
          style={{
            borderColor: "var(--sw-border)",
            color: "var(--sw-text-primary)",
          }}
        />
      </div>
    </div>
  );
}

import { AgentMark } from "@/components/character/agent-mark";
```

Note: Move the `AgentMark` import to the top of the file with the other imports.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run alex-chat.test`
Expected: PASS — all 4 tests

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/onboarding/chat-message.tsx apps/dashboard/src/components/onboarding/alex-chat.tsx apps/dashboard/src/components/onboarding/__tests__/alex-chat.test.tsx
git commit -m "$(cat <<'EOF'
feat: add AlexChat and ChatMessage components

Chat panel with message clustering, typing indicator, auto-scroll,
and keyboard input. Uses existing AgentMark for Alex avatar.
EOF
)"
```

---

### Task 13: PlaybookPanel Component

**Files:**

- Create: `apps/dashboard/src/components/onboarding/playbook-panel.tsx`

- [ ] **Step 1: Write the component**

This component composes PlaybookSection, ServiceCard, and ApprovalScenario into the full playbook panel. It's a presentational component — all state comes from props.

```tsx
// apps/dashboard/src/components/onboarding/playbook-panel.tsx
"use client";

import { PlaybookSection } from "./playbook-section";
import { ServiceCard } from "./service-card";
import { ApprovalScenario } from "./approval-scenario";
import type { Playbook, PlaybookService } from "@switchboard/schemas";

interface PlaybookPanelProps {
  playbook: Playbook;
  businessName: string;
  onUpdateSection: (section: keyof Playbook, data: unknown) => void;
  onUpdateService: (service: PlaybookService) => void;
  onDeleteService: (id: string) => void;
  onAddService: () => void;
  highlightedSection?: string;
}

const BOOKING_SCENARIOS = [
  {
    question: "A customer wants to book Thursday 2pm.",
    prompt: "What should Alex do?",
    field: "bookingApproval" as const,
    options: [
      { label: "Alex books it, then notifies me", value: "book_then_notify" },
      { label: "Alex asks me before booking", value: "ask_before_booking" },
      {
        label: "Alex books if open, asks me if something looks off",
        value: "book_if_open_ask_if_odd",
      },
    ],
  },
  {
    question: "A customer asks about a service you offer but doesn't mention price.",
    prompt: "How should Alex handle it?",
    field: "pricingApproval" as const,
    options: [
      { label: "Alex quotes the price from the playbook", value: "quote_from_playbook" },
      {
        label: 'Alex describes the service but says "I\'ll confirm pricing for you"',
        value: "describe_but_confirm_pricing",
      },
      {
        label: "Alex always asks me before discussing pricing",
        value: "always_ask_before_pricing",
      },
    ],
  },
];

export function PlaybookPanel({
  playbook,
  businessName,
  onUpdateSection,
  onUpdateService,
  onDeleteService,
  onAddService,
  highlightedSection,
}: PlaybookPanelProps) {
  return (
    <div
      className="h-full overflow-y-auto p-8"
      style={{ backgroundColor: "var(--sw-surface-raised)" }}
    >
      {/* Header */}
      <div className="mb-8">
        <p
          className="text-[13px] font-medium uppercase tracking-[0.05em]"
          style={{ color: "var(--sw-text-muted)" }}
        >
          Alex&apos;s Playbook
        </p>
        <h2
          className="mt-1 text-[20px] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--sw-text-primary)",
          }}
        >
          for {businessName || "Your Business"}
        </h2>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {/* Business Identity */}
        <PlaybookSection
          title="Business Identity"
          status={playbook.businessIdentity.status}
          required
          defaultCollapsed={playbook.businessIdentity.status === "missing"}
          highlight={highlightedSection === "businessIdentity"}
        >
          <div className="space-y-3 text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
            {playbook.businessIdentity.name && (
              <p>
                <strong>{playbook.businessIdentity.name}</strong>
              </p>
            )}
            {playbook.businessIdentity.category && (
              <p style={{ color: "var(--sw-text-secondary)" }}>
                {playbook.businessIdentity.category}
                {playbook.businessIdentity.location && ` · ${playbook.businessIdentity.location}`}
              </p>
            )}
          </div>
        </PlaybookSection>

        {/* Services */}
        <PlaybookSection
          title="Services"
          status={
            playbook.services.length > 0 && playbook.services.some((s) => s.status === "ready")
              ? "ready"
              : playbook.services.length > 0
                ? "check_this"
                : "missing"
          }
          required
          defaultCollapsed={playbook.services.length === 0}
          highlight={highlightedSection === "services"}
        >
          <div className="space-y-3">
            {playbook.services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                onChange={onUpdateService}
                onDelete={onDeleteService}
              />
            ))}
            <button
              onClick={onAddService}
              className="w-full rounded-lg border border-dashed py-3 text-[14px] transition-colors hover:border-[var(--sw-accent)] hover:text-[var(--sw-accent)]"
              style={{
                borderColor: "var(--sw-border)",
                color: "var(--sw-text-muted)",
              }}
            >
              + Add service
            </button>
          </div>
        </PlaybookSection>

        {/* Hours */}
        <PlaybookSection
          title="Hours & Availability"
          status={playbook.hours.status}
          required
          defaultCollapsed={playbook.hours.status === "missing"}
          highlight={highlightedSection === "hours"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-secondary)" }}>
            {Object.entries(playbook.hours.schedule).length > 0 ? (
              <div className="space-y-1">
                {Object.entries(playbook.hours.schedule).map(([day, hours]) => (
                  <p key={day}>
                    <span className="inline-block w-12 font-medium capitalize">{day}</span>
                    <span>{hours}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--sw-text-muted)" }}>No hours set yet</p>
            )}
          </div>
        </PlaybookSection>

        {/* Booking Rules */}
        <PlaybookSection
          title="Booking Rules"
          status={playbook.bookingRules.status}
          required
          defaultCollapsed={playbook.bookingRules.status === "missing"}
          highlight={highlightedSection === "bookingRules"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-secondary)" }}>
            {playbook.bookingRules.leadVsBooking || (
              <span style={{ color: "var(--sw-text-muted)" }}>Not configured yet</span>
            )}
          </div>
        </PlaybookSection>

        {/* Approval Mode */}
        <PlaybookSection
          title="Approval Mode"
          status={playbook.approvalMode.status}
          required
          defaultCollapsed={playbook.approvalMode.status === "missing"}
          highlight={highlightedSection === "approvalMode"}
        >
          <div className="space-y-6">
            {BOOKING_SCENARIOS.map((scenario) => (
              <ApprovalScenario
                key={scenario.field}
                question={scenario.question}
                prompt={scenario.prompt}
                options={scenario.options}
                selected={playbook.approvalMode[scenario.field] as string | undefined}
                onChange={(value) => {
                  const updated = {
                    ...playbook.approvalMode,
                    [scenario.field]: value,
                    status: "ready" as const,
                    source: "manual" as const,
                  };
                  onUpdateSection("approvalMode", updated);
                }}
              />
            ))}
          </div>
        </PlaybookSection>

        {/* Escalation (recommended) */}
        <PlaybookSection
          title="Escalation"
          status={playbook.escalation.status}
          required={false}
          defaultCollapsed={playbook.escalation.status === "missing"}
          highlight={highlightedSection === "escalation"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            {playbook.escalation.triggers.length > 0
              ? playbook.escalation.triggers.join(", ")
              : "No escalation rules set"}
          </div>
        </PlaybookSection>

        {/* Channels (recommended) */}
        <PlaybookSection
          title="Channels"
          status={playbook.channels.status}
          required={false}
          defaultCollapsed={playbook.channels.status === "missing"}
          highlight={highlightedSection === "channels"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            {playbook.channels.configured.length > 0
              ? playbook.channels.configured.join(", ")
              : "Configured during Go Live"}
          </div>
        </PlaybookSection>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/onboarding/playbook-panel.tsx
git commit -m "$(cat <<'EOF'
feat: add PlaybookPanel component composing all playbook sections

Full playbook view with Business Identity, Services, Hours, Booking Rules,
Approval Mode (scenario-driven), Escalation, and Channels sections.
EOF
)"
```

---

### Task 14: TrainingShell — Split-Screen Layout (Screen 2)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/training-shell.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/training-shell.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/training-shell.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainingShell } from "../training-shell";
import { createEmptyPlaybook } from "@switchboard/schemas";

describe("TrainingShell", () => {
  it("renders chat and playbook panels on desktop", () => {
    render(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl={null}
        category={null}
      />,
    );
    expect(screen.getByText(/Alex's Playbook/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("Type a message...")).toBeTruthy();
  });

  it("shows readiness indicator", () => {
    render(
      <TrainingShell
        playbook={createEmptyPlaybook()}
        onUpdatePlaybook={vi.fn()}
        onAdvance={vi.fn()}
        scanUrl={null}
        category={null}
      />,
    );
    expect(screen.getByText(/0 of 5 required sections ready/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run training-shell.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

```tsx
// apps/dashboard/src/components/onboarding/training-shell.tsx
"use client";

import { useState, useCallback } from "react";
import { AlexChat, type ChatMessageData } from "./alex-chat";
import { PlaybookPanel } from "./playbook-panel";
import { InterviewEngine } from "@/lib/interview-engine";
import { getReadinessLabel, isPlaybookReady } from "@/lib/playbook-utils";
import { Button } from "@/components/ui/button";
import type { Playbook, PlaybookService } from "@switchboard/schemas";

interface TrainingShellProps {
  playbook: Playbook;
  onUpdatePlaybook: (playbook: Playbook) => void;
  onAdvance: () => void;
  scanUrl: string | null;
  category: string | null;
}

export function TrainingShell({
  playbook,
  onUpdatePlaybook,
  onAdvance,
  scanUrl,
  category,
}: TrainingShellProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>(() => {
    const initial: ChatMessageData[] = [];
    if (scanUrl) {
      initial.push({
        id: "scan-start",
        role: "alex",
        text: `Looking at ${scanUrl} now...`,
      });
    } else {
      initial.push({
        id: "intro",
        role: "alex",
        text: "No problem. Let's build your playbook together. What's your business called, and what do you do?",
      });
    }
    return initial;
  });
  const [isTyping, setIsTyping] = useState(false);
  const [highlightedSection, setHighlightedSection] = useState<string>();
  const [engine] = useState(() => new InterviewEngine(playbook, category ?? undefined));

  const ready = isPlaybookReady(playbook);
  const readinessLabel = getReadinessLabel(playbook);

  const handleSendMessage = useCallback(
    (text: string) => {
      const userMsg: ChatMessageData = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
      };
      setMessages((prev) => [...prev, userMsg]);

      setIsTyping(true);
      setTimeout(() => {
        const nextQuestion = engine.getNextQuestion();
        if (nextQuestion) {
          engine.markAsked(nextQuestion.targetSection);
          const alexMsg: ChatMessageData = {
            id: `alex-${Date.now()}`,
            role: "alex",
            text: nextQuestion.prompt,
          };
          setMessages((prev) => [...prev, alexMsg]);
          setHighlightedSection(nextQuestion.targetSection);
          setTimeout(() => setHighlightedSection(undefined), 600);
        }
        setIsTyping(false);
      }, 1000);
    },
    [engine],
  );

  const handleUpdateSection = useCallback(
    (section: keyof Playbook, data: unknown) => {
      const updated = { ...playbook, [section]: data };
      onUpdatePlaybook(updated);
    },
    [playbook, onUpdatePlaybook],
  );

  const handleUpdateService = useCallback(
    (service: PlaybookService) => {
      const updated = {
        ...playbook,
        services: playbook.services.map((s) => (s.id === service.id ? service : s)),
      };
      onUpdatePlaybook(updated);
    },
    [playbook, onUpdatePlaybook],
  );

  const handleDeleteService = useCallback(
    (id: string) => {
      const updated = {
        ...playbook,
        services: playbook.services.filter((s) => s.id !== id),
      };
      onUpdatePlaybook(updated);
    },
    [playbook, onUpdatePlaybook],
  );

  const handleAddService = useCallback(() => {
    const newService: PlaybookService = {
      id: `svc-${Date.now()}`,
      name: "",
      bookingBehavior: "ask_first",
      status: "missing",
      source: "manual",
    };
    const updated = {
      ...playbook,
      services: [...playbook.services, newService],
    };
    onUpdatePlaybook(updated);
  }, [playbook, onUpdatePlaybook]);

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--sw-border)" }}
      >
        <span
          className="text-[16px] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--sw-text-primary)",
          }}
        >
          Switchboard
        </span>
        <span
          className="text-[14px]"
          style={{
            color: ready ? "hsl(145, 45%, 42%)" : "var(--sw-text-secondary)",
          }}
        >
          {readinessLabel}
        </span>
      </div>

      {/* Split panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat — 45% */}
        <div className="w-[45%] border-r" style={{ borderColor: "var(--sw-border)" }}>
          <AlexChat messages={messages} onSendMessage={handleSendMessage} isTyping={isTyping} />
        </div>

        {/* Playbook — 55% */}
        <div className="w-[55%]">
          <PlaybookPanel
            playbook={playbook}
            businessName={playbook.businessIdentity.name}
            onUpdateSection={handleUpdateSection}
            onUpdateService={handleUpdateService}
            onDeleteService={handleDeleteService}
            onAddService={handleAddService}
            highlightedSection={highlightedSection}
          />
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex h-[64px] items-center justify-end border-t px-6"
        style={{
          backgroundColor: "var(--sw-surface-raised)",
          borderColor: "var(--sw-border)",
        }}
      >
        {ready ? (
          <div className="flex items-center gap-3">
            <span className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
              Playbook ready.
            </span>
            <Button
              onClick={onAdvance}
              className="h-[48px] rounded-lg px-6 text-[16px] font-medium"
              style={{
                backgroundColor: "var(--sw-text-primary)",
                color: "white",
              }}
            >
              Try Alex →
            </Button>
          </div>
        ) : (
          <span className="text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            Complete the sections marked &quot;Missing&quot; to continue
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into onboarding page**

Update `apps/dashboard/src/app/(auth)/onboarding/page.tsx` — replace the Screen 2 placeholder with:

```typescript
case 2:
  return (
    <TrainingShell
      playbook={playbook}
      onUpdatePlaybook={(updated) => handleUpdatePlaybook({ playbook: updated })}
      onAdvance={() => handleUpdatePlaybook({ step: 3 })}
      scanUrl={null}
      category={null}
    />
  );
```

Add the import at the top:

```typescript
import { TrainingShell } from "@/components/onboarding/training-shell";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run training-shell.test`
Expected: PASS — both tests

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/onboarding/training-shell.tsx apps/dashboard/src/components/onboarding/__tests__/training-shell.test.tsx apps/dashboard/src/app/\(auth\)/onboarding/page.tsx
git commit -m "$(cat <<'EOF'
feat: add TrainingShell split-screen layout (Screen 2)

45/55 split with AlexChat on left and PlaybookPanel on right.
Readiness indicator in top bar, sticky footer with gated CTA.
EOF
)"
```

---

## Phase 3: Lightweight Scan

### Task 15: Website Scan Schema + API Route

**Files:**

- Create: `packages/schemas/src/website-scan.ts`
- Create: `apps/api/src/routes/website-scan.ts`
- Create: `apps/dashboard/src/app/api/dashboard/website-scan/route.ts`
- Create: `apps/dashboard/src/hooks/use-website-scan.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`

- [ ] **Step 1: Write the scan schema**

```typescript
// packages/schemas/src/website-scan.ts
import { z } from "zod";

export const ScanRequestSchema = z.object({
  url: z.string().url(),
  sourceType: z.enum(["website", "instagram", "google_business", "facebook"]).default("website"),
});
export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const ScanConfidence = z.enum(["high", "medium", "low"]);
export type ScanConfidence = z.infer<typeof ScanConfidence>;

export const ScanResultSchema = z.object({
  businessName: z.object({ value: z.string(), confidence: ScanConfidence }).optional(),
  category: z.object({ value: z.string(), confidence: ScanConfidence }).optional(),
  location: z.object({ value: z.string(), confidence: ScanConfidence }).optional(),
  services: z
    .array(
      z.object({
        name: z.string(),
        price: z.number().optional(),
        duration: z.number().optional(),
        confidence: ScanConfidence,
      }),
    )
    .default([]),
  hours: z.record(z.string()).optional(),
  contactMethods: z.array(z.string()).default([]),
  faqHints: z.array(z.string()).default([]),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
```

- [ ] **Step 2: Export from barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./website-scan.js";
```

- [ ] **Step 3: Write the API route**

```typescript
// apps/api/src/routes/website-scan.ts
import type { FastifyPluginAsync } from "fastify";
import { ScanRequestSchema, type ScanResult } from "@switchboard/schemas";
import Anthropic from "@anthropic-ai/sdk";

const EXTRACTION_PROMPT = `You are extracting structured business information from a website page.
Return a JSON object with these fields (omit any you can't determine):
- businessName: { value: string, confidence: "high"|"medium"|"low" }
- category: { value: string, confidence: "high"|"medium"|"low" }
- location: { value: string, confidence: "high"|"medium"|"low" }
- services: [{ name: string, price?: number, duration?: number, confidence: "high"|"medium"|"low" }]
- hours: { mon?: "HH:MM-HH:MM", tue?: "HH:MM-HH:MM", ... }
- contactMethods: string[]
- faqHints: string[]

Only include information you can clearly identify. Set confidence to "high" when explicitly stated, "medium" when reasonably inferred, "low" when uncertain.
Return ONLY valid JSON, no markdown.`;

const websiteScanRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/website-scan", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = ScanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const { url } = parsed.data;

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "SwitchboardBot/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return reply.send({
          result: { services: [], contactMethods: [], faqHints: [] },
          error: "Could not fetch page",
        });
      }

      const html = await response.text();
      const textContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);

      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: EXTRACTION_PROMPT,
        messages: [
          {
            role: "user",
            content: `Extract business information from this website content:\n\n${textContent}`,
          },
        ],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        return reply.send({ result: { services: [], contactMethods: [], faqHints: [] } });
      }

      const extracted: ScanResult = JSON.parse(content.text);
      return reply.send({ result: extracted });
    } catch (err) {
      app.log.warn({ err, url }, "Website scan failed");
      return reply.send({
        result: { services: [], contactMethods: [], faqHints: [] },
        error: "Scan failed — we'll build your playbook from questions instead",
      });
    }
  });
};

export default websiteScanRoutes;
```

- [ ] **Step 4: Register route and write proxy + hook**

Register in `apps/api/src/server.ts`:

```typescript
import websiteScanRoutes from "./routes/website-scan.js";
// ... app.register(websiteScanRoutes);
```

Dashboard proxy (`apps/dashboard/src/app/api/dashboard/website-scan/route.ts`):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.scanWebsite(body);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

Add to `api-client.ts`:

```typescript
async scanWebsite(body: { url: string; sourceType?: string }): Promise<{ result: ScanResult; error?: string }> {
  return this.post("/api/website-scan", body);
}
```

Add to `query-keys.ts`:

```typescript
scan: {
  all: ["scan"] as const,
},
```

Hook (`apps/dashboard/src/hooks/use-website-scan.ts`):

```typescript
"use client";

import { useMutation } from "@tanstack/react-query";
import type { ScanResult } from "@switchboard/schemas";

interface ScanResponse {
  result: ScanResult;
  error?: string;
}

async function scanWebsite(url: string): Promise<ScanResponse> {
  const res = await fetch("/api/dashboard/website-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("Scan failed");
  return res.json();
}

export function useWebsiteScan() {
  return useMutation({ mutationFn: scanWebsite });
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/website-scan.ts packages/schemas/src/index.ts apps/api/src/routes/website-scan.ts apps/api/src/server.ts apps/dashboard/src/app/api/dashboard/website-scan/route.ts apps/dashboard/src/hooks/use-website-scan.ts apps/dashboard/src/lib/api-client.ts apps/dashboard/src/lib/query-keys.ts
git commit -m "$(cat <<'EOF'
feat: add lightweight website scan — fetch + Claude extraction

Fetches homepage, strips HTML, sends to Claude Haiku for structured
extraction with confidence levels. Graceful fallback on failure.
EOF
)"
```

---

## Phase 4: Test Center

### Task 16: PromptCard + TestCenter Components (Screen 3)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/prompt-card.tsx`
- Create: `apps/dashboard/src/components/onboarding/test-center.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx`
- Create: `apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx`
- Modify: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestCenter } from "../test-center";

const mockPrompts = [
  {
    id: "p1",
    category: "BOOKING",
    text: "I'd like to book a teeth whitening session. Do you have anything this Saturday?",
    recommended: true,
  },
  {
    id: "p2",
    category: "PRICING",
    text: "How much is an Invisalign consultation?",
    recommended: false,
  },
];

describe("TestCenter", () => {
  it("renders page title and prompts", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText("Try Alex with real scenarios")).toBeTruthy();
    expect(screen.getByText(/teeth whitening/i)).toBeTruthy();
  });

  it("marks recommended prompt with 'Start here' badge", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText("Start here")).toBeTruthy();
  });

  it("shows empty state before any prompt is sent", () => {
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={vi.fn()}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    expect(screen.getByText(/send a scenario/i)).toBeTruthy();
  });

  it("calls onSendPrompt when prompt card is clicked", () => {
    const onSend = vi.fn();
    render(
      <TestCenter
        prompts={mockPrompts}
        onSendPrompt={onSend}
        onAdvance={vi.fn()}
        responses={[]}
        isSimulating={false}
      />,
    );
    fireEvent.click(screen.getByText(/teeth whitening/i));
    expect(onSend).toHaveBeenCalledWith(mockPrompts[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run test-center.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write PromptCard**

```tsx
// apps/dashboard/src/components/onboarding/prompt-card.tsx
"use client";

export interface TestPrompt {
  id: string;
  category: string;
  text: string;
  recommended: boolean;
}

interface PromptCardProps {
  prompt: TestPrompt;
  isActive: boolean;
  isTested: boolean;
  onClick: () => void;
}

export function PromptCard({ prompt, isActive, isTested, onClick }: PromptCardProps) {
  return (
    <div>
      {prompt.recommended && (
        <span
          className="mb-1 inline-block rounded-full px-2 py-0.5 text-[12px]"
          style={{
            color: "var(--sw-accent)",
            backgroundColor: "rgba(160, 120, 80, 0.1)",
          }}
        >
          Start here
        </span>
      )}
      <button
        onClick={onClick}
        className="w-full rounded-lg border p-4 text-left text-[14px] transition-all duration-200"
        style={{
          borderColor: isActive ? "var(--sw-accent)" : "var(--sw-border)",
          borderLeftWidth: isActive ? "3px" : "1px",
          borderLeftColor: isActive ? "var(--sw-accent)" : undefined,
          backgroundColor: "var(--sw-surface-raised)",
          color: "var(--sw-text-primary)",
        }}
      >
        <span className="line-clamp-2">{prompt.text}</span>
        {isTested && (
          <span className="mt-1 block text-[12px]" style={{ color: "var(--sw-text-muted)" }}>
            ✓
          </span>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write FixThisSlideOver**

```tsx
// apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx
"use client";

import { useState } from "react";

type FixType = "wrong_info" | "tone_off" | "missing_context";

interface FixThisSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  onFix: (type: FixType, value: string) => void;
}

const FIX_OPTIONS: { type: FixType; label: string; description: string }[] = [
  {
    type: "wrong_info",
    label: "Wrong information",
    description: "The facts in this response are incorrect",
  },
  { type: "tone_off", label: "Tone is off", description: "Alex should say this differently" },
  {
    type: "missing_context",
    label: "Missing context",
    description: "Alex should know something it doesn't",
  },
];

export function FixThisSlideOver({ isOpen, onClose, onFix }: FixThisSlideOverProps) {
  const [selectedType, setSelectedType] = useState<FixType | null>(null);
  const [input, setInput] = useState("");

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (selectedType && input.trim()) {
      onFix(selectedType, input.trim());
      setSelectedType(null);
      setInput("");
      onClose();
    }
  };

  return (
    <div
      className="absolute right-0 top-0 h-full w-[320px] border-l bg-white transition-transform duration-200"
      style={{ borderColor: "var(--sw-border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b p-4"
        style={{ borderColor: "var(--sw-border)" }}
      >
        <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
          What needs fixing?
        </span>
        <button onClick={onClose} className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
          ✕
        </button>
      </div>

      {!selectedType ? (
        <div>
          {FIX_OPTIONS.map((option) => (
            <button
              key={option.type}
              onClick={() => setSelectedType(option.type)}
              className="w-full border-b p-4 text-left transition-colors hover:bg-[var(--sw-surface)]"
              style={{ borderColor: "var(--sw-border)" }}
            >
              <p className="text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
                {option.label}
              </p>
              <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
                {option.description}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <label className="mb-2 block text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
            {selectedType === "tone_off"
              ? "How should Alex have said this?"
              : selectedType === "missing_context"
                ? "What should Alex know here?"
                : "What's incorrect?"}
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-[120px] w-full resize-none rounded-lg border p-4 text-[16px] outline-none focus:border-[var(--sw-accent)]"
            style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-primary)" }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="mt-3 h-[48px] w-full rounded-lg text-[16px] font-medium"
            style={{
              backgroundColor: "var(--sw-text-primary)",
              color: "white",
              opacity: input.trim() ? 1 : 0.4,
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write TestCenter**

```tsx
// apps/dashboard/src/components/onboarding/test-center.tsx
"use client";

import { useState } from "react";
import { PromptCard, type TestPrompt } from "./prompt-card";
import { ChatMessage, type ChatMessageData } from "./chat-message";
import { FixThisSlideOver } from "./fix-this-slide-over";
import { AgentMark } from "@/components/character/agent-mark";
import { Button } from "@/components/ui/button";

interface SimulatedResponse {
  promptId: string;
  userMessage: string;
  alexMessage: string;
  annotations: string[];
  status: "pending" | "good" | "fixed";
}

interface TestCenterProps {
  prompts: TestPrompt[];
  onSendPrompt: (prompt: TestPrompt) => void;
  onAdvance: () => void;
  responses: SimulatedResponse[];
  isSimulating: boolean;
}

export function TestCenter({
  prompts,
  onSendPrompt,
  onAdvance,
  responses,
  isSimulating,
}: TestCenterProps) {
  const [activePromptId, setActivePromptId] = useState<string>();
  const [customInput, setCustomInput] = useState("");
  const [fixingResponseId, setFixingResponseId] = useState<string>();
  const [expandedAnnotation, setExpandedAnnotation] = useState<string>();

  const testedIds = new Set(responses.map((r) => r.promptId));
  const testedCount = testedIds.size;

  const groupedPrompts = prompts.reduce<Record<string, TestPrompt[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  const handlePromptClick = (prompt: TestPrompt) => {
    setActivePromptId(prompt.id);
    onSendPrompt(prompt);
  };

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      {/* Top bar */}
      <div className="border-b px-6 py-3" style={{ borderColor: "var(--sw-border)" }}>
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
      </div>

      {/* Title */}
      <div className="px-6 pb-2 pt-8">
        <h1
          className="text-[32px] font-semibold leading-[40px]"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Try Alex with real scenarios
        </h1>
        <p className="mt-2 text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
          These scenarios use your actual services and rules.
        </p>
      </div>

      {/* Panels */}
      <div className="flex flex-1 overflow-hidden px-6 pb-6">
        {/* Left: prompts — 40% */}
        <div className="w-[40%] overflow-y-auto pr-6">
          {Object.entries(groupedPrompts).map(([category, categoryPrompts]) => (
            <div key={category} className="mb-6">
              <p
                className="mb-2 text-[13px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--sw-text-muted)" }}
              >
                {category}
              </p>
              <div className="space-y-2">
                {categoryPrompts.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    isActive={activePromptId === prompt.id}
                    isTested={testedIds.has(prompt.id)}
                    onClick={() => handlePromptClick(prompt)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Custom input */}
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--sw-border)" }}>
            <p className="mb-2 text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
              Or type your own question
            </p>
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="h-[48px] w-full rounded-lg border bg-transparent px-4 text-[16px] outline-none focus:border-[var(--sw-accent)]"
              style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-primary)" }}
            />
          </div>

          {/* Counter */}
          <p className="mt-4 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            Tested {testedCount} of {prompts.length} scenarios
          </p>
        </div>

        {/* Right: chat — 60% */}
        <div
          className="relative w-[60%] overflow-y-auto rounded-xl border p-6"
          style={{
            backgroundColor: "var(--sw-surface-raised)",
            borderColor: "var(--sw-border)",
          }}
        >
          {responses.length === 0 && !isSimulating ? (
            <div className="flex h-full flex-col items-center justify-center">
              <AgentMark agent="alex" size="md" />
              <p className="mt-4 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
                Send a scenario to see how Alex would respond.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {responses.map((response) => (
                <div key={response.promptId} className="space-y-3">
                  <ChatMessage
                    message={{
                      id: `u-${response.promptId}`,
                      role: "user",
                      text: response.userMessage,
                    }}
                  />
                  <ChatMessage
                    message={{
                      id: `a-${response.promptId}`,
                      role: "alex",
                      text: response.alexMessage,
                      isFirstInCluster: true,
                    }}
                  />

                  {/* Annotations */}
                  <div className="ml-8">
                    <button
                      onClick={() =>
                        setExpandedAnnotation(
                          expandedAnnotation === response.promptId ? undefined : response.promptId,
                        )
                      }
                      className="text-[14px]"
                      style={{ color: "var(--sw-text-muted)" }}
                    >
                      {expandedAnnotation === response.promptId ? "▾" : "▸"} Why this answer?
                    </button>

                    {expandedAnnotation === response.promptId && (
                      <div
                        className="mt-2 rounded-lg border p-3"
                        style={{
                          backgroundColor: "var(--sw-surface)",
                          borderColor: "var(--sw-border)",
                        }}
                      >
                        {response.annotations.map((ann, i) => (
                          <p
                            key={i}
                            className="text-[13px]"
                            style={{ color: "var(--sw-text-muted)" }}
                          >
                            ℹ {ann}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="ml-8 flex gap-6">
                    <button
                      className="text-[14px] transition-colors hover:underline"
                      style={{
                        color:
                          response.status === "good"
                            ? "hsl(145, 45%, 42%)"
                            : "var(--sw-text-secondary)",
                      }}
                    >
                      {response.status === "good" ? "✓ Looks good" : "Looks good"}
                    </button>
                    <button
                      onClick={() => setFixingResponseId(response.promptId)}
                      className="text-[14px] transition-colors hover:underline"
                      style={{ color: "var(--sw-text-secondary)" }}
                    >
                      Fix this
                    </button>
                  </div>
                </div>
              ))}

              {isSimulating && (
                <div className="flex items-center gap-2" data-testid="typing-indicator">
                  <AgentMark agent="alex" size="xs" />
                  <div
                    className="rounded-2xl px-4 py-3"
                    style={{ backgroundColor: "var(--sw-surface-raised)" }}
                  >
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_0ms] rounded-full bg-[var(--sw-text-muted)]" />
                      <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_200ms] rounded-full bg-[var(--sw-text-muted)]" />
                      <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_400ms] rounded-full bg-[var(--sw-text-muted)]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fix slide-over */}
          <FixThisSlideOver
            isOpen={fixingResponseId !== undefined}
            onClose={() => setFixingResponseId(undefined)}
            onFix={(_type, _value) => {
              setFixingResponseId(undefined);
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex h-[64px] items-center justify-end border-t px-6"
        style={{
          backgroundColor: "var(--sw-surface-raised)",
          borderColor: "var(--sw-border)",
        }}
      >
        <Button
          onClick={onAdvance}
          className="h-[48px] rounded-lg px-6 text-[16px] font-medium"
          style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
        >
          Alex is ready. Go live →
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire into onboarding page**

Update the `case 3:` in `apps/dashboard/src/app/(auth)/onboarding/page.tsx`:

```typescript
case 3:
  return (
    <TestCenter
      prompts={[]} // Generated in a later integration step
      onSendPrompt={() => {}}
      onAdvance={() => handleUpdatePlaybook({ step: 4 })}
      responses={[]}
      isSimulating={false}
    />
  );
```

Add import: `import { TestCenter } from "@/components/onboarding/test-center";`

- [ ] **Step 7: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run test-center.test`
Expected: PASS — all 4 tests

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/onboarding/prompt-card.tsx apps/dashboard/src/components/onboarding/test-center.tsx apps/dashboard/src/components/onboarding/fix-this-slide-over.tsx apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx apps/dashboard/src/app/\(auth\)/onboarding/page.tsx
git commit -m "$(cat <<'EOF'
feat: add TestCenter, PromptCard, and FixThisSlideOver (Screen 3)

Test Center with grouped prompt selector, simulated chat panel,
annotation disclosures, action buttons, and correction slide-over.
EOF
)"
```

---

## Phase 5: Go Live + Bridge

### Task 17: GoLive + LaunchSequence + ChannelConnectCard (Screen 4)

**Files:**

- Create: `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`
- Create: `apps/dashboard/src/components/onboarding/launch-sequence.tsx`
- Create: `apps/dashboard/src/components/onboarding/go-live.tsx`
- Create: `apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoLive } from "../go-live";
import { createEmptyPlaybook } from "@switchboard/schemas";

describe("GoLive", () => {
  it("renders page title and checklist", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    playbook.businessIdentity.name = "Test Biz";

    render(
      <GoLive
        playbook={playbook}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={[]}
        scenariosTested={0}
      />,
    );
    expect(screen.getByText("Alex is ready for your business")).toBeTruthy();
    expect(screen.getByText(/required to launch/i)).toBeTruthy();
  });

  it("disables launch button when no channel connected", () => {
    render(
      <GoLive
        playbook={createEmptyPlaybook()}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={[]}
        scenariosTested={0}
      />,
    );
    const button = screen.getByRole("button", { name: /launch alex/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables launch button when a channel is connected", () => {
    render(
      <GoLive
        playbook={createEmptyPlaybook()}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={["whatsapp"]}
        scenariosTested={3}
      />,
    );
    const button = screen.getByRole("button", { name: /launch alex/i });
    expect(button).toHaveProperty("disabled", false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run go-live.test`
Expected: FAIL — module not found

- [ ] **Step 3: Write ChannelConnectCard**

```tsx
// apps/dashboard/src/components/onboarding/channel-connect-card.tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ChannelConnectCardProps {
  channel: string;
  label: string;
  description: string;
  recommended: boolean;
  isConnected: boolean;
  comingSoon: boolean;
  onConnect: (credentials: Record<string, string>) => void;
}

const CHANNEL_FIELDS: Record<string, { label: string; key: string; type: string }[]> = {
  whatsapp: [
    { label: "Phone number", key: "phone", type: "tel" },
    { label: "API key", key: "apiKey", type: "password" },
  ],
  telegram: [{ label: "Bot token", key: "botToken", type: "password" }],
};

export function ChannelConnectCard({
  channel,
  label,
  description,
  recommended,
  isConnected,
  comingSoon,
  onConnect,
}: ChannelConnectCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const channelFields = CHANNEL_FIELDS[channel] ?? [];

  const handleConnect = () => {
    onConnect(fields);
    setExpanded(false);
  };

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: "var(--sw-border)" }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
              {label}
            </span>
            {recommended && (
              <span
                className="rounded-full px-2 py-0.5 text-[12px]"
                style={{ color: "var(--sw-accent)", backgroundColor: "rgba(160, 120, 80, 0.1)" }}
              >
                Recommended
              </span>
            )}
          </div>
          <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
            {description}
          </p>
        </div>

        {comingSoon ? (
          <span className="text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            Coming soon
          </span>
        ) : isConnected ? (
          <span className="text-[14px]" style={{ color: "hsl(145, 45%, 42%)" }}>
            Connected ✓
          </span>
        ) : (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[14px]"
            style={{ color: "var(--sw-accent)" }}
          >
            Connect →
          </button>
        )}
      </div>

      {/* Inline connection form */}
      {expanded && !isConnected && (
        <div className="border-t px-5 py-4" style={{ borderColor: "var(--sw-border)" }}>
          <div className="space-y-3">
            {channelFields.map((field) => (
              <div key={field.key}>
                <label
                  className="mb-1 block text-[14px]"
                  style={{ color: "var(--sw-text-secondary)" }}
                >
                  {field.label}
                </label>
                <Input
                  type={field.type}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })}
                  className="h-[48px]"
                />
              </div>
            ))}
            <Button
              onClick={handleConnect}
              className="h-[48px] rounded-lg px-6 text-[16px]"
              style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
            >
              Connect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write LaunchSequence**

```tsx
// apps/dashboard/src/components/onboarding/launch-sequence.tsx
"use client";

import { useState, useEffect } from "react";

interface LaunchSequenceProps {
  channel: string;
  approvalFirst: boolean;
  onComplete: () => void;
}

type LaunchPhase = "launching" | "channel_live" | "status" | "test_lead" | "done";

export function LaunchSequence({ channel, approvalFirst, onComplete }: LaunchSequenceProps) {
  const [phase, setPhase] = useState<LaunchPhase>("launching");

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("channel_live"), 600),
      setTimeout(() => setPhase("status"), 1200),
      setTimeout(() => setPhase("test_lead"), 2500),
      setTimeout(() => setPhase("done"), 3500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="space-y-6 text-center">
      {/* Channel status */}
      {(phase === "channel_live" ||
        phase === "status" ||
        phase === "test_lead" ||
        phase === "done") && (
        <p
          className="text-[14px] transition-opacity duration-300"
          style={{ color: "hsl(145, 45%, 42%)" }}
        >
          <span
            className="mr-1 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(145, 45%, 42%)" }}
          />
          Live
        </p>
      )}

      {/* Status line */}
      {(phase === "status" || phase === "test_lead" || phase === "done") && (
        <p className="text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
          <span
            className="mr-2 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(145, 45%, 42%)" }}
          />
          Alex is live on {channel}
        </p>
      )}

      {/* Test lead */}
      {(phase === "test_lead" || phase === "done") && (
        <div
          className="mx-auto max-w-[400px] rounded-xl border p-5 text-left"
          style={{
            backgroundColor: "var(--sw-surface-raised)",
            borderColor: "var(--sw-border)",
          }}
        >
          <p
            className="mb-2 text-[12px] font-medium uppercase tracking-[0.05em]"
            style={{ color: "var(--sw-text-muted)" }}
          >
            Test lead
          </p>
          <p className="mb-4 text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
            &ldquo;Hi, I saw your clinic online — do you do teeth whitening?&rdquo;
          </p>
          <button className="text-[14px]" style={{ color: "var(--sw-accent)" }}>
            See Alex&apos;s response →
          </button>
        </div>
      )}

      {/* Dashboard link */}
      {phase === "done" && (
        <button
          onClick={onComplete}
          className="text-[14px]"
          style={{ color: "var(--sw-text-secondary)" }}
        >
          Go to your dashboard →
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write GoLive**

```tsx
// apps/dashboard/src/components/onboarding/go-live.tsx
"use client";

import { useState } from "react";
import { AgentMark } from "@/components/character/agent-mark";
import { ChannelConnectCard } from "./channel-connect-card";
import { LaunchSequence } from "./launch-sequence";
import type { Playbook } from "@switchboard/schemas";

interface GoLiveProps {
  playbook: Playbook;
  onLaunch: () => void;
  onBack: () => void;
  connectedChannels: string[];
  scenariosTested: number;
}

export function GoLive({
  playbook,
  onLaunch,
  onBack,
  connectedChannels,
  scenariosTested,
}: GoLiveProps) {
  const [launched, setLaunched] = useState(false);
  const hasChannel = connectedChannels.length > 0;
  const serviceCount = playbook.services.length;
  const recommended = playbook.channels.recommended ?? "whatsapp";

  const handleLaunch = () => {
    setLaunched(true);
    onLaunch();
  };

  const playbookSummary = [
    `${serviceCount} service${serviceCount !== 1 ? "s" : ""}`,
    playbook.hours.schedule.mon ? "Mon-Sat" : "",
    playbook.approvalMode.bookingApproval === "ask_before_booking" ? "Approval-first" : "Auto-book",
    ...connectedChannels.map((c) => c.charAt(0).toUpperCase() + c.slice(1)),
  ]
    .filter(Boolean)
    .join(" · ");

  if (launched) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "var(--sw-base)" }}
      >
        <LaunchSequence
          channel={connectedChannels[0] ?? "WhatsApp"}
          approvalFirst={playbook.approvalMode.bookingApproval === "ask_before_booking"}
          onComplete={() => {
            /* navigate to dashboard */
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      {/* Wordmark */}
      <div className="fixed left-6 top-6 z-10">
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center" style={{ paddingBottom: "10vh" }}>
        <div className="mx-auto w-full max-w-[520px] px-6 text-center">
          <div className="mb-8 flex justify-center">
            <AgentMark agent="alex" size="lg" />
          </div>

          <h1
            className="mb-10 text-[32px] font-semibold leading-[40px]"
            style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
          >
            Alex is ready for your business
          </h1>

          {/* Required */}
          <div className="mb-8 text-left">
            <p
              className="mb-3 text-[13px] font-medium uppercase tracking-[0.05em]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              Required to launch
            </p>
            <div
              className="mb-1 flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>Playbook complete</span>
              <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>
            </div>
            <div
              className="mb-4 flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>At least one channel connected</span>
              {hasChannel ? <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span> : <span />}
            </div>

            {/* Channel cards */}
            <div className="rounded-xl border" style={{ borderColor: "var(--sw-border)" }}>
              <ChannelConnectCard
                channel="whatsapp"
                label="WhatsApp"
                description="Your customers' primary channel"
                recommended={recommended === "whatsapp"}
                isConnected={connectedChannels.includes("whatsapp")}
                comingSoon={false}
                onConnect={() => {}}
              />
              <ChannelConnectCard
                channel="telegram"
                label="Telegram"
                description="Alternative messaging"
                recommended={recommended === "telegram"}
                isConnected={connectedChannels.includes("telegram")}
                comingSoon={false}
                onConnect={() => {}}
              />
              <ChannelConnectCard
                channel="webchat"
                label="Web Chat"
                description="Embed on your website"
                recommended={false}
                isConnected={false}
                comingSoon={true}
                onConnect={() => {}}
              />
            </div>
          </div>

          {/* Good to have */}
          <div className="mb-8 text-left">
            <p
              className="mb-3 text-[13px] font-medium uppercase tracking-[0.05em]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              Good to have
            </p>
            <div
              className="mb-1 flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>{scenariosTested} scenarios tested</span>
              {scenariosTested > 0 && <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>}
            </div>
            <div
              className="flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>Approval mode reviewed</span>
              {playbook.approvalMode.status === "ready" && (
                <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>
              )}
            </div>
          </div>

          {/* Playbook summary */}
          {playbookSummary && (
            <div
              className="mb-8 rounded-lg p-4 text-[14px]"
              style={{ backgroundColor: "var(--sw-surface)", color: "var(--sw-text-secondary)" }}
            >
              {playbookSummary}
            </div>
          )}

          {/* Launch button */}
          <button
            onClick={handleLaunch}
            disabled={!hasChannel}
            className="h-[52px] min-w-[200px] rounded-lg text-[16px] font-semibold transition-all duration-200"
            style={{
              backgroundColor: "var(--sw-accent)",
              color: "white",
              opacity: hasChannel ? 1 : 0.35,
              cursor: hasChannel ? "pointer" : "default",
            }}
          >
            Launch Alex
          </button>

          {!hasChannel && (
            <p className="mt-2 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
              Connect a channel to launch.
            </p>
          )}

          <div className="mt-4">
            <button
              onClick={onBack}
              className="text-[14px]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              ← Back to training
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire into onboarding page**

Update `case 4:` in the onboarding page:

```typescript
case 4:
  return (
    <GoLive
      playbook={playbook}
      onLaunch={() => {
        updatePlaybook.mutate({
          playbook,
          step: 4,
        });
      }}
      onBack={() => handleUpdatePlaybook({ step: 2 })}
      connectedChannels={[]}
      scenariosTested={0}
    />
  );
```

Add import: `import { GoLive } from "@/components/onboarding/go-live";`

- [ ] **Step 7: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run go-live.test`
Expected: PASS — all 3 tests

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/onboarding/channel-connect-card.tsx apps/dashboard/src/components/onboarding/launch-sequence.tsx apps/dashboard/src/components/onboarding/go-live.tsx apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx apps/dashboard/src/app/\(auth\)/onboarding/page.tsx
git commit -m "$(cat <<'EOF'
feat: add GoLive, LaunchSequence, and ChannelConnectCard (Screen 4)

Launch screen with required/optional checklist, inline channel connection,
recommended channel badge, amber launch CTA, and timed launch animation.
EOF
)"
```

---

### Task 18: FirstRunBanner + Settings Playbook

**Files:**

- Create: `apps/dashboard/src/components/dashboard/first-run-banner.tsx`
- Create: `apps/dashboard/src/components/settings/playbook-view.tsx`
- Create: `apps/dashboard/src/hooks/use-first-run.ts`
- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- Modify: `apps/dashboard/src/components/layout/settings-layout.tsx`

- [ ] **Step 1: Write FirstRunBanner**

```tsx
// apps/dashboard/src/components/dashboard/first-run-banner.tsx
"use client";

import { useState } from "react";

interface FirstRunBannerProps {
  onDismiss: () => void;
}

const ACTIONS = [
  { title: "Review first conversations", href: "/decide", icon: "💬" },
  { title: "Send a test lead", href: "#test-lead", icon: "📨" },
  { title: "Refine your playbook", href: "/settings/playbook", icon: "📋" },
];

export function FirstRunBanner({ onDismiss }: FirstRunBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  return (
    <div
      className="mb-6 rounded-xl border p-6"
      style={{
        backgroundColor: "var(--sw-surface-raised, hsl(40 20% 98%))",
        borderColor: "var(--sw-border, hsl(35 12% 82%))",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          className="text-[16px] font-semibold"
          style={{ color: "var(--sw-text-primary, hsl(30 12% 10%))" }}
        >
          Alex is live. Here are your next best steps.
        </h2>
        <button
          onClick={handleDismiss}
          className="text-[16px]"
          style={{ color: "var(--sw-text-muted, hsl(30 8% 60%))" }}
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACTIONS.map((action) => (
          <a
            key={action.title}
            href={action.href}
            className="rounded-lg border p-4 transition-colors hover:border-[var(--sw-border-strong)]"
            style={{
              borderColor: "var(--sw-border, hsl(35 12% 82%))",
              backgroundColor: "var(--sw-surface, hsl(40 15% 93%))",
            }}
          >
            <p className="text-[14px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
              {action.title}
            </p>
            <span className="mt-2 block text-[14px]" style={{ color: "var(--sw-accent)" }}>
              →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write useFirstRun hook**

```typescript
// apps/dashboard/src/hooks/use-first-run.ts
"use client";

import { useOrgConfig, useUpdateOrgConfig } from "./use-org-config";

interface FirstRunState {
  bannerDismissed: boolean;
  reviewedConversations: boolean;
  sentTestLead: boolean;
  visitedPlaybook: boolean;
}

const DEFAULT_STATE: FirstRunState = {
  bannerDismissed: false,
  reviewedConversations: false,
  sentTestLead: false,
  visitedPlaybook: false,
};

export function useFirstRun() {
  const { data: orgData } = useOrgConfig();
  const updateConfig = useUpdateOrgConfig();

  const firstRunPhase = (orgData?.config?.firstRunPhase as FirstRunState | null) ?? DEFAULT_STATE;
  const isFirstRun = orgData?.config?.onboardingComplete === true && !firstRunPhase.bannerDismissed;

  const updateFirstRun = (updates: Partial<FirstRunState>) => {
    const merged = { ...firstRunPhase, ...updates };
    updateConfig.mutate({ firstRunPhase: merged });
  };

  return {
    isFirstRun,
    state: firstRunPhase,
    dismissBanner: () => updateFirstRun({ bannerDismissed: true }),
    markReviewedConversations: () => updateFirstRun({ reviewedConversations: true }),
    markSentTestLead: () => updateFirstRun({ sentTestLead: true }),
    markVisitedPlaybook: () => updateFirstRun({ visitedPlaybook: true }),
  };
}
```

- [ ] **Step 3: Write PlaybookView for settings**

```tsx
// apps/dashboard/src/components/settings/playbook-view.tsx
"use client";

import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { PlaybookPanel } from "@/components/onboarding/playbook-panel";
import type { PlaybookService } from "@switchboard/schemas";

export function PlaybookView() {
  const { data, isLoading } = usePlaybook();
  const updatePlaybook = useUpdatePlaybook();

  if (isLoading || !data) {
    return (
      <p className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
        Loading playbook...
      </p>
    );
  }

  const { playbook } = data;

  return (
    <div className="-mx-8 -mt-4">
      <PlaybookPanel
        playbook={playbook}
        businessName={playbook.businessIdentity.name}
        onUpdateSection={(section, sectionData) => {
          updatePlaybook.mutate({
            playbook: { ...playbook, [section]: sectionData },
          });
        }}
        onUpdateService={(service: PlaybookService) => {
          updatePlaybook.mutate({
            playbook: {
              ...playbook,
              services: playbook.services.map((s) => (s.id === service.id ? service : s)),
            },
          });
        }}
        onDeleteService={(id: string) => {
          updatePlaybook.mutate({
            playbook: {
              ...playbook,
              services: playbook.services.filter((s) => s.id !== id),
            },
          });
        }}
        onAddService={() => {
          updatePlaybook.mutate({
            playbook: {
              ...playbook,
              services: [
                ...playbook.services,
                {
                  id: `svc-${Date.now()}`,
                  name: "",
                  bookingBehavior: "ask_first" as const,
                  status: "missing" as const,
                  source: "manual" as const,
                },
              ],
            },
          });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add "Your Playbook" to settings nav**

In `apps/dashboard/src/components/layout/settings-layout.tsx`, add a new nav item at the top of the sidebar items array:

```typescript
{ href: "/settings/playbook", label: "Your Playbook", icon: BookOpen }
```

- [ ] **Step 5: Create the settings playbook page**

Create `apps/dashboard/src/app/(auth)/settings/playbook/page.tsx`:

```tsx
import { PlaybookView } from "@/components/settings/playbook-view";

export default function PlaybookSettingsPage() {
  return <PlaybookView />;
}
```

- [ ] **Step 6: Add FirstRunBanner to OwnerToday**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, import and render the banner:

```typescript
import { FirstRunBanner } from "./first-run-banner";
import { useFirstRun } from "@/hooks/use-first-run";
```

Add at the top of the component, before the greeting:

```tsx
const { isFirstRun, dismissBanner } = useFirstRun();

// At the top of the JSX return:
{
  isFirstRun && <FirstRunBanner onDismiss={dismissBanner} />;
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/dashboard/first-run-banner.tsx apps/dashboard/src/hooks/use-first-run.ts apps/dashboard/src/components/settings/playbook-view.tsx apps/dashboard/src/components/layout/settings-layout.tsx apps/dashboard/src/app/\(auth\)/settings/playbook/page.tsx apps/dashboard/src/components/dashboard/owner-today.tsx
git commit -m "$(cat <<'EOF'
feat: add first-run banner, settings playbook view, and useFirstRun hook

Post-launch dashboard overlay with action cards, behavior-based fadeout,
and "Your Playbook" as canonical config surface in settings.
EOF
)"
```

---

## Phase 6: Polish

### Task 19: Motion, Mobile, Empty States, Reduced Motion

**Files:**

- Modify: `apps/dashboard/src/app/globals.css`
- Modify: `apps/dashboard/src/components/onboarding/training-shell.tsx`
- Modify: `apps/dashboard/src/components/onboarding/test-center.tsx`
- Modify: `apps/dashboard/src/components/onboarding/playbook-section.tsx`

- [ ] **Step 1: Add onboarding CSS tokens to globals.css**

Add to the `:root` section of `apps/dashboard/src/app/globals.css`:

```css
/* Onboarding motion */
--transition-structural: 400ms ease-out;
--transition-feedback: 200ms ease-out;
--transition-trust: 600ms ease-in-out;

/* Onboarding ready green */
--sw-ready: hsl(145, 45%, 42%);
```

Add reduced motion support:

```css
@media (prefers-reduced-motion: reduce) {
  .onboarding-tier2,
  .onboarding-tier3 {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 2: Add mobile tabs to TrainingShell**

In `apps/dashboard/src/components/onboarding/training-shell.tsx`, add mobile responsive behavior. Wrap the split panels in a responsive container:

```tsx
// Add state for mobile tab
const [mobileTab, setMobileTab] = useState<"chat" | "playbook">("chat");

// Replace the flex split with responsive layout:
{
  /* Desktop split */
}
<div className="hidden flex-1 overflow-hidden md:flex">
  <div className="w-[45%] border-r" style={{ borderColor: "var(--sw-border)" }}>
    <AlexChat messages={messages} onSendMessage={handleSendMessage} isTyping={isTyping} />
  </div>
  <div className="w-[55%]">
    <PlaybookPanel /* ... same props ... */ />
  </div>
</div>;

{
  /* Mobile tabs */
}
<div className="flex flex-1 flex-col overflow-hidden md:hidden">
  <div className="flex border-b" style={{ borderColor: "var(--sw-border)" }}>
    <button
      onClick={() => setMobileTab("chat")}
      className="flex-1 py-3 text-[14px] font-medium"
      style={{
        color: mobileTab === "chat" ? "var(--sw-text-primary)" : "var(--sw-text-muted)",
        borderBottom: mobileTab === "chat" ? "2px solid var(--sw-accent)" : "2px solid transparent",
      }}
    >
      Chat with Alex
    </button>
    <button
      onClick={() => setMobileTab("playbook")}
      className="flex-1 py-3 text-[14px] font-medium"
      style={{
        color: mobileTab === "playbook" ? "var(--sw-text-primary)" : "var(--sw-text-muted)",
        borderBottom:
          mobileTab === "playbook" ? "2px solid var(--sw-accent)" : "2px solid transparent",
      }}
    >
      Your Playbook
    </button>
  </div>

  {/* Mini readiness bar */}
  <button
    onClick={() => setMobileTab("playbook")}
    className="border-b px-4 py-2 text-[14px]"
    style={{
      borderColor: "var(--sw-border)",
      color: "var(--sw-text-secondary)",
      backgroundColor: "var(--sw-surface)",
    }}
  >
    {readinessLabel}
  </button>

  <div className="flex-1 overflow-hidden">
    {mobileTab === "chat" ? (
      <AlexChat messages={messages} onSendMessage={handleSendMessage} isTyping={isTyping} />
    ) : (
      <PlaybookPanel /* ... same props ... */ />
    )}
  </div>
</div>;
```

- [ ] **Step 3: Add collapsible prompts on mobile for TestCenter**

In `apps/dashboard/src/components/onboarding/test-center.tsx`, add responsive prompt panel:

```tsx
// Add state
const [promptsCollapsed, setPromptsCollapsed] = useState(false);

// Replace left panel with responsive version:
<div
  className={`w-full overflow-y-auto md:w-[40%] md:pr-6 ${promptsCollapsed ? "hidden md:block" : ""}`}
>
  {/* existing prompt content */}
</div>;

{
  /* Mobile collapse toggle */
}
{
  promptsCollapsed && (
    <button
      onClick={() => setPromptsCollapsed(false)}
      className="border-b px-4 py-2 text-[14px] md:hidden"
      style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-secondary)" }}
    >
      Show scenarios
    </button>
  );
}
```

After sending first prompt on mobile: `setPromptsCollapsed(true)`.

- [ ] **Step 4: Add contextual stat card copy for dashboard**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, update the stat cards to show contextual copy when values are zero:

```tsx
// Where stat values are rendered, check for zero and show contextual copy:
// leads === 0 → "Waiting for first lead"
// responseTime === 0 → "Ready to respond instantly"
// bookings === 0 → "Ready to book"
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/components/onboarding/training-shell.tsx apps/dashboard/src/components/onboarding/test-center.tsx apps/dashboard/src/components/dashboard/owner-today.tsx
git commit -m "$(cat <<'EOF'
feat: add mobile tabs, reduced motion, contextual empty states

Training screen tabs for mobile with readiness bar. Test Center
collapsible prompts. Reduced motion media query. Dashboard stat
cards show contextual copy instead of zeros.
EOF
)"
```

---

## Implementation Notes

### Integration Points Not Covered (handled during implementation)

These are intentionally deferred to implementation time because they depend on wiring multiple tasks together:

1. **Scan → Playbook population**: The scan result needs to be mapped to playbook fields with confidence levels. This happens in the onboarding page when the scan completes.

2. **LLM-powered interview phrasing**: The interview engine provides the question template. During implementation, the `AlexChat` component should send the template + playbook context to the Claude API for natural phrasing.

3. **Test prompt generation**: Requires a Claude API call that takes the completed playbook and generates realistic customer scenarios. Wire this when integrating the TestCenter in the onboarding page.

4. **Skill simulation**: The test center's Alex responses should use the real skill executor with `simulation: true`. This requires adding a simulation endpoint to the API.

5. **Channel connection**: The `ChannelConnectCard` `onConnect` handler needs to call the existing connection API routes (`POST /deployments/:id/connections/telegram`, etc.).

6. **Launch → onboardingComplete**: When the launch sequence completes, the system must set `onboardingComplete: true` on the org config and decompose the playbook into existing config structures (knowledge entries, governance settings, channel connections).

7. **Playbook decomposition**: Writing the playbook draft to the canonical config structures (knowledge entries for services, governance settings for approval mode, etc.) happens on launch. This is a backend operation in the playbook API route.
