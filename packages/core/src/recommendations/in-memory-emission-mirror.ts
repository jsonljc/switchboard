import type { RecommendationStore } from "./interfaces.js";
import type { Recommendation, PersistRecommendationInput } from "./types.js";
import type { WorkTrace } from "../platform/work-trace.js";
import type { RecommendationEmissionMirror } from "./emission-mirror.js";

export interface CapturedTrace {
  workUnitId: string;
  idempotencyKey?: string;
  trace: WorkTrace;
}

export interface CreateInMemoryEmissionMirrorOptions {
  store: RecommendationStore;
  traces: CapturedTrace[];
  /**
   * Optional hook invoked between the recommendation insert and the trace
   * capture. Tests use it to simulate trace-persist failures and exercise the
   * rollback path.
   */
  onTracePersist?: (trace: WorkTrace) => void;
}

/**
 * In-memory mirror used by tests + dev. Simulates atomic dual-write by:
 *   1. Inserting the recommendation first.
 *   2. Invoking onTracePersist if provided (used to simulate persist failures).
 *   3. If onTracePersist throws, rolling back the recommendation insert.
 *
 * Idempotency: when the recommendation insert reports idempotent=true (existing
 * row found), the trace is NOT captured a second time.
 */
export function createInMemoryEmissionMirror(
  opts: CreateInMemoryEmissionMirrorOptions,
): RecommendationEmissionMirror {
  return {
    async recordEmission({ recommendationInsert, workTrace }) {
      const inserted = await opts.store.insert(recommendationInsert);
      if (inserted.idempotent) {
        return inserted;
      }
      try {
        opts.onTracePersist?.(workTrace);
      } catch (err) {
        // Roll back the recommendation insert by deleting from the in-memory
        // store's internal arrays. The in-memory store exposes rows + byKey on
        // its instance type; we narrow defensively in case a future store
        // implementation omits them.
        const exposed = opts.store as RecommendationStore & {
          rows?: Recommendation[];
          byKey?: Map<string, Recommendation>;
        };
        if (exposed.rows) {
          const idx = exposed.rows.findIndex((r) => r.id === inserted.row.id);
          if (idx >= 0) exposed.rows.splice(idx, 1);
        }
        if (exposed.byKey) exposed.byKey.delete(recommendationInsert.idempotencyKey);
        throw err;
      }
      opts.traces.push({
        workUnitId: workTrace.workUnitId,
        idempotencyKey: workTrace.idempotencyKey,
        trace: workTrace,
      });
      return inserted;
    },
  };
}

export type { PersistRecommendationInput };
