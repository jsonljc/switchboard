import type { Opportunity, OpportunityStage, Contact } from "@switchboard/schemas";

/** Plain data returned by advanceOpportunityStage — caller wraps into event envelope at apps layer */
export interface StageAdvancementResult {
  opportunity: Opportunity;
  advancementData: {
    contactId: string;
    opportunityId: string;
    fromStage: OpportunityStage;
    toStage: OpportunityStage;
    serviceName: string;
    advancedBy: string;
  };
}

/** Contact with its opportunities — query result type */
export interface ContactDetail {
  contact: Contact;
  opportunities: Opportunity[];
}

/** Plain data returned by recordRevenue — caller wraps into event envelope at apps layer */
export interface RevenueRecordedData {
  contactId: string;
  opportunityId: string;
  amount: number;
  currency: string;
  type: string;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
}
