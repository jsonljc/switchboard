"use client";

import { useState } from "react";
import { MiraHeader } from "@/components/cockpit/mira/mira-header";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";
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
  const working = (meta?.renderingCount ?? 0) > 0;

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
      {/* Light chrome band above the immersive feed body: the header stays on
          the warm canvas; only the clip viewport below is the night register. */}
      <div style={{ position: "relative", background: T.bg }}>
        <MiraHeader
          status={working ? "working" : "idle"}
          halted={haltCtx.halted}
          subtitle={countLine ?? MIRA_MISSION_SUBTITLE}
          line={line}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
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
