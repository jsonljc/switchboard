import type {
  ContactStore,
  HandoffStore,
  ConversationThreadStore,
  OpportunityStore,
  RevenueStore,
} from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    contactStore?: ContactStore;
    handoffStore?: HandoffStore;
    threadStore?: ConversationThreadStore;
    opportunityStore?: OpportunityStore;
    revenueEventStore?: RevenueStore;
  }
}
