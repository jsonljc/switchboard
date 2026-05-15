import type { Opportunity, OpportunityStage, ObjectionRecord } from "@switchboard/schemas";

export interface CreateOpportunityInput {
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  estimatedValue?: number | null;
  assignedAgent?: string | null;
}

/**
 * Raw board row returned by OpportunityStore.findOrgBoard — mirrors Opportunity
 * but with the joined minimal contact projection and dates left as Date
 * objects. Core's listOpportunitiesForBoard converts to ISO strings before
 * shipping over the wire.
 */
export interface OpportunityBoardRow {
  id: string;
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  stage: OpportunityStage;
  timeline: "immediate" | "soon" | "exploring" | "unknown" | null;
  priceReadiness: "ready" | "flexible" | "price_sensitive" | "unknown" | null;
  objections: ObjectionRecord[];
  qualificationComplete: boolean;
  estimatedValue: number | null;
  revenueTotal: number;
  assignedAgent: string | null;
  assignedStaff: string | null;
  lostReason: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
  contact: {
    id: string;
    name: string;
    primaryChannel: "whatsapp" | "telegram" | "dashboard";
  };
}

export interface TransitionStageInput {
  orgId: string;
  id: string;
  stage: OpportunityStage;
  /** Operator actor — type matches WorkTrace.actor shape ("user" | "system" | "service"). */
  actor: { id: string; type: "user" | "system" | "service" };
}

export interface TransitionStageResult {
  opportunity: OpportunityBoardRow;
}

/** Thrown by transitionStage when the id is missing or belongs to a different org. */
export class OpportunityNotFoundError extends Error {
  readonly code = "OPPORTUNITY_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "OpportunityNotFoundError";
  }
}

export interface OpportunityStore {
  create(input: CreateOpportunityInput): Promise<Opportunity>;
  findById(orgId: string, id: string): Promise<Opportunity | null>;
  findByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  findActiveByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  updateStage(
    orgId: string,
    id: string,
    stage: OpportunityStage,
    closedAt?: Date | null,
  ): Promise<Opportunity>;
  updateRevenueTotal(orgId: string, id: string): Promise<void>;
  countByStage(
    orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>>;

  /**
   * Org-wide flat-list projection for the Mercury /contacts pipeline board.
   * Returns every opportunity for the org, sorted by updatedAt DESC, with the
   * joined minimal Contact projection. No paging in v1 — pilot data is 50–200
   * cards per org (see backend spec §2 OPEN-A1).
   */
  findOrgBoard(orgId: string): Promise<OpportunityBoardRow[]>;

  /**
   * Atomically transition an opportunity's stage AND write an operator-mutation
   * WorkTrace. Implementations must use a transaction so that a trace-write
   * failure rolls back the row update. Throws OpportunityNotFoundError when
   * the id is missing or belongs to a different org.
   */
  transitionStage(input: TransitionStageInput): Promise<TransitionStageResult>;
}
