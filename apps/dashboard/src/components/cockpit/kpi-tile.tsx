import type { CSSProperties } from "react";
import { T } from "./tokens";
import type { KpiTile as KpiTileData } from "./types";

type KpiTileProps = KpiTileData;

function trendSign(trend: string): "up" | "down" | "flat" {
  if (trend.startsWith("+")) return "up";
  if (trend.startsWith("-")) return "down";
  return "flat";
}

function trendColor(sign: "up" | "down" | "flat"): string {
  if (sign === "up") return T.green;
  if (sign === "down") return T.red;
  return T.ink4;
}

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: T.ink3,
  textTransform: "uppercase",
};

const valueStyleBase: CSSProperties = {
  marginTop: 4,
  fontSize: 26,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  lineHeight: 1,
};

export function KpiTile({ label, value, unit, trend, unavailable, hint }: KpiTileProps) {
  if (unavailable) {
    return (
      <div>
        <div style={labelStyle}>{label}</div>
        <div data-tabular style={{ ...valueStyleBase, color: T.ink5 }}>
          {value}
        </div>
        {hint ? (
          <button
            type="button"
            style={{
              marginTop: 4,
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
              color: T.ink3,
              fontFamily: "JetBrains Mono",
              letterSpacing: "0.02em",
              borderBottom: `1px dashed ${T.hair}`,
            }}
          >
            {hint} →
          </button>
        ) : null}
      </div>
    );
  }

  const sign = trend ? trendSign(trend) : null;

  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div
        data-tabular
        style={{
          ...valueStyleBase,
          color: T.ink,
          display: "flex",
          alignItems: "baseline",
          gap: 3,
        }}
      >
        {value}
        {unit ? <span style={{ fontSize: 13, color: T.ink3, fontWeight: 500 }}>{unit}</span> : null}
      </div>
      {trend && sign ? (
        <div
          data-tabular
          data-trend-sign={sign}
          style={{
            marginTop: 4,
            fontSize: 11,
            fontWeight: 500,
            color: trendColor(sign),
            fontFamily: "JetBrains Mono",
            letterSpacing: "0.02em",
          }}
        >
          {trend}
        </div>
      ) : null}
    </div>
  );
}
