import type { MarkActedByExecutionResult } from "@switchboard/db";
import {
  HANDOFF_EXECUTION_RESOLVED_BY,
  type RecommendationHandoffDeps,
} from "../services/workflows/recommendation-handoff-workflow.js";

/**
 * The handoff-specific markRecommendationActed builder over the db store. A
 * sibling of the pause (riley-pause-executor.ts) and reallocate
 * (riley-budget-executor.ts) builders, distinct ONLY because the resolvedBy
 * sentinel differs (HANDOFF_EXECUTION_RESOLVED_BY): reusing another executor's
 * builder would stamp the wrong machine provenance on a creative handoff act. The
 * type-only db import above is erased at build time. Extracted + exported so the
 * sentinel + arg mapping are unit-testable without standing up the workflow.
 */
export function buildMarkHandoffRecommendationActed(store: {
  markActedByExecution(args: {
    id: string;
    organizationId: string;
    executableWorkUnitId: string;
    resolvedBy: string;
    executedAt: Date;
  }): Promise<MarkActedByExecutionResult>;
}): RecommendationHandoffDeps["markRecommendationActed"] {
  return (args) =>
    store.markActedByExecution({
      id: args.recommendationId,
      organizationId: args.organizationId,
      executableWorkUnitId: args.executableWorkUnitId,
      resolvedBy: HANDOFF_EXECUTION_RESOLVED_BY,
      executedAt: args.executedAt,
    });
}
