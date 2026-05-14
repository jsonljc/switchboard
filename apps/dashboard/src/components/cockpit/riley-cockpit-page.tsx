// apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
"use client";

import { useState } from "react";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalBlock } from "./approval-block";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { ComposerPlaceholder } from "./composer-placeholder";
import { RILEY_MISSION_SUBTITLE } from "@/lib/cockpit/riley/riley-config";
import { useRileyApprovals } from "@/hooks/use-riley-approvals";
import { useRileyStatus } from "@/hooks/use-riley-status";
import { useRileyActivity } from "@/hooks/use-agent-activity";
import { useHalt } from "@/components/layout/halt/halt-context";
import type { ApprovalView } from "./types";

export function RileyCockpitPage() {
  const haltCtx = useHalt();
  const { approvals } = useRileyApprovals();
  const statusKey = useRileyStatus();
  const { rows: activityRows } = useRileyActivity();
  const [filter, setFilter] = useState<ActivityFilter>("all");

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
      <Topbar paletteEnabled={false} compact />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Identity
          statusKey={statusKey}
          halted={haltCtx.halted}
          subtitle={RILEY_MISSION_SUBTITLE}
          line={null}
          onHaltToggle={haltCtx.toggleHalt}
        />
        {approvals.length > 0 && (
          <ApprovalBlock
            data={approvals as ApprovalView[]}
            onResolve={(_verdict, _idx) => {
              // B.1 stops at view assembly; resolution wires up at a future slice.
            }}
          />
        )}
        <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
      </div>
      <ComposerPlaceholder halted={haltCtx.halted} />
    </div>
  );
}
