// apps/dashboard/src/components/cockpit/cockpit-page.tsx
"use client";

import { useState, useMemo } from "react";
import { T } from "./tokens.js";
import { Identity } from "./identity.js";
import { ApprovalBlock } from "./approval-block.js";
import { ActivityStream, type ActivityFilter } from "./activity-stream.js";
import { ComposerPlaceholder } from "./composer-placeholder.js";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config.js";
import { legacyPendingApprovalToApprovalView } from "@/lib/cockpit/legacy-pending-approval-to-approval-view.js";
import { translatedActionToActivityRow } from "@/lib/cockpit/activity-kind-map.js";
import { useCockpitStatusAlex } from "@/hooks/use-cockpit-status.js";
import { usePendingApprovals } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useHalt } from "@/components/layout/halt/halt-context";

export function CockpitPage() {
  const haltCtx = useHalt();
  const approvalsQ = usePendingApprovals();
  const activityQ = useAgentActivity(1);
  const greetingQ = useAgentGreeting("alex");
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const now = useMemo(() => new Date(), []);

  const approvals = (approvalsQ.data?.approvals ?? []).map((a) =>
    legacyPendingApprovalToApprovalView(a, now),
  );
  const activityRows = (activityQ.data?.actions ?? [])
    .filter((a) => a.agentRole === "alex" || a.agentRole === "unknown")
    .map((a) => translatedActionToActivityRow(a, now));

  const recentActivityAt =
    activityRows.length > 0 ? new Date(activityQ.data!.actions[0]!.timestamp) : null;

  const statusKey = useCockpitStatusAlex({
    halted: haltCtx.halted,
    pendingApprovals: approvals.length,
    recentActivityAt,
  });

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
      {/* Topbar slots into the outer shell — rendered by the route layout at
          A.5 when the real composer and palette land. At A.1 the CockpitPage
          manages only its own content region so no duplicate "Alex" tab node
          shadows the Identity name. */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Identity
          statusKey={statusKey}
          halted={haltCtx.halted}
          subtitle={ALEX_CONFIG.missionSubtitle}
          line={line}
          onHaltToggle={haltCtx.toggleHalt}
        />
        {/* A.3 inserts <KPIStrip kpis={kpis} collapsed={approvals.length > 0} />
            here, between Identity and the approval block. A.1 renders nothing
            in this region — no empty <div /> placeholder. */}
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
        <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
      </div>
      <ComposerPlaceholder halted={haltCtx.halted} />
    </div>
  );
}
