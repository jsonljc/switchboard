import type { Opportunity, OpportunityStage } from "@switchboard/schemas";

export interface CreateOpportunityInput {
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  estimatedValue?: number | null;
  assignedAgent?: string | null;
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
    closedAt?: Date,
  ): Promise<Opportunity>;
  updateRevenueTotal(orgId: string, id: string): Promise<void>;
  countByStage(
    orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>>;
}
