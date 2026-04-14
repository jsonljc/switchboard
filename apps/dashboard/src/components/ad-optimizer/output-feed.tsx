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
