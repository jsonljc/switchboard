"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusHero } from "@/components/mission-control/status-hero";
import { AgentStatusStrip } from "@/components/mission-control/agent-status-strip";
import { ActiveWorkPanel } from "@/components/mission-control/active-work-panel";
import { OutcomesPanel } from "@/components/mission-control/outcomes-panel";
import { ActivityFeedMini } from "@/components/mission-control/activity-feed-mini";

export default function HomePage() {
  const { status } = useSession();

  if (status === "unauthenticated") redirect("/login");
  if (status === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-12" />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StatusHero />
      <AgentStatusStrip />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <ActiveWorkPanel />
        <OutcomesPanel />
      </div>
      <ActivityFeedMini />
    </div>
  );
}
