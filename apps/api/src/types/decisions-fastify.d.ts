import type { ContactStore, HandoffStore, ConversationThreadStore } from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    contactStore?: ContactStore;
    handoffStore?: HandoffStore;
    threadStore?: ConversationThreadStore;
  }
}
