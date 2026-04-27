# Ad Optimizer SP5: Dashboard — Audit Summary, Output Feed, Trend Charts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ad Optimizer-specific dashboard components to the My Agent (deployment detail) page — audit summary card, classified output feed (Insight/Watch/Recommendation), and metric trend charts.

**Architecture:** Three new client components render audit data from existing AgentTask records (category: "audit"). Data flows through the existing proxy route (`/api/dashboard/marketplace/tasks`). A new hook `useAdOptimizerAudit` filters tasks by category and extracts the latest audit report. Components follow the existing deployment-detail pattern — `rounded-xl border` containers, shadcn primitives, recharts for charts. No new backend API endpoints needed.

**Tech Stack:** Next.js 14, TanStack React Query, Tailwind CSS, shadcn/ui, recharts

**Spec:** `docs/superpowers/specs/2026-04-13-ad-optimizer-design.md` — Section 13

---

## File Structure

| Action | File                                                                          | Responsibility                                                           |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Create | `apps/dashboard/src/hooks/use-ad-optimizer.ts`                                | React Query hook — fetches audit tasks, extracts latest report           |
| Create | `apps/dashboard/src/components/ad-optimizer/audit-summary-card.tsx`           | Summary card: ROAS, spend, leads, health indicator, learning phase count |
| Create | `apps/dashboard/src/components/ad-optimizer/output-feed.tsx`                  | Classified feed: Insight/Watch/Recommendation cards with actions         |
| Create | `apps/dashboard/src/components/ad-optimizer/metric-trend-chart.tsx`           | CPM/CTR/CPA/ROAS line charts using recharts                              |
| Create | `apps/dashboard/src/components/ad-optimizer/ad-optimizer-section.tsx`         | Container component that composes all three above                        |
| Modify | `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx` | Render AdOptimizerSection for paid_media/ad-optimizer deployments        |
| Modify | `apps/dashboard/src/lib/query-keys.ts`                                        | Add `adOptimizer` query key namespace                                    |

---

### Task 1: Query Keys + Hook

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/hooks/use-ad-optimizer.ts`

- [ ] **Step 1: Add query keys**

Add to `query-keys.ts` after the `creativeJobs` namespace:

```typescript
adOptimizer: {
  all: ["adOptimizer"] as const,
  audit: (deploymentId: string) => ["adOptimizer", "audit", deploymentId] as const,
},
```

- [ ] **Step 2: Create the hook**

```typescript
// apps/dashboard/src/hooks/use-ad-optimizer.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface AuditReportSummary {
  totalSpend: number;
  totalLeads: number;
  totalRevenue: number;
  overallROAS: number;
  activeCampaigns: number;
  campaignsInLearning: number;
}

export interface AuditInsight {
  type: "insight";
  campaignId: string;
  campaignName: string;
  message: string;
  category: string;
}

export interface AuditWatch {
  type: "watch";
  campaignId: string;
  campaignName: string;
  pattern: string;
  message: string;
  checkBackDate: string;
}

export interface AuditRecommendation {
  type: "recommendation";
  action: string;
  campaignId: string;
  campaignName: string;
  confidence: number;
  urgency: string;
  estimatedImpact: string;
  steps: string[];
  learningPhaseImpact: string;
  draftId?: string | null;
}

export interface AuditReport {
  accountId: string;
  dateRange: { since: string; until: string };
  summary: AuditReportSummary;
  funnel: {
    stages: Array<{ name: string; count: number; rate: number; benchmark: number; delta: number }>;
    leakagePoint: string;
    leakageMagnitude: number;
  };
  periodDeltas: Array<{
    metric: string;
    current: number;
    previous: number;
    deltaPercent: number;
    direction: string;
    significant: boolean;
  }>;
  insights: AuditInsight[];
  watches: AuditWatch[];
  recommendations: AuditRecommendation[];
}

interface TaskRecord {
  id: string;
  category: string;
  status: string;
  output: AuditReport | null;
  createdAt: string;
}

