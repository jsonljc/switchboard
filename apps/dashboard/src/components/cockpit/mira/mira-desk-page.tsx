"use client";

import { useState } from "react";
import { Identity } from "@/components/cockpit/identity";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraDesk } from "@/hooks/use-mira-desk";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT, MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";
import { QueryStates, ConnectionTrouble } from "@/components/query-states";
import { MiraReadyToReview } from "./mira-ready-to-review";
import { MiraInProductionTray } from "./mira-in-production-tray";
import { MiraBriefBox } from "./mira-brief-box";
import { MiraKeptShelf } from "./mira-kept-shelf";
import { MiraDeskSkeleton } from "./mira-desk-skeleton";

// Phase-2 Director's Desk. Module order (Decision 3): brief box (PR3) · the one
// hero Ready-to-review CTA · calm In-production tray · Kept-drafts shelf (PR4).
export function MiraDeskPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const deskQ = useMiraDesk();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: T.bg,
      }}
    >
      <div style={{ position: "relative", background: T.paper }}>
        <Identity
          statusKey="IDLE"
          halted={haltCtx.halted}
          subtitle={MIRA_MISSION_SUBTITLE}
          line={line}
          onHaltToggle={haltCtx.toggleHalt}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
          displayName="Mira"
          avatarAccent={{ soft: MIRA_ACCENT.soft, deep: MIRA_ACCENT.deep }}
        />
        {mission.data ? (
          <MissionPopover
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            mission={mission.data.mission}
            agentLabel="Mira"
          />
        ) : null}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* No empty slot: an empty desk still renders the modules — crucially the
            MiraBriefBox, the operator's only way to request a first draft. The
            trays/hero own their own empty copy. (Reviewed: gating the whole desk
            on emptiness hid the brief box for new orgs.) Halt shows in the header. */}
        <QueryStates
          query={deskQ}
          loading={<MiraDeskSkeleton />}
          error={<ConnectionTrouble agentName="Mira" onRetry={deskQ.refetch} />}
        >
          {(desk) => (
            <>
              <MiraBriefBox />
              <MiraReadyToReview count={desk.readyToReviewCount} />
              <MiraInProductionTray items={desk.inProduction} />
              <MiraKeptShelf items={desk.keptDrafts} />
            </>
          )}
        </QueryStates>
      </div>
    </div>
  );
}
