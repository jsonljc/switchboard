"use client";

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
  PipelineBoardOpportunitySchema,
  TERMINAL_OPPORTUNITY_STAGES,
  type OpportunityStage,
  type PipelineBoardOpportunity,
  type PipelineBoardResponse,
} from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";

const TERMINAL = new Set<OpportunityStage>(TERMINAL_OPPORTUNITY_STAGES);

export type StageTransitionInput = { id: string; stage: OpportunityStage };

type Context = { previous: PipelineBoardResponse | undefined } | undefined;

const FIXTURE_LATENCY_MS = 700;

export function useOpportunityStageTransition(): UseMutationResult<
  PipelineBoardOpportunity | null,
  Error,
  StageTransitionInput,
  Context
> {
  const keys = useScopedQueryKeys();
  const qc = useQueryClient();
  const live = isMercuryToolLive("contacts");

  return useMutation<PipelineBoardOpportunity | null, Error, StageTransitionInput, Context>({
    mutationFn: async ({ id, stage }) => {
      if (!live) {
        // Match the mockup's quiet save: brief delay before the toast fires.
        await new Promise((r) => setTimeout(r, FIXTURE_LATENCY_MS));
        return null;
      }
      const res = await fetch(`/api/dashboard/opportunities/${id}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        throw new Error(`Stage transition failed: ${res.status}`);
      }
      const body = (await res.json()) as { opportunity: unknown };
      return PipelineBoardOpportunitySchema.parse(body.opportunity);
    },
    onMutate: async ({ id, stage }) => {
      if (!keys) return undefined;
      const key = keys.opportunities.board();
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PipelineBoardResponse>(key);
      if (!previous) return { previous };

      const now = new Date().toISOString();
      const nextRows = previous.rows.map((row) => {
        if (row.id !== id) return row;
        const becomingTerminal = TERMINAL.has(stage);
        return {
          ...row,
          stage,
          updatedAt: now,
          closedAt: becomingTerminal ? (row.closedAt ?? now) : null,
        };
      });
      qc.setQueryData<PipelineBoardResponse>(key, { rows: nextRows });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (!keys || !ctx?.previous) return;
      qc.setQueryData(keys.opportunities.board(), ctx.previous);
    },
    onSettled: () => {
      if (!keys || !live) return;
      void qc.invalidateQueries({ queryKey: keys.opportunities.board() });
    },
  });
}
