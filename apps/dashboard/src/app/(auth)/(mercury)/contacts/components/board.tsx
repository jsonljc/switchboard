"use client";

import type { OpportunityStage, PipelineBoardOpportunity } from "@switchboard/schemas";
import { Column, PIPELINE_STAGES, type StageDescriptor } from "./column";
import styles from "../pipeline.module.css";

export function Board({
  rows,
  now,
  draggingId,
  overStage,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onOpenCard,
}: {
  rows: PipelineBoardOpportunity[];
  now: Date;
  draggingId: string | null;
  overStage: OpportunityStage | null;
  onDragOver: (stageKey: OpportunityStage) => void;
  onDragLeave: (stageKey: OpportunityStage) => void;
  onDrop: (stageKey: OpportunityStage) => void;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onOpenCard: (opp: PipelineBoardOpportunity) => void;
}) {
  const byStage = groupByStage(rows);
  return (
    <div className={styles.board}>
      <div className={styles.boardInner}>
        {PIPELINE_STAGES.map((stage) => (
          <Column
            key={stage.key}
            stage={stage}
            opportunities={byStage.get(stage.key) ?? []}
            dragOver={overStage === stage.key}
            draggingId={draggingId}
            now={now}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onCardDragStart={onCardDragStart}
            onCardDragEnd={onCardDragEnd}
            onOpenCard={onOpenCard}
          />
        ))}
      </div>
      <p className={styles.boardFootnote}>
        won &amp; lost are terminal · nurturing parks the long tail · drag cards to move
      </p>
    </div>
  );
}

function groupByStage(
  rows: PipelineBoardOpportunity[],
): Map<OpportunityStage, PipelineBoardOpportunity[]> {
  const map = new Map<OpportunityStage, PipelineBoardOpportunity[]>();
  for (const stage of PIPELINE_STAGES) map.set(stage.key, []);
  for (const row of rows) {
    map.get(row.stage)?.push(row);
  }
  return map;
}

// Re-export so the page composition has one import surface.
export type { StageDescriptor };
export { PIPELINE_STAGES };
