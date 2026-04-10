import inngestFastify from "inngest/fastify";
import type { FastifyInstance } from "fastify";
import { inngestClient, createCreativeJobRunner } from "@switchboard/core/creative-pipeline";
import { PrismaCreativeJobStore } from "@switchboard/db";

/**
 * Register Inngest serve handler with Fastify.
 * Creates the /api/inngest endpoint that the Inngest dev server or cloud polls.
 */
export async function registerInngest(app: FastifyInstance): Promise<void> {
  if (!app.prisma) {
    app.log.warn("Inngest: skipping registration — no database connection");
    return;
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);

  await app.register(inngestFastify, {
    client: inngestClient,
    functions: [createCreativeJobRunner(jobStore)],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
