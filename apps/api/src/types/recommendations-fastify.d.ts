import type { OrgAgentEnablementStore, RecommendationStore } from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    recommendationStore?: RecommendationStore;
    orgAgentEnablementStore?: OrgAgentEnablementStore;
  }
}
