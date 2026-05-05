import type { agentHome } from "@switchboard/core";

declare module "fastify" {
  interface FastifyInstance {
    greetingSignalStore?: agentHome.GreetingSignalStore;
  }
}
