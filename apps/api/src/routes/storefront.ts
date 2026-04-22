import type { FastifyPluginAsync } from "fastify";
import { decryptCredentials } from "@switchboard/db";

export const storefrontRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { slug: string } }>("/:slug", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { slug } = request.params;

    const deployment = await app.prisma.agentDeployment.findUnique({
      where: { slug },
      include: { listing: true },
    });

    if (!deployment || deployment.status === "inactive") {
      return reply.code(404).send({ error: "Agent not found", statusCode: 404 });
    }

    const inputConfig = deployment.inputConfig as Record<string, unknown>;
    const scannedProfile = (inputConfig.scannedProfile as Record<string, unknown>) ?? null;

    const widgetConnection = await app.prisma.deploymentConnection.findFirst({
      where: { deploymentId: deployment.id, type: "web_widget", status: "active" },
    });

    let widgetToken: string | null = null;
    if (widgetConnection) {
      try {
        const creds = decryptCredentials(widgetConnection.credentials) as Record<string, unknown>;
        widgetToken = (creds.token as string) ?? null;
      } catch {
        // If decryption fails, skip widget
      }
    }

    return reply.send({
      slug: deployment.slug,
      businessName: (inputConfig.businessName as string) ?? deployment.listing.name,
      agentName: deployment.listing.name,
      scannedProfile,
      widgetToken,
      listingSlug: deployment.listing.slug,
    });
  });
};
