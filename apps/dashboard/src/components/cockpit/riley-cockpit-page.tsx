// apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
"use client";

import { useEffect, useState } from "react";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalCard } from "./approval-card";
import type { ApprovalAccent } from "./approval-card";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { CommandPalette } from "./command-palette";
import { ComposerPlaceholder } from "./composer-placeholder";
import { KPIStrip } from "./kpi-strip";
import { MissionPopover } from "./mission-popover";
import {
  RILEY_ACCENT,
  RILEY_COMMANDS,
  RILEY_COMPOSER_PLACEHOLDER,
  RILEY_MISSION_SUBTITLE,
  RILEY_TABS,
  statusColor,
  statusPulse,
} from "@/lib/cockpit/riley/riley-config";
import { useRileyActionDispatcher } from "@/lib/cockpit/riley-action-dispatcher";
import { rileyToast } from "@/lib/cockpit/riley/riley-toast";
import { useRileyApprovals } from "@/hooks/use-riley-approvals";
import { useRileyStatus } from "@/hooks/use-riley-status";
import { useRileyActivity } from "@/hooks/use-riley-activity";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { useToast } from "@/components/ui/use-toast";
import { useHalt } from "@/components/layout/halt/halt-context";
import { metricsViewModelToRileyKpiData } from "@/lib/cockpit/riley/metrics-to-kpi-data";
import type { CockpitKpiData, RileyApprovalView } from "./types";

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
      // Error state surfaces via TanStack Query (`useRecommendationAction.error`);
      // swallow here so success-only toast never fires on rejection.
      .catch(() => {});
  };

  return (
    <ApprovalCard
      data={approval}
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
  const metricsQ = useAgentMetrics("riley");
  const mission = useAgentMission("riley");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [missionOpen, setMissionOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const dispatch = useRileyActionDispatcher({
    onShowMission: () => setMissionOpen(true),
  });

  // Page-scoped ⌘K / Ctrl+K listener — opens the command palette. Mirrors
  // Alex A.5's CockpitPage pattern (cockpit-page.tsx:55-65). The native
  // browser ⌘K is preempted only while /riley is the active page; the
  // listener is removed on unmount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Adapter returns null when the wire VM is missing tiles or roi — the page
  // mount gates on this and renders no KPI strip rather than falling back to
  // Alex's `legacyTiles()` derivation (which would leak a `qualified` tile
  // onto /riley). See metrics-to-kpi-data.ts for the strict no-fallback
  // rationale.
  const kpis: CockpitKpiData | null = metricsQ.data
    ? metricsViewModelToRileyKpiData(metricsQ.data)
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
      <Topbar
        paletteEnabled
        onOpenPalette={() => setPaletteOpen(true)}
        paletteLabel="Tell Riley…"
        compact
        tabs={RILEY_TABS}
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ position: "relative" }}>
          <Identity
            statusKey={statusKey}
            halted={haltCtx.halted}
            subtitle={RILEY_MISSION_SUBTITLE}
            line={null}
            onHaltToggle={haltCtx.toggleHalt}
            colorFor={statusColor}
            pulseFor={statusPulse}
            missionInteractive={!!mission.data}
            onOpenMission={() => setMissionOpen((o) => !o)}
          />
          {mission.data ? (
            <MissionPopover
              open={missionOpen}
              onClose={() => setMissionOpen(false)}
              mission={mission.data.mission}
              agentLabel="Riley"
            />
          ) : null}
        </div>
        {kpis ? (
          <KPIStrip kpis={kpis} collapsed={approvals.length > 0} accent={RILEY_ACCENT} />
        ) : null}
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={RILEY_COMMANDS}
        onSelect={(cmd) => {
          setPaletteOpen(false);
          dispatch(cmd);
        }}
      />
    </div>
  );
}
