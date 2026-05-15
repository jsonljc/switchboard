import type { KpiTile, RoiBar, CockpitKpiData } from "@/components/cockpit/types";

export interface LegacyKpiInput {
  booked: number | null;
  bookedDelta: string | null;
  leads: number | null;
  leadsDelta: string | null;
  qualifiedPct: number | null;
  qualifiedDelta: string | null;
  spend: number | null;
  avgValue: number | null;
  target: number | null;
}

export type CollapsedHeadline =
  | {
      mode: "explicit";
      label: string;
      value: number | string;
      unit?: string;
      trend?: string;
    }
  | {
      mode: "flat";
      bookedValue: number;
      cpb: number | null;
      delta: string | null;
      label: string;
    };

export function legacyTiles(k: LegacyKpiInput): KpiTile[] {
  return [
    { label: "bookings", value: k.booked ?? 0, trend: k.bookedDelta ?? undefined },
    { label: "leads worked", value: k.leads ?? 0, trend: k.leadsDelta ?? undefined },
    {
      label: "qualified",
      value: k.qualifiedPct ?? 0,
      unit: "%",
      trend: k.qualifiedDelta ?? undefined,
    },
    k.spend === null
      ? { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" }
      : { label: "ad spend", value: `$${k.spend}` },
  ];
}

export function legacyRoi(k: LegacyKpiInput): RoiBar {
  // Hint priority — first match wins. See brief §ROI hint priority.
  // Rule 1: spend === null → Meta Ads hint (regardless of avgValue).
  if (k.spend === null) {
    return {
      degraded: true,
      degradedHint: "Connect Meta Ads to see return on spend",
      label: "return on spend",
      comparator: {
        value: "—",
        target: k.target !== null ? `target $${k.target}` : "—",
      },
    };
  }
  // Rule 2: spend > 0 && avgValue === null → Set-avg-value hint.
  if (k.avgValue === null) {
    const cpb = k.booked && k.booked > 0 ? Math.round(k.spend / k.booked) : null;
    return {
      degraded: true,
      degradedHint: "Set average booking value to see return on spend",
      label: "return on spend",
      comparator: {
        value: cpb !== null ? `$${cpb} per booking` : "—",
        target: k.target !== null ? `target $${k.target}` : "—",
      },
    };
  }
  // Rule 3: spend > 0 && avgValue != null && bookings <= 0 → degraded with
  // comparator "—" and **no hint copy**. The degradation is "no math possible
  // yet — wait for bookings," not a missing setup step.
  if (k.booked === null || k.booked <= 0) {
    return {
      degraded: true,
      degradedHint: "",
      label: "return on spend",
      comparator: {
        value: "—",
        target: k.target !== null ? `target $${k.target}` : "—",
      },
    };
  }

  // Rule 4: live ROI.
  const booked = k.booked;
  const spend = k.spend;
  const avgValue = k.avgValue;
  const target = k.target ?? 0;
  const earned = booked * avgValue;
  const ratio = spend > 0 ? earned / spend : 0;
  const ratioCap = Math.min(ratio, 6);
  const cpb = booked > 0 ? Math.round(spend / booked) : null;
  const onTarget = cpb !== null && target > 0 && cpb <= target;

  return {
    label: "return on spend",
    leftMeta: `$${spend} spent`,
    rightMeta: { value: `$${earned.toLocaleString()}`, suffix: " in tour value" },
    fillPct: (ratioCap / 6) * 100,
    breakEvenPct: (1 / 6) * 100,
    breakEvenLabel: "break-even",
    scaleLeft: "$0",
    scaleRight: "6× spend",
    comparator: {
      value: cpb !== null ? `$${cpb} per booking` : "—",
      target: target > 0 ? `target $${target}` : "—",
      onTarget,
    },
  };
}

export function collapsedHeadline(k: CockpitKpiData & LegacyKpiInput): CollapsedHeadline {
  if (k.tiles && k.tiles.length > 0) {
    const lead = k.tiles.find((t) => !t.unavailable) ?? k.tiles[0]!;
    return {
      mode: "explicit",
      label: lead.label,
      value: lead.value,
      ...(lead.unit ? { unit: lead.unit } : {}),
      ...(lead.trend ? { trend: lead.trend } : {}),
    };
  }
  const booked = k.booked ?? 0;
  const cpb =
    booked > 0 && k.spend !== null && k.spend !== undefined ? Math.round(k.spend / booked) : null;
  return {
    mode: "flat",
    bookedValue: booked,
    cpb,
    delta: k.bookedDelta ?? null,
    label: "bookings",
  };
}
