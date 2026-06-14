"use client";

import { useAgentPipeline } from "@/hooks/use-agent-pipeline";
import { QueryStates } from "@/components/query-states";
import styles from "./agent-panel.module.css";

const STAGE_LABEL: Record<"hot" | "warm" | "new", string> = {
  hot: "Hot",
  warm: "Warm",
  new: "New",
};
const MAX_TILES = 5;

/**
 * Slot: Alex's live consultations pipeline — leads by stage, from the
 * already-wired (tested) pipeline read. This gives the previously orphaned
 * useAgentPipeline hook its first importer.
 *
 * Three-states invariant via <QueryStates>:
 *   loading → skeleton
 *   error   → "Couldn't load pipeline"
 *   empty   → "No active consultations"
 *   data    → "{totalCount} {countNoun} in pipeline" + up to 5 tiles by stage
 *
 * Tiles are read-only rows; deep-link navigation defers to contacts-live
 * gating (out of F10 scope), so no clickable link is rendered here.
 */
export function AlexPipeline() {
  const pipeline = useAgentPipeline("alex");
  return (
    <QueryStates
      query={pipeline}
      isEmpty={(d) => d.tiles.length === 0}
      loading={
        <div className={styles.logSection} data-kind="loading" aria-busy="true">
          <div className={styles.logSkeleton} />
        </div>
      }
      error={
        <div className={styles.logSection}>
          <p className={`${styles.logEmptyLine} ${styles.logEmptyErr}`}>
            {"Couldn't load pipeline"}
          </p>
        </div>
      }
      empty={
        <div className={styles.logSection}>
          <p className={styles.logEmptyLine}>{"No active consultations"}</p>
        </div>
      }
    >
      {(vm) => {
        // AlexPipeline is Alex-scoped, so countNoun is always the plural
        // "people"; singularize at a count of 1 to avoid "1 people".
        const noun = vm.totalCount === 1 ? "person" : vm.countNoun;
        return (
          <div className={styles.logSection} data-testid="alex-pipeline">
            <div className={styles.logSectionH}>
              <span className={styles.logSectionTitle}>
                {`${vm.totalCount} ${noun} in pipeline`}
              </span>
            </div>
            <div className={styles.apLog} role="list" aria-label="Pipeline">
              {vm.tiles.slice(0, MAX_TILES).map((t) => (
                <div key={t.id} className={styles.apLogRow} role="listitem">
                  <span className={styles.apLogText}>{`${t.name} · ${t.ctx}`}</span>
                  <span className={styles.apLogTime}>{STAGE_LABEL[t.stage]}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }}
    </QueryStates>
  );
}
