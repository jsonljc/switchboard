"use client";

import { useState } from "react";
import Link from "next/link";
import { Identity } from "@/components/cockpit/identity";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT, MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";

// Phase 2 Director's Desk. PR1 ships the shell: identity header + the one hero
// Ready-to-review CTA into the feed (/mira/review). PR2 adds the In-production
// tray; PR3 adds the brief box at the top; PR4 adds the Kept-drafts shelf.
export function MiraDeskPage() {
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
  const reviewable = feedQ.data?.feed.reviewableCount ?? 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: MIRA_ACCENT.paper,
      }}
    >
      <div style={{ position: "relative", background: "#fff" }}>
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
        <section
          aria-label="Ready to review"
          style={{
            background: "#fff",
            borderRadius: 14,
            padding: 16,
            border: `1px solid ${MIRA_ACCENT.soft}`,
          }}
        >
          {reviewable > 0 ? (
            <Link
              href="/mira/review"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                textDecoration: "none",
                color: MIRA_ACCENT.deep,
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {reviewable} draft{reviewable === 1 ? "" : "s"} ready to review
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <p style={{ margin: 0, color: MIRA_ACCENT.deep, fontSize: 14 }}>
              Nothing to review yet. New drafts land here when Mira finishes.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
