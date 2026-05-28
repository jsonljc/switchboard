// apps/dashboard/src/components/cockpit/mira-cockpit-page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { Identity } from "./identity";
import { KPIStrip } from "./kpi-strip";
import { MissionPopover } from "./mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useAgentPipeline } from "@/hooks/use-agent-pipeline";
import { useHalt } from "@/components/layout/halt/halt-context";
import { resolveAgentHomeLink } from "@/lib/agent-home/resolve-link";
import { metricsViewModelToMiraKpiData } from "@/lib/cockpit/mira/metrics-to-kpi-data";
import {
  MIRA_ACCENT,
  MIRA_MISSION_SUBTITLE,
  MIRA_FOOTER_NOTE,
  MIRA_EMPTY_TITLE,
  MIRA_EMPTY_BODY,
} from "@/lib/cockpit/mira/mira-config";
import type { CockpitKpiData } from "./types";

export function MiraCockpitPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const metricsQ = useAgentMetrics("mira");
  const mission = useAgentMission("mira");
  const pipelineQ = useAgentPipeline("mira");
  const router = useRouter();
  const [missionOpen, setMissionOpen] = useState(false);

  // Adapter returns null when the wire VM is missing tiles — the page renders no
  // KPI strip rather than falling back to Alex's legacyTiles() derivation.
  const kpis: CockpitKpiData | null = metricsQ.data
    ? metricsViewModelToMiraKpiData(metricsQ.data)
    : null;
  const tiles = pipelineQ.data?.tiles ?? [];
  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;

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
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ position: "relative" }}>
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
        {kpis ? <KPIStrip kpis={kpis} collapsed={false} accent={MIRA_ACCENT} /> : null}

        {tiles.length === 0 ? (
          <div style={{ margin: "32px 28px", color: T.ink3 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: T.ink }}>{MIRA_EMPTY_TITLE}</div>
            <div>{MIRA_EMPTY_BODY}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "20px 28px 0" }}>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: T.ink3,
              }}
            >
              Drafts — for your review
            </div>
            {tiles.map((tile) => {
              const resolved = resolveAgentHomeLink(tile.link);
              return (
                <button
                  key={tile.id}
                  disabled={resolved.disabled}
                  onClick={() => {
                    if (!resolved.disabled) router.push(resolved.href);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `1px solid ${MIRA_ACCENT.soft}`,
                    background: T.paper,
                    cursor: resolved.disabled ? "default" : "pointer",
                    opacity: resolved.disabled ? 0.7 : 1,
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{tile.name}</div>
                  <div style={{ fontSize: 13, color: T.ink3 }}>{tile.ctx}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* M1: NO composer on /mira (no new submission from the Mira UI). An inert
          input is a UX trap; explain where drafts originate instead. */}
      <div
        style={{
          padding: "14px 28px",
          borderTop: `1px solid ${MIRA_ACCENT.soft}`,
          fontSize: 13,
          color: T.ink3,
        }}
      >
        {MIRA_FOOTER_NOTE}
      </div>
    </div>
  );
}