export function useAdOptimizerAudit(deploymentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.adOptimizer.audit(deploymentId ?? ""),
    queryFn: async () => {
      const params = new URLSearchParams({
        deploymentId: deploymentId!,
      });
      const res = await fetch(`/api/dashboard/marketplace/tasks?${params}`);
      if (!res.ok) throw new Error("Failed to fetch audit data");
      const data = (await res.json()) as { tasks: TaskRecord[] };
      // Filter to audit category client-side (proxy route doesn't support category filter)
      const completed = data.tasks
        .filter((t) => t.category === "audit" && t.status === "completed" && t.output)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Map raw output to add type discriminants for OutputFeed rendering
      const mapReport = (output: AuditReport): AuditReport => ({
        ...output,
        insights: output.insights.map((i) => ({ ...i, type: "insight" as const })),
        watches: output.watches.map((w) => ({ ...w, type: "watch" as const })),
        recommendations: output.recommendations.map((r) => ({
          ...r,
          type: "recommendation" as const,
        })),
      });

      const latest = completed[0]?.output;
      return {
        latestReport: latest ? mapReport(latest) : null,
        reports: completed.map((t) => ({
          ...mapReport(t.output!),
          taskId: t.id,
          createdAt: t.createdAt,
        })),
      };
    },
    enabled: !!deploymentId,
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/hooks/use-ad-optimizer.ts && git commit -m "feat(dashboard): add ad optimizer audit hook and query keys"
```

---

### Task 2: Audit Summary Card

**Files:**

- Create: `apps/dashboard/src/components/ad-optimizer/audit-summary-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/dashboard/src/components/ad-optimizer/audit-summary-card.tsx
"use client";

import type { AuditReportSummary } from "@/hooks/use-ad-optimizer";

interface AuditSummaryCardProps {
  summary: AuditReportSummary;
  dateRange: { since: string; until: string };
  targetCPA?: number;
  targetROAS?: number;
}

function getHealthColor(
  summary: AuditReportSummary,
  targetCPA?: number,
  targetROAS?: number,
): string {
  if (!targetCPA && !targetROAS) return "text-muted-foreground";
  const cpa = summary.totalSpend / Math.max(summary.totalLeads, 1);
  const roasOk = !targetROAS || summary.overallROAS >= targetROAS;
  const cpaOk = !targetCPA || cpa <= targetCPA;
  if (roasOk && cpaOk) return "text-positive";
  if (roasOk || cpaOk) return "text-caution";
  return "text-negative";
}

export function AuditSummaryCard({
  summary,
  dateRange,
  targetCPA,
  targetROAS,
}: AuditSummaryCardProps) {
  const healthColor = getHealthColor(summary, targetCPA, targetROAS);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Audit Summary</h3>
        <span className="text-sm text-muted-foreground">
          {dateRange.since} — {dateRange.until}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCell
          label="ROAS"
          value={`${summary.overallROAS.toFixed(1)}x`}
          className={healthColor}
        />
        <StatCell label="Spend" value={`$${summary.totalSpend.toLocaleString()}`} />
        <StatCell label="Leads" value={summary.totalLeads.toLocaleString()} />
        <StatCell label="Revenue" value={`$${summary.totalRevenue.toLocaleString()}`} />
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
        <span>
          {summary.activeCampaigns} active campaign{summary.activeCampaigns !== 1 ? "s" : ""}
        </span>
        {summary.campaignsInLearning > 0 && (
          <span className="text-caution">{summary.campaignsInLearning} in learning phase</span>
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${className}`}>{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/ad-optimizer/audit-summary-card.tsx && git commit -m "feat(dashboard): add audit summary card component"
```

---

### Task 3: Output Feed

**Files:**

- Create: `apps/dashboard/src/components/ad-optimizer/output-feed.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/dashboard/src/components/ad-optimizer/output-feed.tsx
"use client";

import type { AuditInsight, AuditWatch, AuditRecommendation } from "@/hooks/use-ad-optimizer";
import { Badge } from "@/components/ui/badge";

type OutputItem = AuditInsight | AuditWatch | AuditRecommendation;

interface OutputFeedProps {
  insights: AuditInsight[];
  watches: AuditWatch[];
  recommendations: AuditRecommendation[];
  onApprove?: (rec: AuditRecommendation) => void;
  onDismiss?: (rec: AuditRecommendation) => void;
}

export function OutputFeed({
  insights,
  watches,
  recommendations,
  onApprove,
  onDismiss,
}: OutputFeedProps) {
  const items: OutputItem[] = [...recommendations, ...watches, ...insights];

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="text-lg font-semibold mb-2">Findings</h3>
        <p className="text-muted-foreground text-sm">No findings from the latest audit.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold mb-4">Findings</h3>
      <div className="space-y-3">
        {items.map((item, i) => (
          <OutputCard
            key={`${item.type}-${item.campaignId}-${i}`}
            item={item}
            onApprove={onApprove}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

function OutputCard({
  item,
  onApprove,
  onDismiss,
}: {
  item: OutputItem;
  onApprove?: (r: AuditRecommendation) => void;
  onDismiss?: (r: AuditRecommendation) => void;
}) {
  if (item.type === "insight") return <InsightCard item={item} />;
  if (item.type === "watch") return <WatchCard item={item} />;
  return <RecommendationCard item={item} onApprove={onApprove} onDismiss={onDismiss} />;
}

function InsightCard({ item }: { item: AuditInsight }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="secondary">Insight</Badge>
        <span className="text-sm text-muted-foreground">{item.campaignName}</span>
      </div>
      <p className="text-sm">{item.message}</p>
    </div>
  );
}

function WatchCard({ item }: { item: AuditWatch }) {
  return (
    <div className="rounded-lg border border-caution/30 bg-caution/5 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Badge className="bg-caution/20 text-caution border-caution/30">Watch</Badge>
        <span className="text-sm text-muted-foreground">{item.campaignName}</span>
      </div>
      <p className="text-sm">{item.message}</p>
      <p className="text-xs text-muted-foreground mt-1">Check back on {item.checkBackDate}</p>
    </div>
  );
}

function RecommendationCard({
  item,
  onApprove,
  onDismiss,
}: {
  item: AuditRecommendation;
  onApprove?: (r: AuditRecommendation) => void;
  onDismiss?: (r: AuditRecommendation) => void;
}) {
  const urgencyColors: Record<string, string> = {
    immediate: "bg-negative/20 text-negative border-negative/30",
    this_week: "bg-caution/20 text-caution border-caution/30",
    next_cycle: "bg-muted text-muted-foreground",
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="default">{item.action.replace("_", " ")}</Badge>
        <Badge className={urgencyColors[item.urgency] ?? ""}>
          {item.urgency.replace("_", " ")}
        </Badge>
        <span className="text-sm text-muted-foreground">{item.campaignName}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {Math.round(item.confidence * 100)}% confidence
        </span>
      </div>
      <p className="text-sm mb-2">{item.estimatedImpact}</p>
      <ul className="text-sm text-muted-foreground list-disc list-inside mb-3">
        {item.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>
      {item.learningPhaseImpact !== "no impact" && (
        <p className="text-xs text-caution mb-3">⚠ {item.learningPhaseImpact}</p>
      )}
      <div className="flex gap-2">
        {onApprove && (
          <button
            onClick={() => onApprove(item)}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Approve & Publish
          </button>
        )}
        {onDismiss && (
          <button
            onClick={() => onDismiss(item)}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/ad-optimizer/output-feed.tsx && git commit -m "feat(dashboard): add output feed component — insights, watches, recommendations"
```

---

### Task 4: Metric Trend Chart

**Files:**

- Create: `apps/dashboard/src/components/ad-optimizer/metric-trend-chart.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/dashboard/src/components/ad-optimizer/metric-trend-chart.tsx
"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface MetricDelta {
  metric: string;
  current: number;
  previous: number;
  deltaPercent: number;
  direction: string;
  significant: boolean;
}

interface MetricTrendChartProps {
  periodDeltas: MetricDelta[];
}

const METRIC_LABELS: Record<string, string> = {
  cpm: "CPM",
  ctr: "CTR",
  cpc: "CPC",
  cpl: "CPL",
  cpa: "CPA",
  roas: "ROAS",
  frequency: "Frequency",
};

const METRIC_FORMATS: Record<string, (v: number) => string> = {
  cpm: (v) => `$${v.toFixed(2)}`,
  ctr: (v) => `${v.toFixed(1)}%`,
  cpc: (v) => `$${v.toFixed(2)}`,
  cpl: (v) => `$${v.toFixed(0)}`,
  cpa: (v) => `$${v.toFixed(0)}`,
  roas: (v) => `${v.toFixed(1)}x`,
  frequency: (v) => v.toFixed(1),
};

function getDeltaColor(delta: MetricDelta): string {
  if (!delta.significant) return "text-muted-foreground";
  // For cost metrics, "up" is bad; for ROAS, "up" is good
  const costMetrics = ["cpm", "cpc", "cpl", "cpa"];
  const isGood = costMetrics.includes(delta.metric)
    ? delta.direction === "down"
    : delta.direction === "up";
  return isGood ? "text-positive" : "text-negative";
}

export function MetricTrendChart({ periodDeltas }: MetricTrendChartProps) {
  // Build chart data: each metric gets a row with "Previous" and "Current" columns
  const chartData = periodDeltas.map((d) => ({
    metric: METRIC_LABELS[d.metric] ?? d.metric,
    previous: d.previous,
    current: d.current,
  }));

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold mb-4">Period Comparison</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {periodDeltas.map((d) => {
          const format = METRIC_FORMATS[d.metric] ?? ((v: number) => v.toFixed(1));
          const deltaColor = getDeltaColor(d);
          const arrow = d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : "→";
          return (
            <div key={d.metric} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {METRIC_LABELS[d.metric] ?? d.metric}
              </p>
              <p className="text-xl font-bold">{format(d.current)}</p>
              <p className={`text-sm ${deltaColor}`}>
                {arrow} {Math.abs(d.deltaPercent).toFixed(1)}%
                <span className="text-muted-foreground ml-1">vs {format(d.previous)}</span>
              </p>
            </div>
          );
        })}
      </div>

      {chartData.length > 0 && (
        <div className="mt-6 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="metric"
                tick={{ fontSize: 12 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--surface))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Line
                type="monotone"
                dataKey="previous"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                name="Previous"
              />
              <Line
                type="monotone"
                dataKey="current"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                name="Current"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/ad-optimizer/metric-trend-chart.tsx && git commit -m "feat(dashboard): add metric trend chart with period comparison"
```

---

### Task 5: Container Component + Wire into Deployment Detail

**Files:**

- Create: `apps/dashboard/src/components/ad-optimizer/ad-optimizer-section.tsx`
- Modify: `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`

- [ ] **Step 1: Create the container component**

```tsx
// apps/dashboard/src/components/ad-optimizer/ad-optimizer-section.tsx
"use client";

import { useAdOptimizerAudit } from "@/hooks/use-ad-optimizer";
import { AuditSummaryCard } from "./audit-summary-card";
import { OutputFeed } from "./output-feed";
import { MetricTrendChart } from "./metric-trend-chart";
import { Skeleton } from "@/components/ui/skeleton";

interface AdOptimizerSectionProps {
  deploymentId: string;
  inputConfig?: Record<string, unknown>;
}

export function AdOptimizerSection({ deploymentId, inputConfig }: AdOptimizerSectionProps) {
  const { data, isLoading, error } = useAdOptimizerAudit(deploymentId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !data?.latestReport) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="text-lg font-semibold mb-2">Ad Optimizer</h3>
        <p className="text-muted-foreground text-sm">
          {error
            ? "Failed to load audit data."
            : "No audit reports yet. The first audit will run on the next scheduled cycle."}
        </p>
      </div>
    );
  }

  const report = data.latestReport;
  const targetCPA = inputConfig?.targetCPA as number | undefined;
  const targetROAS = inputConfig?.targetROAS as number | undefined;

  return (
    <div className="space-y-6">
      <AuditSummaryCard
        summary={report.summary}
        dateRange={report.dateRange}
        targetCPA={targetCPA}
        targetROAS={targetROAS}
      />

      <OutputFeed
        insights={report.insights}
        watches={report.watches}
        recommendations={report.recommendations}
      />

      {report.periodDeltas.length > 0 && <MetricTrendChart periodDeltas={report.periodDeltas} />}
    </div>
  );
}
```

- [ ] **Step 2: Wire into deployment detail page**

This requires changes to **two files**:

**2a. Server page (`page.tsx`):** Pass `inputConfig` as a new prop. In `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`, update the `<DeploymentDetailClient>` render to include:

```tsx
inputConfig={(deployment.inputConfig as Record<string, unknown>) ?? {}}
```

**2b. Client component (`deployment-detail-client.tsx`):**

1. Add `inputConfig?: Record<string, unknown>` to `DeploymentDetailClientProps` interface
2. Add the import:

```tsx
import { AdOptimizerSection } from "@/components/ad-optimizer/ad-optimizer-section";
```

3. Render conditionally (after the Creative Jobs section or Work Log section):

```tsx
{
  listing?.metadata?.family === "paid_media" && listing?.slug === "ad-optimizer" && (
    <AdOptimizerSection deploymentId={deploymentId} inputConfig={inputConfig} />
  );
}
```

Note: `listing.metadata` is typed as `Record<string, unknown>` so access `listing?.metadata?.family` and `listing?.slug` directly. Use `deploymentId` (from props, already a string), not `deployment.id`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/ad-optimizer/ apps/dashboard/src/app/\(auth\)/deployments/\[id\]/deployment-detail-client.tsx && git commit -m "feat(dashboard): wire ad optimizer section into deployment detail page"
```

---

## What's Done After SP5

All 12 phases of the Ad Optimizer build order are complete:

| Phase | What                                         | SP  |
| ----- | -------------------------------------------- | --- |
| 1     | Zod schemas                                  | SP1 |
| 2     | Meta Ads Client                              | SP1 |
| 3     | Meta CAPI Client                             | SP1 |
| 4     | Funnel Analyzer + Period Comparator          | SP1 |
| 5     | Learning Phase Guard                         | SP1 |
| 6     | Metric Diagnostician + Recommendation Engine | SP1 |
| 7     | Audit Runner                                 | SP1 |
| 8     | Meta Leads API + Widget fbclid               | SP2 |
| 9     | Inngest cron functions                       | SP2 |
| 10    | Facebook OAuth                               | SP3 |
| 11    | Marketplace listing seed data                | SP4 |
| 12    | Dashboard                                    | SP5 |
