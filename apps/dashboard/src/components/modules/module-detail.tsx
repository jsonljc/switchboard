"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTasks, useTrustProgression } from "@/hooks/use-marketplace";
import { ChannelsSection } from "@/components/marketplace/channels-section";
import { TrustHistoryChart } from "@/components/marketplace/trust-history-chart";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { useModuleStatus } from "@/hooks/use-module-status";
import type { ModuleId } from "@/lib/module-types";
import type { TrustScoreBreakdown } from "@/lib/api-client";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface ModuleDetailClientProps {
  moduleId: ModuleId;
  label: string;
  deploymentId: string;
  orgId: string;
  listingId: string;
  connections: Connection[];
  trustBreakdown: TrustScoreBreakdown | null;
  inputConfig: Record<string, unknown>;
}

export function ModuleDetailClient({
  moduleId,
  label,
  deploymentId,
  listingId,
  connections,
  trustBreakdown,
}: ModuleDetailClientProps) {
  const router = useRouter();
  const { data: tasks } = useTasks({ deploymentId });
  const { data: progression } = useTrustProgression(listingId);
  const { data: modules } = useModuleStatus();
  const currentModule = modules?.find((m) => m.id === moduleId);

  const workLogTasks = (tasks ?? []).map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    output: t.output,
  }));

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
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
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
        <ChannelsSection
          deploymentId={deploymentId}
          connections={connections}
          onRefresh={() => router.refresh()}
        />
      </div>

      {/* Execution History */}
      {trustBreakdown && progression && progression.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Execution History</h2>
          <TrustHistoryChart
            data={progression}
            totalApprovals={trustBreakdown.breakdown.reduce((sum, b) => sum + b.totalApprovals, 0)}
            totalRejections={trustBreakdown.breakdown.reduce(
              (sum, b) => sum + b.totalRejections,
              0,
            )}
            currentStreak={Math.max(...trustBreakdown.breakdown.map((b) => b.consecutiveApprovals))}
            highestScore={Math.max(...progression.map((p) => p.score))}
          />
        </div>
      )}

      {/* Work Log */}
      {workLogTasks.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Activity</h2>
          <WorkLogList tasks={workLogTasks} />
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
