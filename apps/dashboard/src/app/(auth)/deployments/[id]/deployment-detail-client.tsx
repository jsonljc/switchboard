"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelsSection } from "@/components/marketplace/channels-section";
import { TrustScoreBadge } from "@/components/marketplace/trust-score-badge";
import { TrustHistoryChart } from "@/components/marketplace/trust-history-chart";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { useTasks, useTrustProgression } from "@/hooks/use-marketplace";
import { useCreativeJobs } from "@/hooks/use-creative-pipeline";
import { CreativeJobCard } from "@/components/creative-pipeline/creative-job-card";
import { BriefSubmissionSheet } from "@/components/creative-pipeline/brief-submission-sheet";
import { AdOptimizerSection } from "@/components/ad-optimizer/ad-optimizer-section";
import { FAQReviewQueue } from "@/components/marketplace/faq-review-queue";
import type { MarketplaceListing, TrustScoreBreakdown } from "@/lib/api-client";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface DeploymentDetailClientProps {
  deploymentId: string;
  orgId: string;
  listingId: string;
  connections: Connection[];
  listing: MarketplaceListing | null;
  trustBreakdown: TrustScoreBreakdown | null;
  inputConfig?: Record<string, unknown>;
}

export function DeploymentDetailClient({
  deploymentId,
  orgId,
  listingId,
  connections,
  listing,
  trustBreakdown,
  inputConfig,
}: DeploymentDetailClientProps) {
  const router = useRouter();
  const { data: tasks, isLoading: tasksLoading } = useTasks({ deploymentId });
  const { data: progression, isLoading: progressionLoading } = useTrustProgression(
    listing?.id ?? "",
  );

  const isCreativeListing = !!(
    listing?.metadata && (listing.metadata as Record<string, unknown>).family === "creative"
  );

  const { data: creativeJobs, isLoading: creativeJobsLoading } = useCreativeJobs(
    isCreativeListing ? deploymentId : "",
  );
  const [briefSheetOpen, setBriefSheetOpen] = useState(false);

  const workLogTasks = (tasks ?? []).map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    output: t.output,
  }));

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-10">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push("/marketplace")}
        aria-label="Back to marketplace"
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
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
              {listing?.name ?? "Deployment"}
            </h1>
            <p className="text-[13px] text-muted-foreground capitalize mt-0.5">
              {listing?.type.replace(/_/g, " ") ?? "Agent"}
              {" · "}
              <Badge variant="secondary" className="text-[11px]">
                Deployed
              </Badge>
            </p>
          </div>
        </div>
        {listing && (
          <div className="shrink-0">
            <TrustScoreBadge score={listing.trustScore} size="lg" />
          </div>
        )}
      </section>

      {/* Trust Score */}
      {trustBreakdown && trustBreakdown.breakdown.length > 0 && (
        <section>
          <h2 className="section-label mb-4">Trust Score</h2>
          <div className="rounded-xl border border-border bg-surface p-6 space-y-6">
            {/* Trust History Chart */}
            {progressionLoading ? (
              <Skeleton className="h-48" />
            ) : progression && progression.length > 0 ? (
              <TrustHistoryChart
                data={progression}
                totalApprovals={trustBreakdown.breakdown.reduce(
                  (sum, b) => sum + b.totalApprovals,
                  0,
                )}
                totalRejections={trustBreakdown.breakdown.reduce(
                  (sum, b) => sum + b.totalRejections,
                  0,
                )}
                currentStreak={Math.max(
                  ...trustBreakdown.breakdown.map((b) => b.consecutiveApprovals),
                )}
                highestScore={Math.max(...progression.map((p) => p.score))}
              />
            ) : null}

            {/* Per-category breakdown */}
            <div className="space-y-3">
              <p className="section-label">Per-category breakdown</p>
              {trustBreakdown.breakdown.map((item) => (
                <div
                  key={item.taskCategory}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                >
                  <div>
                    <p className="text-[14px] text-foreground capitalize">{item.taskCategory}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {item.totalApprovals} approved · {item.totalRejections} rejected
                      {item.consecutiveApprovals > 0 && ` · ${item.consecutiveApprovals} streak`}
                    </p>
                  </div>
                  <TrustScoreBadge score={item.score} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Channels */}
      <section>
        <h2 className="section-label mb-4">Channels</h2>
        <ChannelsSection
          deploymentId={deploymentId}
          connections={connections}
          onRefresh={() => router.refresh()}
        />
      </section>

      {/* FAQ Drafts */}
      <FAQReviewQueue deploymentId={deploymentId} orgId={orgId} />

      {/* Work Log */}
      <section>
        <h2 className="section-label mb-4">Work Log</h2>
        <div className="rounded-xl border border-border bg-surface p-6">
          {tasksLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : (
            <WorkLogList tasks={workLogTasks} />
          )}
        </div>
      </section>

      {/* Creative Jobs */}
      {isCreativeListing && (
        <>
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-label">Creative Jobs</h2>
              {listingId && (
                <Button variant="outline" size="sm" onClick={() => setBriefSheetOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  New Creative Job
                </Button>
              )}
            </div>
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
          </section>

          <BriefSubmissionSheet
            open={briefSheetOpen}
            onOpenChange={setBriefSheetOpen}
            deploymentId={deploymentId}
            listingId={listingId}
          />
        </>
      )}

      {listing?.metadata &&
        (listing.metadata as Record<string, unknown>).family === "paid_media" &&
        listing?.slug === "ad-optimizer" && (
          <AdOptimizerSection deploymentId={deploymentId} inputConfig={inputConfig} />
        )}
    </div>
  );
}
