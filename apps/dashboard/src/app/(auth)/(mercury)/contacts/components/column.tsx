"use client";

import type { DragEvent } from "react";
import type { OpportunityStage, PipelineBoardOpportunity } from "@switchboard/schemas";
import { OpportunityCard } from "./opportunity-card";
import { PerColumnEmpty } from "./empty-states";
import { formatSGD } from "./format";
import styles from "../pipeline.module.css";

export type StageDescriptor = {
  key: OpportunityStage;
  label: string;
  subtitle: string;
  tone: "neutral" | "accent" | "closed" | "parking";
};

const TERMINAL_STAGES = new Set<OpportunityStage>(["won", "lost"]);

export function Column({
  stage,
  opportunities,
  dragOver,
  draggingId,
  now,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onOpenCard,
}: {
  stage: StageDescriptor;
  opportunities: PipelineBoardOpportunity[];
  dragOver: boolean;
  draggingId: string | null;
  now: Date;
  onDragOver: (stageKey: OpportunityStage) => void;
  onDragLeave: (stageKey: OpportunityStage) => void;
  onDrop: (stageKey: OpportunityStage) => void;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onOpenCard: (opp: PipelineBoardOpportunity) => void;
}) {
  const isTerminal = TERMINAL_STAGES.has(stage.key);
  const sumCents = opportunities.reduce(
    (acc, o) => acc + (isTerminal ? o.revenueTotal : (o.estimatedValue ?? 0)),
    0,
  );

  function preventDefault(event: DragEvent<HTMLElement>) {
    event.preventDefault();
  }

  return (
    <section
      className={styles.column}
      data-tone={stage.tone}
      data-over={dragOver || undefined}
      onDragOver={(e) => {
        preventDefault(e);
        onDragOver(stage.key);
      }}
      onDragLeave={() => onDragLeave(stage.key)}
      onDrop={(e) => {
        preventDefault(e);
        onDrop(stage.key);
      }}
    >
      <header className={styles.columnHeader}>
        <div className={styles.columnLabelRow}>
          <span className={styles.columnLabel}>
            {stage.tone === "accent" && (
              <span className={styles.columnAccentDot} aria-hidden="true" />
            )}
            {stage.tone === "parking" && (
              <span className={styles.columnParkingDot} aria-hidden="true" />
            )}
            {stage.label}
          </span>
          <span className={styles.columnCount} data-tabular>
            {opportunities.length}
          </span>
        </div>
        <div className={styles.columnSumRow}>
          <span className={styles.columnSum} data-tabular>
            {sumCents > 0 ? formatSGD(sumCents, { forceZero: true }) : isTerminal ? "S$0" : "—"}
          </span>
          <span className={styles.columnSubtitle}>{stage.subtitle}</span>
        </div>
      </header>
      <div className={styles.columnBody}>
        {opportunities.length === 0 ? (
          <PerColumnEmpty stage={stage.key} />
        ) : (
          opportunities.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              now={now}
              dragging={draggingId === opp.id}
              onDragStart={onCardDragStart}
              onDragEnd={onCardDragEnd}
              onOpen={onOpenCard}
            />
          ))
        )}
      </div>
    </section>
  );
}

export const PIPELINE_STAGES: StageDescriptor[] = [
  { key: "interested", label: "Interested", subtitle: "top of funnel", tone: "neutral" },
  { key: "qualified", label: "Qualified", subtitle: "fit confirmed", tone: "neutral" },
  { key: "quoted", label: "Quoted", subtitle: "price on table", tone: "accent" },
  { key: "booked", label: "Booked", subtitle: "appt confirmed", tone: "accent" },
  { key: "showed", label: "Showed", subtitle: "arrived in clinic", tone: "accent" },
  { key: "won", label: "Won", subtitle: "revenue captured", tone: "closed" },
  { key: "lost", label: "Lost", subtitle: "closed out", tone: "closed" },
  { key: "nurturing", label: "Nurturing", subtitle: "long-tail · re-engage", tone: "parking" },
];
