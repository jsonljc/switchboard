import type { WeekContext } from "./metrics-buckets.js";

export interface ProseSegment {
  kind: "text" | "accent";
  text: string;
}

export interface MetricComparator {
  window: "week";
  value: number;
}

export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | {
      kind: "revenue-attributed";
      value: number;
      currency: string;
      comparator: MetricComparator;
    };

export interface SparkPoint {
  label: string;
  value: number;
  isProjection?: boolean;
}

export interface StatCell {
  label: string;
  display: string;
  rawValue: number | null;
  unit: "count" | "percent" | "currency";
  unavailable?: boolean;
}

export interface DataFreshness {
  generatedAt: string;
  window: "week";
  dataSource: "live" | "fixture";
  unavailableSources?: readonly string[];
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string;
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
}

export interface MetricsSignalStore {
  countBookingsCreated(input: {
    orgId: string;
    excludeStatuses: readonly string[];
    from: Date;
    to: Date;
  }): Promise<number>;

  countConversionsByType(input: {
    orgId: string;
    type: string;
    from: Date;
    to: Date;
  }): Promise<number>;

  getMetaSpendCents(input: { orgId: string; from: Date; to: Date }): Promise<number | null>;
}

export interface PerAgentBuilderInput {
  orgId: string;
  week: WeekContext;
  store: MetricsSignalStore;
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
}
