// apps/dashboard/src/components/cockpit/cockpit-page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { Composer } from "./composer";
import { CommandPalette } from "./command-palette";
import { MissionPopover } from "./mission-popover";
import { EmptyState, shouldRenderEmptyState } from "./empty-state";
import { KPIStrip } from "./kpi-strip";
import type { CockpitKpiData } from "./types";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config";
import { ALEX_COMMANDS, ALEX_COMPOSER_PLACEHOLDER } from "@/lib/cockpit/alex-commands";
import { useAlexActionDispatcher } from "@/lib/cockpit/alex-action-dispatcher";
import { AlexApprovalRow } from "@/lib/cockpit/alex/alex-approval-row";
import { richPendingApprovalToApprovalView } from "@/lib/cockpit/rich-pending-approval-to-approval-view";
import { metricsViewModelToLegacyKpiInput } from "@/lib/cockpit/metrics-to-kpi-input";
import { useCockpitStatusAlex } from "@/hooks/use-cockpit-status";
import { usePendingApprovals } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useHalt } from "@/components/layout/halt/halt-context";

// Hoisted to module scope to avoid re-allocating the lookup on every render.
// Order per spec §Card sort order: immediate → this_week → next_cycle.
const URGENCY_ORDER: Record<"immediate" | "this_week" | "next_cycle", number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

export function CockpitPage() {
  const haltCtx = useHalt();
  const approvalsQ = usePendingApprovals();
  const activityQ = useAgentActivityCockpit("alex", { limit: 50, expandPreview: true });
  const greetingQ = useAgentGreeting("alex");
  const mission = useAgentMission("alex");
  const metricsQ = useAgentMetrics("alex");
  const router = useRouter();
  const dispatch = useAlexActionDispatcher();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [missionOpen, setMissionOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [now, setNow] = useState<Date>(() => new Date());

  // Tick every 60s so relative timestamps and the WORKING-window
  // computation stay fresh. Cleared on unmount.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Page-scoped ⌘K / Ctrl+K listener — opens the command palette.
  // The native browser ⌘K (URL bar focus) is preempted only while
  // /alex is the active page; the listener is removed on unmount.
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

  // Sort order per spec §Card sort order: immediate → this_week → next_cycle,
  // then createdAt desc within band. The wrap-then-unwrap is required because
  // the tiebreak reads `createdAt` from the raw PendingApproval (the view-only
  // `askedAt` is a relative string, not a timestamp). URGENCY_ORDER is hoisted
  // to module scope above to avoid per-render allocation.
  const approvals = (approvalsQ.data?.approvals ?? [])
    .map((a) => ({ raw: a, view: richPendingApprovalToApprovalView(a, now) }))
    .sort((a, b) => {
      const urgencyDiff = URGENCY_ORDER[a.view.urgency] - URGENCY_ORDER[b.view.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return new Date(b.raw.createdAt).getTime() - new Date(a.raw.createdAt).getTime();
    })
    .map(({ view }) => view);
  const activityRows = activityQ.data?.rows ?? [];
  // timestampIso is populated by the server-side translator (Task 5,
  // driven by ActivityRowSchema.timestampIso from Task 3). The cockpit
  // page only reads `now` and the most-recent row's timestampIso for
  // the WORKING-pill window calculation in useCockpitStatusAlex.
  const recentActivityAt =
    activityRows.length > 0 && activityRows[0]!.timestampIso
      ? new Date(activityRows[0]!.timestampIso)
      : null;

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
      <Topbar paletteEnabled onOpenPalette={() => setPaletteOpen(true)} />
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              margin: "20px 28px 0",
            }}
          >
            {approvals.map((approval, idx) => (
              <AlexApprovalRow
                key={approval.id}
                approval={approval}
                idx={idx}
                total={approvals.length}
              />
            ))}
          </div>
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
      <Composer
        placeholder={ALEX_COMPOSER_PLACEHOLDER}
        onDispatch={(action) => dispatch(action)}
        halted={haltCtx.halted}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={ALEX_COMMANDS}
        onSelect={(cmd) => {
          setPaletteOpen(false);
          dispatch({
            kind: "command",
            icon: "·",
            label: cmd.label,
            detail: "",
            raw: "",
            commandId: cmd.id,
          });
        }}
      />
    </div>
  );
}
