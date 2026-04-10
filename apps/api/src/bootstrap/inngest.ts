// apps/api/src/bootstrap/inngest.ts
import type { FastifyInstance } from "fastify";
import inngestFastify from "inngest/fastify";
import { PrismaCreativeJobStore } from "@switchboard/db";
import { inngestClient, createCreativeJobRunner } from "@switchboard/core/creative-pipeline";

export async function registerInngest(app: FastifyInstance): Promise<void> {
  if (!app.prisma) {
    app.log.warn("Inngest: skipping registration — no database connection");
    return;
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    app.log.warn(
      "Inngest: ANTHROPIC_API_KEY not set — creative pipeline stages will fail at runtime",
    );
  }

  const openaiApiKey = process.env["OPENAI_API_KEY"] ?? "";
  if (!openaiApiKey) {
    app.log.warn("Inngest: OPENAI_API_KEY not set — storyboard image generation will be skipped");
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);

  await app.register(inngestFastify, {
    client: inngestClient,
    functions: [
      createCreativeJobRunner(jobStore, { apiKey }, openaiApiKey ? { openaiApiKey } : undefined),
    ],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
