"use client";

import { T, type AccentTokens } from "./tokens";
import { KpiTile } from "./kpi-tile";
import { ROIBar } from "./roi-bar";
import {
  legacyTiles,
  legacyRoi,
  collapsedHeadline,
  type LegacyKpiInput,
} from "@/lib/cockpit/legacy-shapes";
import type { CockpitKpiData } from "./types";

interface KPIStripProps {
  kpis: CockpitKpiData;
  collapsed?: boolean;
  accent?: AccentTokens;
}

function toLegacyInput(kpis: CockpitKpiData): LegacyKpiInput {
  return {
    booked: kpis.booked ?? null,
    bookedDelta: kpis.bookedDelta ?? null,
    leads: kpis.leads ?? null,
    leadsDelta: kpis.leadsDelta ?? null,
    qualifiedPct: kpis.qualifiedPct ?? null,
    qualifiedDelta: kpis.qualifiedDelta ?? null,
    spend: kpis.spend ?? null,
    avgValue: kpis.avgValue ?? null,
    target: kpis.target ?? null,
  };
}

const eyebrowStyle = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: T.ink3,
  textTransform: "uppercase" as const,
};

const openReportButton = (
  <button
    type="button"
    style={{
      all: "unset",
      cursor: "pointer",
      color: T.ink2,
      fontSize: 12,
      fontFamily: "JetBrains Mono",
    }}
    aria-label="Open report"
  >
    Open report →
  </button>
);

export function KPIStrip({ kpis, collapsed = false, accent }: KPIStripProps) {
  const legacy = toLegacyInput(kpis);
  const tiles = kpis.tiles ?? legacyTiles(legacy);
  // Distinguish "no roi field" (undefined → legacy fallback for Alex) from an
  // explicit `null` ("no ROI concept — hide the bar," for Mira). `??` would
  // conflate the two and force every roi-less agent into the legacy
  // "Connect Meta Ads" degraded bar.
  const roi = kpis.roi === undefined ? legacyRoi(legacy) : kpis.roi;

  if (collapsed) {
    const head = collapsedHeadline({ ...kpis, ...legacy });
    return (
      <div
        data-testid="kpi-strip"
        style={{
          padding: "10px 28px",
          borderTop: `1px solid ${T.hair}`,
          borderBottom: `1px solid ${T.hair}`,
          background: T.bg,
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span style={eyebrowStyle}>{kpis.range}</span>
        {head.mode === "explicit" ? (
          <span style={{ fontSize: 13, color: T.ink }}>
            <strong style={{ color: T.ink, fontWeight: 600 }}>{head.value}</strong>
            {head.unit ? <span>{head.unit}</span> : null}
            <span style={{ color: T.ink4 }}> {head.label}</span>
            {head.trend ? (
              <>
                <span style={{ color: T.ink4 }}> · </span>
                <span style={{ color: T.green, fontWeight: 500 }}>{head.trend}</span>
              </>
            ) : null}
          </span>
        ) : (
          <span style={{ fontSize: 13, color: T.ink }}>
            <strong style={{ color: T.ink, fontWeight: 600 }}>{head.bookedValue}</strong>{" "}
            {head.label}
            <span style={{ color: T.ink4 }}> · </span>
            {head.cpb !== null ? (
              <>
                <strong style={{ color: T.ink, fontWeight: 600 }}>${head.cpb}</strong> each
              </>
            ) : (
              <span>— each</span>
            )}
            {head.delta ? (
              <>
                <span style={{ color: T.ink4 }}> · </span>
                <span style={{ color: T.green, fontWeight: 500 }}>{head.delta}</span>
              </>
            ) : null}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {openReportButton}
      </div>
    );
  }

  return (
    <div
      data-testid="kpi-strip"
      style={{
        padding: "16px 28px 20px",
        borderTop: `1px solid ${T.hair}`,
        borderBottom: `1px solid ${T.hair}`,
        background: T.bg,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={eyebrowStyle}>{kpis.range}</span>
        {openReportButton}
      </div>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
          rowGap: 0,
          columnGap: 18,
        }}
      >
        {tiles.map((tile, i) => (
          <KpiTile key={`${tile.label}-${i}`} {...tile} />
        ))}
      </div>
      {roi ? <ROIBar roi={roi} accent={accent} /> : null}
    </div>
  );
}
