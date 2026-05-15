export const SETTLEMENT_LAG_HOURS = 24;

export const V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"] as const;

export type AttributableKind = (typeof V1_ATTRIBUTABLE_KINDS)[number];

export const KIND_CONFIG = {
  pause: {
    windowDays: 7,
    confidence: "medium" as const,
    primaryMetric: "spend" as const,
    favorableDirection: "down" as const,
    noiseFloorPct: 5,
    minimumAbsoluteMovementCents: 500,
  },
  refresh_creative: {
    windowDays: 14,
    confidence: "low" as const,
    primaryMetric: "ctr" as const,
    favorableDirection: "up" as const,
    noiseFloorPct: 10,
  },
} as const;

export function isAttributableKind(kind: string | undefined | null): kind is AttributableKind {
  return typeof kind === "string" && (V1_ATTRIBUTABLE_KINDS as readonly string[]).includes(kind);
}
