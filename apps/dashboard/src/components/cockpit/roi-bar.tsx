import type { CSSProperties } from "react";
import { T } from "./tokens";
import type { RoiBar } from "./types";

const eyebrowStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: T.ink3,
  textTransform: "uppercase",
};

const comparatorBaseStyle: CSSProperties = {
  fontFamily: "JetBrains Mono",
  fontSize: 12,
  fontWeight: 600,
};

interface ROIBarProps {
  roi: RoiBar;
}

function isDegraded(roi: RoiBar): roi is Extract<RoiBar, { degraded: true }> {
  return "degraded" in roi && roi.degraded === true;
}

export function ROIBar({ roi }: ROIBarProps) {
  if (isDegraded(roi)) {
    return (
      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: `1px dashed ${T.hair}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={eyebrowStyle}>{roi.label ?? "return on spend"}</span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="roi-comparator"
          data-on-target="false"
          style={{
            ...comparatorBaseStyle,
            color: T.ink3,
            fontWeight: 500,
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${T.hair}`,
            background: T.paper,
          }}
        >
          {roi.comparator.value}
          <span style={{ color: T.ink4 }}> · {roi.comparator.target}</span>
        </span>
        <span style={{ fontSize: 12, color: T.ink4 }}>{roi.degradedHint}</span>
      </div>
    );
  }

  const fillPctClamped = Math.max(0, Math.min(100, roi.fillPct));
  const breakEvenPctClamped = Math.max(0, Math.min(100, roi.breakEvenPct));
  const onTarget = roi.comparator.onTarget;

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${T.hair}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={eyebrowStyle}>{roi.label}</span>
        <span data-tabular style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: T.ink2 }}>
          {roi.leftMeta}
          <span style={{ color: T.ink4 }}> · </span>
          <span style={{ color: T.ink, fontWeight: 600 }}>{roi.rightMeta.value}</span>
          <span>{roi.rightMeta.suffix}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="roi-comparator"
          data-on-target={String(onTarget)}
          style={{
            ...comparatorBaseStyle,
            color: onTarget ? T.green : T.amberDeep,
          }}
        >
          {roi.comparator.value}
          <span style={{ color: T.ink4, fontWeight: 400 }}> · {roi.comparator.target}</span>
        </span>
      </div>
      <div
        style={{
          marginTop: 10,
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: "rgba(14,12,10,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="roi-bar-fill"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${fillPctClamped}%`,
            background: `linear-gradient(90deg, ${T.amberSoft} 0%, ${T.amber} 100%)`,
          }}
        />
        <div
          data-testid="roi-bar-break-even"
          style={{
            position: "absolute",
            left: `${breakEvenPctClamped}%`,
            top: -2,
            bottom: -2,
            width: 1,
            background: T.ink4,
          }}
          aria-label={roi.breakEvenLabel}
        />
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "JetBrains Mono",
          fontSize: 11,
          color: T.ink4,
        }}
      >
        <span>{roi.scaleLeft}</span>
        <span>{roi.scaleRight}</span>
      </div>
    </div>
  );
}
