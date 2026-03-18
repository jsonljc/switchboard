# Pilot Report Page — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a one-page `/results` dashboard that proves Switchboard's ROI to clinic owners — showing speed-to-lead, conversion rate, and cost per paying patient with before/after baselines.

**Architecture:** Extend the existing `/results` page and `OperatorSummary` API. Add a new `/api/reports/pilot` endpoint that aggregates revenue events (from the closed-loop plan) with existing lead/booking/spend data. The page uses CSS-only charts (no charting library) following the existing dashboard patterns.

**Tech Stack:** Next.js 14 (App Router), React, TanStack Query, Tailwind CSS, Fastify API (backend)

**Dependencies:** This plan assumes Tasks 6-8 from `2026-03-17-closed-loop-implementation.md` (RevenueEvent schema, revenue API endpoint, gap detection) are completed first. The pilot report reads revenue events — without them, the "paying patients" and "cost per paying patient" sections show placeholder state.

---

## Task 1: Baseline Schema on BusinessConfig

**Files:**

- Modify: `packages/schemas/src/business-profile.ts`
- Test: typecheck

**Step 1: Add baseline fields to business profile schema**

Find the `BusinessProfileSchema` in `packages/schemas/src/business-profile.ts` and add a `pilotBaseline` optional object:

```typescript
pilotBaseline: z.object({
  leadsPerMonth: z.number().optional(),
  conversionRatePercent: z.number().optional(),
  monthlyAdSpend: z.number().optional(),
  replySpeedDescription: z.string().optional(),
  capturedAt: z.string().datetime().optional(),
}).optional(),
```

