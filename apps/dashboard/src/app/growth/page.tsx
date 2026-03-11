"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgConfig } from "@/hooks/use-org-config";
import {
  useDiagnostic,
  useRunDiagnostic,
  useConnectorStatus,
  useInterventions,
  useApproveIntervention,
  useDeferIntervention,
  useDigest,
} from "@/hooks/use-revenue-growth";
import { ScoreGauge } from "@/components/revenue-growth/score-gauge";
import { FunnelChart } from "@/components/revenue-growth/funnel-chart";
import { ConstraintTimeline } from "@/components/revenue-growth/constraint-timeline";
import { InterventionCard } from "@/components/revenue-growth/intervention-card";
import { ConnectorHealth } from "@/components/revenue-growth/connector-health";
import { DigestViewer } from "@/components/revenue-growth/digest-viewer";
import { cn } from "@/lib/utils";
import type { RevGrowthScorerOutput } from "@/lib/api-client";

/* --- Helpers --- */

const SCORER_LABELS: Record<string, string> = {
  SIGNAL: "Signal",
  CREATIVE: "Creative",
  FUNNEL: "Funnel",
  SALES: "Sales",
  SATURATION: "Headroom",
};

function findScorer(outputs: RevGrowthScorerOutput[], type: string): RevGrowthScorerOutput | null {
  return outputs.find((o) => o.constraintType === type) ?? null;
}

const DATA_TIER_COLORS: Record<string, string> = {
  FULL: "bg-positive/15 text-positive-foreground",
  PARTIAL: "bg-caution/15 text-caution-foreground",
  SPARSE: "bg-muted text-muted-foreground",
};

/* --- Main page --- */

export default function GrowthPage() {
  const { status } = useSession();
  const { data: orgData } = useOrgConfig();

  // Derive account ID from org config — use a default for now
  const accountId =
    (orgData?.config?.runtimeConfig as Record<string, string> | undefined)?.adAccountId ??
    "act_default";

  const diagnostic = useDiagnostic(accountId);
  const runDiagnostic = useRunDiagnostic();
  const connectors = useConnectorStatus(accountId);
  const interventions = useInterventions(accountId);
  const approveIntervention = useApproveIntervention();
  const deferIntervention = useDeferIntervention();
  const digest = useDigest(accountId);

  if (status === "unauthenticated") redirect("/login");

  const isLoading =
    status === "loading" || diagnostic.isLoading || connectors.isLoading || interventions.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-10">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-20" />
      </div>
    );
  }

  const data = diagnostic.data;
  const scorerOutputs = data?.scorerOutputs ?? [];
  const primaryConstraint = data?.primaryConstraint;
  const dataTier = data?.dataTier ?? "SPARSE";
  const interventionList = interventions.data ?? [];

  // Build funnel stages from scorer findings
  const funnelScorer = findScorer(scorerOutputs, "FUNNEL");
  const funnelStages = funnelScorer ? buildFunnelStages(funnelScorer.rawMetrics) : [];

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            Revenue Growth
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Constraint-based diagnostic for your growth funnel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full",
              DATA_TIER_COLORS[dataTier] ?? "bg-muted text-muted-foreground",
            )}
          >
            {dataTier}
          </span>
          <button
            onClick={() => runDiagnostic.mutate(accountId)}
            disabled={runDiagnostic.isPending}
            className="flex items-center gap-1.5 text-[12px] font-medium text-foreground bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            {runDiagnostic.isPending ? "Running..." : "Run"}
          </button>
        </div>
      </section>

      {/* Score Gauges */}
      <section>
        <div className="flex items-start justify-center gap-6 md:gap-8">
          {["SIGNAL", "CREATIVE", "FUNNEL", "SALES", "SATURATION"].map((type) => {
            const scorer = findScorer(scorerOutputs, type);
            return (
              <ScoreGauge
                key={type}
                label={SCORER_LABELS[type] ?? type}
                score={scorer?.score ?? null}
                confidence={scorer?.confidence}
              />
            );
          })}
        </div>
      </section>

      {/* Primary Constraint callout */}
      {primaryConstraint && (
        <section className="rounded-xl border border-border/60 bg-surface p-5">
          <p className="text-[11px] text-muted-foreground mb-1">Primary Constraint</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[14px] font-semibold text-foreground">
              {primaryConstraint.type}
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">
              {primaryConstraint.confidence} confidence
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {primaryConstraint.reasoning}
          </p>
        </section>
      )}

      {/* Funnel Chart */}
      {funnelStages.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold text-foreground mb-3">Funnel Stages</h2>
          <FunnelChart stages={funnelStages} />
        </section>
      )}

      <div className="border-t border-border/40" />

      {/* Constraint Timeline */}
      <section>
        <h2 className="text-[15px] font-semibold text-foreground mb-3">Constraint Timeline</h2>
        <ConstraintTimeline
          history={
            data ? [{ cycleId: data.cycleId, scorerOutputs, completedAt: data.completedAt }] : []
          }
          primaryConstraintType={primaryConstraint?.type}
        />
      </section>

      <div className="border-t border-border/40" />

      {/* Two-column: Interventions + Digest */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Interventions */}
        <section>
          <h2 className="text-[15px] font-semibold text-foreground mb-3">Interventions</h2>
          {interventionList.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No interventions proposed yet.</p>
          ) : (
            <div className="space-y-3">
              {interventionList.map((intervention) => (
                <InterventionCard
                  key={intervention.id}
                  intervention={intervention}
                  onApprove={(id) => approveIntervention.mutate(id)}
                  onDefer={(id, reason) => deferIntervention.mutate({ interventionId: id, reason })}
                  isApproving={approveIntervention.isPending}
                  isDeferring={deferIntervention.isPending}
                />
              ))}
            </div>
          )}
        </section>

        {/* Digest */}
        <section>
          <h2 className="text-[15px] font-semibold text-foreground mb-3">Weekly Digest</h2>
          <div className="rounded-xl border border-border/60 bg-surface p-4">
            <DigestViewer digest={digest.data ?? null} />
          </div>
        </section>
      </div>

      <div className="border-t border-border/40" />

      {/* Connector Health */}
      <section>
        <h2 className="text-[15px] font-semibold text-foreground mb-3">Connector Health</h2>
        <ConnectorHealth connectors={connectors.data ?? []} />
      </section>
    </div>
  );
}

/* --- Funnel stage builder --- */

function buildFunnelStages(
  rawMetrics: Record<string, unknown>,
): Array<{ name: string; value: number }> {
  const stages: Array<{ name: string; value: number }> = [];
  const stageNames = ["impressions", "clicks", "contentView", "addToCart", "purchase"];
  const stageLabels = ["Impressions", "Clicks", "Content View", "Add to Cart", "Purchase"];

  for (let i = 0; i < stageNames.length; i++) {
    const val = rawMetrics[stageNames[i]];
    if (typeof val === "number" && val > 0) {
      stages.push({ name: stageLabels[i], value: val });
    }
  }

  return stages;
}
