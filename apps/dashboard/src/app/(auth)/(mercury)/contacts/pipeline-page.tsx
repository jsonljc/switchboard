"use client";

import { useEffect, useMemo, useState } from "react";
import type { OpportunityStage, PipelineBoardOpportunity } from "@switchboard/schemas";
import { useOpportunitiesBoard } from "./hooks/use-opportunities-board";
import { useOpportunityStageTransition } from "./hooks/use-opportunity-stage-transition";
import { useRightDrawer } from "@/components/layout/right-drawer-context";
import { Board } from "./components/board";
import { PIPELINE_STAGES } from "./components/column";
import { FilterStrip, type FilterState } from "./components/filter-strip";
import { PipelineHeader } from "./components/header";
import { DetailDrawer } from "./components/detail-drawer";
import { Toast, type ToastVariant } from "./components/toast";
import { WholeBoardEmpty, BoardSkeleton, WholeBoardError } from "./components/empty-states";
import { PIPELINE_FIXTURE_NOW } from "./fixtures";
import styles from "./pipeline.module.css";

const TERMINAL = new Set<OpportunityStage>(["won", "lost"]);
const PARKING = new Set<OpportunityStage>(["nurturing"]);
const RANGES: Record<Exclude<FilterState["range"], "all">, number> = {
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 86400 * 1000,
  "30d": 30 * 86400 * 1000,
};
const STAGE_LABEL = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s.label])) as Record<
  OpportunityStage,
  string
>;

export function PipelinePage() {
  const board = useOpportunitiesBoard();
  const transition = useOpportunityStageTransition();
  const drawer = useRightDrawer();

  const [filters, setFilters] = useState<FilterState>({ range: "all", qualifiedOnly: false });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<OpportunityStage | null>(null);
  const [openOpp, setOpenOpp] = useState<PipelineBoardOpportunity | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);

  const rows = board.data?.rows ?? [];

  const [now, setNow] = useState<Date>(() => (board.isLoading ? PIPELINE_FIXTURE_NOW : new Date()));
  useEffect(() => {
    if (board.isLoading) {
      setNow(PIPELINE_FIXTURE_NOW);
      return;
    }
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [board.isLoading]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filters.range !== "all") {
        const diff = Date.now() - new Date(row.updatedAt).getTime();
        if (diff > RANGES[filters.range]) return false;
      }
      if (filters.qualifiedOnly && !row.qualificationComplete) return false;
      return true;
    });
  }, [rows, filters]);

  const aggregates = useMemo(() => {
    let openCents = 0;
    let openCount = 0;
    let wonCents = 0;
    let wonCount = 0;
    for (const r of filtered) {
      if (r.stage === "won") {
        wonCents += r.revenueTotal;
        wonCount += 1;
      } else if (!TERMINAL.has(r.stage) && !PARKING.has(r.stage)) {
        openCents += r.estimatedValue ?? 0;
        openCount += 1;
      }
    }
    return { openCents, openCount, wonCents, wonCount };
  }, [filtered]);

  function onCardDragStart(id: string) {
    setDraggingId(id);
  }
  function onCardDragEnd() {
    setDraggingId(null);
    setOverStage(null);
  }
  function onDragOver(stage: OpportunityStage) {
    setOverStage((prev) => (prev === stage ? prev : stage));
  }
  function onDragLeave(stage: OpportunityStage) {
    setOverStage((prev) => (prev === stage ? null : prev));
  }
  function mutateStage(id: string, nextStage: OpportunityStage) {
    const target = rows.find((r) => r.id === id);
    if (!target || target.stage === nextStage) return;
    const previousStage = target.stage;
    const firstName = target.contact.name.split(" ")[0] ?? target.contact.name;
    transition.mutate(
      { id, stage: nextStage },
      {
        onSuccess: () => {
          setToast({
            message: `Moved ${firstName} to ${STAGE_LABEL[nextStage]}.`,
            variant: "success",
          });
        },
        onError: () => {
          setToast({
            message: `Couldn't save that move — ${firstName} is back in ${STAGE_LABEL[previousStage]}. Try again in a moment.`,
            variant: "error",
          });
        },
      },
    );
  }
  function onDrop(stage: OpportunityStage) {
    if (!draggingId) return;
    const id = draggingId;
    setOverStage(null);
    setDraggingId(null);
    mutateStage(id, stage);
  }
  function onOpenCard(opp: PipelineBoardOpportunity) {
    setOpenOpp(opp);
    drawer.open("opportunity");
  }

  // Keep the drawer's data in sync with cache updates (drag-to-move while drawer is open).
  const drawerOpp = useMemo(() => {
    if (!openOpp) return null;
    return rows.find((r) => r.id === openOpp.id) ?? openOpp;
  }, [openOpp, rows]);

  return (
    <div className={styles.pipelinePage}>
      <PipelineHeader
        openCents={aggregates.openCents}
        openCount={aggregates.openCount}
        wonCents={aggregates.wonCents}
        wonCount={aggregates.wonCount}
        filters={filters}
        saving={transition.isPending}
      />
      <FilterStrip
        filters={filters}
        total={rows.length}
        filteredCount={filtered.length}
        onChange={setFilters}
        onClear={() => setFilters({ range: "all", qualifiedOnly: false })}
      />
      {/* Render ladder is exhaustive over {data, isError}. The pending gate is
          `!data && !isError` (NOT board.isLoading): React Query's enabled:false
          pending state — while session/org keys resolve — reports isLoading
          false with data still undefined, which previously fell through to the
          (dishonest) whole-board empty state before any fetch ran. */}
      {!board.data && !board.isError ? (
        <BoardSkeleton />
      ) : board.isError ? (
        <WholeBoardError onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        <WholeBoardEmpty />
      ) : (
        <Board
          rows={filtered}
          now={now}
          draggingId={draggingId}
          overStage={overStage}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onCardDragStart={onCardDragStart}
          onCardDragEnd={onCardDragEnd}
          onOpenCard={onOpenCard}
        />
      )}
      <DetailDrawer
        opportunity={drawerOpp}
        now={now}
        onStageChange={({ id, stage }) => mutateStage(id, stage)}
      />
      <Toast
        message={toast?.message ?? null}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