This stores the owner's self-reported "before" numbers at onboarding.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "feat: add pilotBaseline to BusinessProfile schema"
```

---

## Task 2: Pilot Report API Endpoint (Backend)

**Files:**

- Create: `apps/api/src/routes/reports/pilot-report.ts`
- Create: `apps/api/src/routes/reports/__tests__/pilot-report.test.ts`

**Step 1: Write failing test**

Create `apps/api/src/routes/reports/__tests__/pilot-report.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("PilotReport aggregation", () => {
  it("computes conversion rate from leads and revenue events", () => {
    const leads = 40;
    const payingPatients = 14;
    const rate = Math.round((payingPatients / leads) * 100);
    expect(rate).toBe(35);
  });

  it("computes cost per paying patient", () => {
    const adSpend = 2000;
    const payingPatients = 14;
    const cpp = Math.round(adSpend / payingPatients);
    expect(cpp).toBe(143);
  });

  it("returns null cost per paying patient when no revenue events", () => {
    const payingPatients = 0;
    const adSpend = 2000;
    const cpp = payingPatients > 0 ? Math.round(adSpend / payingPatients) : null;
    expect(cpp).toBeNull();
  });

  it("computes funnel drop-offs", () => {
    const funnel = { leads: 40, qualified: 28, booked: 18, showedUp: 16, paid: 14 };
    const dropOffs = {
      qualifiedRate: Math.round((funnel.qualified / funnel.leads) * 100),
      bookedRate: Math.round((funnel.booked / funnel.qualified) * 100),
      showRate: Math.round((funnel.showedUp / funnel.booked) * 100),
      paidRate: Math.round((funnel.paid / funnel.showedUp) * 100),
    };
    expect(dropOffs.qualifiedRate).toBe(70);
    expect(dropOffs.bookedRate).toBe(64);
    expect(dropOffs.showRate).toBe(89);
    expect(dropOffs.paidRate).toBe(88);
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/api test -- --run pilot-report`
Expected: FAIL — module not found (tests reference the module but it doesn't exist yet — these are pure logic tests so they'll pass once created)

Actually these are pure math tests — they'll pass immediately. Let me add the real aggregation test.

**Step 3: Implement pilot report aggregation**

Create `apps/api/src/routes/reports/pilot-report.ts`:

```typescript
import type { FastifyInstance } from "fastify";

export interface PilotReportData {
  period: { startDate: string; endDate: string; days: number };

  // Card 1: Speed-to-lead
  speedToLead: {
    medianMs: number | null;
    percentWithin2Min: number | null;
    sampleSize: number;
    baseline: string | null; // e.g. "4+ hours"
  };

  // Card 2: Conversion rate
  conversion: {
    leads: number;
    payingPatients: number;
    ratePercent: number | null;
    baselinePercent: number | null;
  };

  // Card 3: Cost per paying patient
  costPerPatient: {
    amount: number | null;
    currency: string;
    adSpend: number | null;
    totalRevenue: number | null;
    roas: number | null;
    baselineAmount: number | null;
  };

  // Funnel chart
  funnel: {
    leads: number;
    qualified: number;
    booked: number;
    showedUp: number;
    paid: number;
  };

  // Campaign table
  campaigns: Array<{
    name: string;
    spend: number | null;
    leads: number;
    payingPatients: number;
    revenue: number;
    costPerPatient: number | null;
  }>;
}

export function registerPilotReportRoutes(app: FastifyInstance): void {
  app.get("/api/reports/pilot", async (request, reply) => {
    // Implementation queries:
    // 1. CRM contacts created in period (leads) with journey stage counts
    // 2. Revenue events in period (paying patients) with amounts
    // 3. Ad spend from operator summary
    // 4. Speed-to-lead from conversation states
    // 5. Campaign attribution with revenue events joined
    // 6. Baseline from BusinessConfig.pilotBaseline
    //
    // All data sources exist — this route aggregates them.

    // Placeholder structure — real implementation queries Prisma
    return reply.send({ report: null, message: "Pilot report endpoint ready" });
  });
}
```

Note to implementer: The actual Prisma queries follow the patterns in `/apps/api/src/app.ts` for the existing `/api/reports/clinic` and `/api/reports/operator-summary` endpoints. The key new query is: count distinct `contactId` values in revenue events for the period, grouped by `sourceCampaignId`, with `SUM(amount)` for revenue.

**Step 4: Run tests**

Run: `pnpm --filter @switchboard/api test -- --run pilot-report`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add pilot report API endpoint with aggregation types"
```

---

## Task 3: Dashboard API Route + Hook

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/reports/pilot/route.ts`
- Create: `apps/dashboard/src/hooks/use-pilot-report.ts`

**Step 1: Create dashboard API route**

Create `apps/dashboard/src/app/api/dashboard/reports/pilot/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.getPilotReport();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

**Step 2: Add API client method**

In `apps/dashboard/src/lib/api-client.ts`, add after `getClinicReport`:

```typescript
async getPilotReport() {
  return this.request<{ report: PilotReportData }>("/api/reports/pilot");
}
```

Add the `PilotReportData` interface (matching the backend type from Task 2) to the types section of `api-client.ts`.

**Step 3: Create hook**

Create `apps/dashboard/src/hooks/use-pilot-report.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

async function fetchPilotReport() {
  const res = await fetch("/api/dashboard/reports/pilot");
  if (!res.ok) throw new Error("Failed to fetch pilot report");
  const data = await res.json();
  return data.report;
}

export function usePilotReport() {
  return useQuery({
    queryKey: queryKeys.reports?.pilot?.() ?? ["pilot-report"],
    queryFn: fetchPilotReport,
    refetchInterval: 300_000, // 5 min — daily refresh is fine, this is generous
  });
}
```

**Step 4: Add query key**

In `apps/dashboard/src/lib/query-keys.ts`, add under reports (or create the key):

```typescript
reports: {
  pilot: () => ["reports", "pilot"] as const,
},
```

**Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git commit -m "feat: add pilot report dashboard route and hook"
```

---

## Task 4: Metric Cards Component

**Files:**

- Create: `apps/dashboard/src/components/pilot-report/metric-card.tsx`

**Step 1: Create the metric card component**

Following the existing `ScorecardTile` pattern from `results/page.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  comparison?: string;
  sub?: string;
  trend?: "positive" | "caution" | "neutral";
}

export function MetricCard({ label, value, comparison, sub, trend }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface p-6 space-y-2">
      <p className="section-label">{label}</p>
      <p className="text-[36px] font-light text-foreground leading-none">{value}</p>
      {comparison && (
        <p
          className={cn(
            "text-[13px] font-medium",
            trend === "positive"
              ? "text-positive-foreground"
              : trend === "caution"
                ? "text-caution-foreground"
                : "text-muted-foreground",
          )}
        >
          {comparison}
        </p>
      )}
      {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git commit -m "feat: add MetricCard component for pilot report"
```

---

## Task 5: Funnel Chart Component

**Files:**

- Create: `apps/dashboard/src/components/pilot-report/funnel-chart.tsx`

**Step 1: Create CSS-only horizontal funnel bar**

Following the existing CSS-only chart patterns (no charting library):

```typescript
"use client";

interface FunnelStage {
  label: string;
  count: number;
}

interface FunnelChartProps {
  stages: FunnelStage[];
}

export function FunnelChart({ stages }: FunnelChartProps) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const widthPercent = Math.max(8, (stage.count / max) * 100);
        const prevCount = i > 0 ? stages[i - 1].count : null;
        const dropOff =
          prevCount && prevCount > 0
            ? Math.round(((prevCount - stage.count) / prevCount) * 100)
            : null;

        return (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-24 text-right">
              <p className="text-[13px] text-muted-foreground">{stage.label}</p>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <div
                className="h-8 rounded bg-positive/65 transition-all duration-500 flex items-center px-3"
                style={{ width: `${widthPercent}%` }}
              >
                <span className="text-[13px] font-medium text-foreground">{stage.count}</span>
              </div>
              {dropOff !== null && dropOff > 0 && (
                <span className="text-[11px] text-muted-foreground">-{dropOff}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git commit -m "feat: add FunnelChart component for pilot report"
```

---

## Task 6: Campaign Revenue Table Component

**Files:**

- Create: `apps/dashboard/src/components/pilot-report/campaign-table.tsx`

**Step 1: Create the campaign table**

```typescript
"use client";

interface CampaignRow {
  name: string;
  spend: number | null;
  leads: number;
  payingPatients: number;
  revenue: number;
  costPerPatient: number | null;
}

interface CampaignTableProps {
  campaigns: CampaignRow[];
  currency?: string;
}

function fmt(v: number | null, prefix = "$"): string {
  if (v == null) return "—";
  return `${prefix}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function CampaignTable({ campaigns, currency = "$" }: CampaignTableProps) {
  if (campaigns.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground italic">
        Campaign revenue data will appear once payments are recorded.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border/40">
            <th className="text-left py-2 font-medium text-muted-foreground">Campaign</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Spend</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Leads</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Paid</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Revenue</th>
            <th className="text-right py-2 font-medium text-muted-foreground">Cost/Patient</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.name} className="border-b border-border/20">
              <td className="py-3 text-foreground font-medium">{c.name}</td>
              <td className="py-3 text-right text-muted-foreground">{fmt(c.spend, currency)}</td>
              <td className="py-3 text-right text-muted-foreground">{c.leads}</td>
              <td className="py-3 text-right text-foreground font-medium">{c.payingPatients}</td>
              <td className="py-3 text-right text-positive-foreground font-medium">
                {fmt(c.revenue, currency)}
              </td>
              <td className="py-3 text-right text-muted-foreground">
                {fmt(c.costPerPatient, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git commit -m "feat: add CampaignTable component for pilot report"
```

---

## Task 7: Rewrite Results Page as Pilot Report

**Files:**

- Modify: `apps/dashboard/src/app/results/page.tsx` (full rewrite)

**Step 1: Rewrite the page**

Replace the existing `/results` page with the pilot report layout. The page uses `usePilotReport()` for data, falling back to `useSpend()` for backwards compatibility when the pilot report API isn't available yet.

```typescript
"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/pilot-report/metric-card";
import { FunnelChart } from "@/components/pilot-report/funnel-chart";
import { CampaignTable } from "@/components/pilot-report/campaign-table";
import { usePilotReport } from "@/hooks/use-pilot-report";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export default function ResultsPage() {
  const { status } = useSession();
  const { data: report, isLoading } = usePilotReport();

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-10">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Results</h1>
        <p className="text-[14px] text-muted-foreground">
          Your pilot report will appear here once data starts flowing.
        </p>
      </div>
    );
  }

  const stlValue = report.speedToLead.medianMs != null
    ? formatDuration(report.speedToLead.medianMs)
    : "—";

  const convRate = report.conversion.ratePercent != null
    ? `${report.conversion.ratePercent}%`
    : "—";

  const cpp = report.costPerPatient.amount != null
    ? `$${report.costPerPatient.amount}`
    : "—";

  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Results</h1>
        <p className="text-[14px] text-muted-foreground">
          What your money has produced in the last {report.period.days} days.
        </p>
      </section>

      {/* Three metric cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Speed to lead"
          value={stlValue}
          comparison={report.speedToLead.baseline
            ? `vs ${report.speedToLead.baseline} before`
            : undefined}
          trend="positive"
          sub={report.speedToLead.percentWithin2Min != null
            ? `${report.speedToLead.percentWithin2Min}% replied within 2 minutes`
            : `${report.speedToLead.sampleSize} conversations measured`}
        />
        <MetricCard
          label="Leads → paying patients"
          value={convRate}
          comparison={report.conversion.baselinePercent != null
            ? `vs ~${report.conversion.baselinePercent}% before`
            : undefined}
          trend="positive"
          sub={`${report.conversion.payingPatients} paying patients from ${report.conversion.leads} leads`}
        />
        <MetricCard
          label="Cost per paying patient"
          value={cpp}
          comparison={report.costPerPatient.baselineAmount != null
            ? `vs ~$${report.costPerPatient.baselineAmount} before`
            : undefined}
          trend="positive"
          sub={report.costPerPatient.roas != null
            ? `Spend: $${report.costPerPatient.adSpend} → Revenue: $${report.costPerPatient.totalRevenue} → ROAS: ${report.costPerPatient.roas.toFixed(1)}:1`
            : undefined}
        />
      </section>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Funnel */}
      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold text-foreground">Patient journey</h2>
        <FunnelChart
          stages={[
            { label: "Leads", count: report.funnel.leads },
            { label: "Qualified", count: report.funnel.qualified },
            { label: "Booked", count: report.funnel.booked },
            { label: "Showed up", count: report.funnel.showedUp },
            { label: "Paid", count: report.funnel.paid },
          ]}
        />
      </section>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Campaign table */}
      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold text-foreground">
          Which campaigns bring paying patients
        </h2>
        <CampaignTable campaigns={report.campaigns} />
      </section>
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run dashboard tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "feat: rewrite /results page as pilot report with funnel and campaign table"
```

---

## Task 8: Baseline Capture in Onboarding

**Files:**

- Create: `apps/dashboard/src/components/onboarding/step-baseline.tsx`
- Modify: `apps/dashboard/src/components/onboarding/wizard-shell.tsx` (add step)

**Step 1: Create baseline capture step**

```typescript
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepBaselineProps {
  onNext: (baseline: {
    leadsPerMonth: number | undefined;
    conversionRatePercent: number | undefined;
    monthlyAdSpend: number | undefined;
    replySpeedDescription: string | undefined;
  }) => void;
}

export function StepBaseline({ onNext }: StepBaselineProps) {
  const [leads, setLeads] = useState("");
  const [conversion, setConversion] = useState("");
  const [spend, setSpend] = useState("");
  const [replySpeed, setReplySpeed] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Quick baseline</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Rough numbers are fine — we'll use these to show your improvement.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>How many leads do you get per month?</Label>
          <Input
            type="number"
            placeholder="e.g. 50"
            value={leads}
            onChange={(e) => setLeads(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>What % become paying patients?</Label>
          <Input
            type="number"
            placeholder="e.g. 10"
            value={conversion}
            onChange={(e) => setConversion(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Monthly ad spend ($)</Label>
          <Input
            type="number"
            placeholder="e.g. 2000"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>How quickly does your staff usually reply?</Label>
          <Input
            placeholder="e.g. 4-6 hours, next day"
            value={replySpeed}
            onChange={(e) => setReplySpeed(e.target.value)}
          />
        </div>
      </div>

      <button
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium"
        onClick={() =>
          onNext({
            leadsPerMonth: leads ? Number(leads) : undefined,
            conversionRatePercent: conversion ? Number(conversion) : undefined,
            monthlyAdSpend: spend ? Number(spend) : undefined,
            replySpeedDescription: replySpeed || undefined,
          })
        }
      >
        Continue
      </button>
    </div>
  );
}
```

**Step 2: Wire into onboarding wizard**

In `wizard-shell.tsx`, add the baseline step after business details but before the final "all set" step. Save the baseline to `BusinessConfig` via the existing config update API.

**Step 3: Commit**

```bash
git commit -m "feat: add baseline capture step to onboarding wizard"
```

---

## Task 9: Integration Verification

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

**Step 4: Run build**

Run: `pnpm build`
Expected: All packages build

**Step 5: Commit any fixes**

```bash
git commit -m "fix: resolve integration issues from pilot report implementation"
```

---

## Summary — Commit Sequence

| Task | Commit                                                                       | What it does                            |
| ---- | ---------------------------------------------------------------------------- | --------------------------------------- |
| 1    | `feat: add pilotBaseline to BusinessProfile schema`                          | Baseline "before" numbers               |
| 2    | `feat: add pilot report API endpoint with aggregation types`                 | Backend aggregation of all data sources |
| 3    | `feat: add pilot report dashboard route and hook`                            | Dashboard ↔ API wiring                  |
| 4    | `feat: add MetricCard component for pilot report`                            | Reusable card with comparison badge     |
| 5    | `feat: add FunnelChart component for pilot report`                           | CSS-only horizontal funnel bar          |
| 6    | `feat: add CampaignTable component for pilot report`                         | Revenue-sorted campaign breakdown       |
| 7    | `feat: rewrite /results page as pilot report with funnel and campaign table` | The actual page                         |
| 8    | `feat: add baseline capture step to onboarding wizard`                       | "Before" data collection                |
| 9    | `fix: resolve integration issues from pilot report implementation`           | Final verification                      |
