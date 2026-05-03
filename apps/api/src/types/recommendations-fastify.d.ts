import type { RecommendationStore } from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    recommendationStore?: RecommendationStore;
  }
}
