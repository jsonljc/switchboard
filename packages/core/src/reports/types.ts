import type { ReportWindow } from "@switchboard/schemas";

export type { ReportWindow };

/** Inclusive-start, exclusive-end timestamp range for a report window. */
export interface PeriodRange {
  start: Date;
  end: Date;
  /** Window the range was derived from; null for synthetic prior-period ranges. */
  window: ReportWindow | null;
}

/** Carries org + period through a rollup. Each rollup function takes this and returns its section. */
export interface RollupContext {
  orgId: string;
  current: PeriodRange;
  prior: PeriodRange;
  /** Server "now" when the rollup started, used for cache computedAt. */
  computedAt: Date;
}
