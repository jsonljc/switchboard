// Dashboard-local mirror of the extended MetricsViewModel wire shape.
// Pattern: same as mission-types.ts (A.2). Updated alongside the API contract.
// No @switchboard/core import — avoids server-side bundle leakage in Next.js.

import type {
  HeroMetric,
  ProseSegment,
  SparkPoint,
  StatCell,
  DataFreshness,
} from "@/lib/agent-home/types";

export interface MetricsTargets {
  avgValueCents: number | null;
  targetCpbCents: number | null;
}

export interface MetricsViewModelWire {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string;
  targets: MetricsTargets;
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
}
