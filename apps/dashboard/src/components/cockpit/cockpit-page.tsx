// apps/dashboard/src/components/cockpit/cockpit-page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalBlock } from "./approval-block";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { ComposerPlaceholder } from "./composer-placeholder";
import { MissionPopover } from "./mission-popover";
import { EmptyState, shouldRenderEmptyState } from "./empty-state";
import { KPIStrip } from "./kpi-strip";
import type { CockpitKpiData } from "./types";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config";
import { legacyPendingApprovalToApprovalView } from "@/lib/cockpit/legacy-pending-approval-to-approval-view";
import { translatedActionToActivityRow } from "@/lib/cockpit/activity-kind-map";
import { metricsViewModelToLegacyKpiInput } from "@/lib/cockpit/metrics-to-kpi-input";
import { useCockpitStatusAlex } from "@/hooks/use-cockpit-status";
import { usePendingApprovals } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useHalt } from "@/components/layout/halt/halt-context";

export function CockpitPage() {
  const haltCtx = useHalt();
  const approvalsQ = usePendingApprovals();
  const activityQ = useAgentActivity(1);
  const greetingQ = useAgentGreeting("alex");
  const mission = useAgentMission("alex");
  const metricsQ = useAgentMetrics("alex");
  const router = useRouter();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [missionOpen, setMissionOpen] = useState(false);

  const [now, setNow] = useState<Date>(() => new Date());

  // Tick every 60s so relative timestamps and the WORKING-window
  // computation stay fresh. Cleared on unmount.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const approvals = (approvalsQ.data?.approvals ?? []).map((a) =>
    legacyPendingApprovalToApprovalView(a, now),
  );
  const rawAlexActions = (activityQ.data?.actions ?? []).filter(
    (a) => a.agentRole === "alex" || a.agentRole === "unknown",
  );
  const activityRows = rawAlexActions.map((a) => translatedActionToActivityRow(a, now));
  const recentActivityAt =
    rawAlexActions.length > 0 ? new Date(rawAlexActions[0]!.timestamp) : null;

  const statusKey = useCockpitStatusAlex({
    halted: haltCtx.halted,
    pendingApprovals: approvals.length,
    recentActivityAt,
    now,
  });

  const coldState = mission.data ? shouldRenderEmptyState(mission.data.setup) : false;

  const kpis: CockpitKpiData | null = metricsQ.data
    ? {
        range: `This week · ${metricsQ.data.folioRange}`,
        ...metricsViewModelToLegacyKpiInput(metricsQ.data),
      }
    : null;

  const line = greetingQ.data?.segments
    ? greetingQ.data.segments
        .map((s) => s.text)
        .join(" ")
        .trim() || null
    : null;

  return (
    <div
      style={{
        background: T.bg,
        color: T.ink,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Topbar paletteEnabled={false} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ position: "relative" }}>
          <Identity
            statusKey={statusKey}
            halted={haltCtx.halted}
            subtitle={ALEX_CONFIG.missionSubtitle}
            line={line}
            onHaltToggle={haltCtx.toggleHalt}
            missionInteractive={!!mission.data}
            onOpenMission={() => setMissionOpen((o) => !o)}
          />
          {mission.data ? (
            <MissionPopover
              open={missionOpen}
              onClose={() => setMissionOpen(false)}
              mission={mission.data.mission}
            />
          ) : null}
        </div>
        {!coldState && kpis ? <KPIStrip kpis={kpis} collapsed={approvals.length > 0} /> : null}
        {approvals.length > 0 && (
          <ApprovalBlock
            data={approvals}
            onResolve={(_verdict, _idx) => {
              // A.1 stops at view assembly; resolution wires up at A.5 once
              // useRespondToApproval is integrated into the cockpit. Until
              // then the buttons are visually present but inert.
            }}
          />
        )}
        {coldState && mission.data ? (
          <EmptyState
            rules={mission.data.mission.rules}
            setup={mission.data.setup}
            onConnect={(key) => router.push(`/setup?step=${key}`)}
          />
        ) : (
          <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
        )}
      </div>
      <ComposerPlaceholder halted={haltCtx.halted} />
    </div>
  );
}
