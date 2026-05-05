// packages/core/src/reports/types.ts

import type { ReportWindow } from "@switchboard/schemas";

export type { ReportWindow };

export interface PeriodRange {
  start: Date;
  end: Date;
  window: ReportWindow | null;
}

export interface RollupContext {
  orgId: string;
  current: PeriodRange;
  prior: PeriodRange;
  computedAt: Date;
}
