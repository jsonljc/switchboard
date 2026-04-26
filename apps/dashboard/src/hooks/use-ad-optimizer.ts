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
  sourceComparison?: {
    rows: Array<{
      source: string;
      cpl: number | null;
      costPerQualified: number | null;
      costPerBooked: number | null;
      closeRate: number | null;
      trueRoas: number | null;
    }>;
  };
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
