// apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
"use client";

import { useState } from "react";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalCard } from "./approval-card";
import type { ApprovalAccent } from "./approval-card";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { ComposerPlaceholder } from "./composer-placeholder";
import {
  RILEY_ACCENT,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_MISSION_SUBTITLE,
  RILEY_TABS,
  statusColor,
  statusPulse,
} from "@/lib/cockpit/riley/riley-config";
import { rileyToast } from "@/lib/cockpit/riley/riley-toast";
import { useRileyApprovals } from "@/hooks/use-riley-approvals";
import { useRileyStatus } from "@/hooks/use-riley-status";
import { useRileyActivity } from "@/hooks/use-riley-activity";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { useToast } from "@/components/ui/use-toast";
import { useHalt } from "@/components/layout/halt/halt-context";
import type { ApprovalView, RileyApprovalView } from "./types";

const RILEY_APPROVAL_ACCENT: ApprovalAccent = {
  base: RILEY_ACCENT.base,
  deep: RILEY_ACCENT.deep,
  soft: RILEY_ACCENT.soft,
  paper: RILEY_ACCENT.paper,
};

function RileyApprovalRow({
  approval,
  idx,
  total,
}: {
  approval: RileyApprovalView;
  idx: number;
  total: number;
}) {
  const action = useRecommendationAction(approval.id);
  const { toast } = useToast();

  const onResolve = (verdict: "accept" | "decline", _idx: number) => {
    if (verdict === "accept" && approval.primaryAction.kind === "external") {
      window.open(approval.primaryAction.url, "_blank", "noopener,noreferrer");
      return;
    }
    const promise = verdict === "accept" ? action.primary() : action.dismiss();
    void promise
      .then(() => {
        toast(rileyToast({ verdict, approval }));
      })
      .catch(() => {
        // Swallow mutation errors — success-only toast: only fire on success.
      });
  };

  return (
    <ApprovalCard
      data={approval as ApprovalView}
      idx={idx}
      total={total}
      onResolve={onResolve}
      accent={RILEY_APPROVAL_ACCENT}
      senderLabel="Riley needs you"
    />
  );
}

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
      <Topbar paletteEnabled={false} compact tabs={RILEY_TABS} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Identity
          statusKey={statusKey}
          halted={haltCtx.halted}
          subtitle={RILEY_MISSION_SUBTITLE}
          line={null}
          onHaltToggle={haltCtx.toggleHalt}
          colorFor={statusColor}
          pulseFor={statusPulse}
        />
        {approvals.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              margin: "20px 28px 0",
            }}
          >
            {(approvals as RileyApprovalView[]).map((approval, idx) => (
              <RileyApprovalRow
                key={approval.id}
                approval={approval}
                idx={idx}
                total={approvals.length}
              />
            ))}
          </div>
        )}
        <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
      </div>
      <ComposerPlaceholder
        halted={haltCtx.halted}
        senderLabel="RILEY"
        placeholderCopy={RILEY_COMPOSER_PLACEHOLDER}
        accentColor={RILEY_ACCENT.deep}
      />
    </div>
  );
}
