"use client";

import { useState } from "react";
import { Identity } from "@/components/cockpit/identity";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT, MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { MiraCreativeFeed } from "./mira-creative-feed";

export function MiraFeedPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const feedQ = useMiraFeed();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;
  const meta = feedQ.data?.feed;
  const countLine = meta
    ? `${meta.reviewableCount} draft${meta.reviewableCount === 1 ? "" : "s"} to review${meta.renderingCount > 0 ? ` · ${meta.renderingCount} still rendering` : ""}`
    : null;

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      <div style={{ position: "relative", background: "#fff" }}>
        <Identity
          statusKey="IDLE"
          halted={haltCtx.halted}
          subtitle={countLine ?? MIRA_MISSION_SUBTITLE}
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <MiraCreativeFeed />
      </div>
    </div>
  );
}
