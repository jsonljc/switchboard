import type {
  OpportunityStage,
  PipelineBoardOpportunity,
  PipelineBoardResponse,
} from "@switchboard/schemas";
import type {
  OpportunityStore,
  OpportunityBoardRow,
  TransitionStageInput,
} from "./opportunity-store.js";
export { OpportunityNotFoundError } from "./opportunity-store.js";

function toBoardRow(row: OpportunityBoardRow): PipelineBoardOpportunity {
  return {
    id: row.id,
    contactId: row.contactId,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    stage: row.stage,
    timeline: row.timeline ?? undefined,
    priceReadiness: row.priceReadiness ?? undefined,
    objections: row.objections.map((o) => ({
      category: o.category,
      raisedAt: o.raisedAt instanceof Date ? o.raisedAt.toISOString() : o.raisedAt,
      resolvedAt:
        o.resolvedAt === null || o.resolvedAt === undefined
          ? null
          : o.resolvedAt instanceof Date
            ? o.resolvedAt.toISOString()
            : o.resolvedAt,
    })),
    qualificationComplete: row.qualificationComplete,
    estimatedValue: row.estimatedValue,
    revenueTotal: row.revenueTotal,
    assignedAgent: row.assignedAgent,
    assignedStaff: row.assignedStaff,
    lostReason: row.lostReason,
    notes: row.notes,
    openedAt: row.openedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    contact: {
      id: row.contact.id,
      name: row.contact.name.trim() === "" ? "Unknown" : row.contact.name,
      primaryChannel: row.contact.primaryChannel,
    },
  };
}

export async function listOpportunitiesForBoard(
  input: { orgId: string },
  deps: { opportunityStore: Pick<OpportunityStore, "findOrgBoard"> },
): Promise<PipelineBoardResponse> {
  const rows = await deps.opportunityStore.findOrgBoard(input.orgId);
  return { rows: rows.map(toBoardRow) };
}

export async function transitionOpportunityStage(
  input: {
    orgId: string;
    id: string;
    stage: OpportunityStage;
    actor: TransitionStageInput["actor"];
  },
  deps: { opportunityStore: Pick<OpportunityStore, "transitionStage"> },
): Promise<{ opportunity: PipelineBoardOpportunity }> {
  const result = await deps.opportunityStore.transitionStage({
    orgId: input.orgId,
    id: input.id,
    stage: input.stage,
    actor: input.actor,
  });
  return { opportunity: toBoardRow(result.opportunity) };
}
