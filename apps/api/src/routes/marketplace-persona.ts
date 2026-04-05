// ---------------------------------------------------------------------------
// Marketplace persona routes — agent persona CRUD & Sales Pipeline deployment
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaAgentPersonaStore } from "@switchboard/db";

export const marketplacePersonaRoutes: FastifyPluginAsync = async (app) => {
  // GET /persona — get org's persona
  app.get("/persona", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    if (!request.organizationIdFromAuth) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const store = new PrismaAgentPersonaStore(app.prisma);
    const persona = await store.getByOrgId(request.organizationIdFromAuth);
    return reply.send({ persona });
  });

  // POST /persona — upsert persona
  app.post("/persona", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    if (!request.organizationIdFromAuth) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const store = new PrismaAgentPersonaStore(app.prisma);
    const body = request.body as Record<string, unknown>;
    const persona = await store.upsert(request.organizationIdFromAuth, body as never);
    return reply.send({ persona });
  });

  // POST /persona/deploy — deploy Sales Pipeline bundle
  app.post("/persona/deploy", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    if (!request.organizationIdFromAuth) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const orgId = request.organizationIdFromAuth;
    const body = request.body as Record<string, unknown>;
    const prisma = app.prisma;

    // 1. Upsert persona
    const store = new PrismaAgentPersonaStore(prisma);
    const persona = await store.upsert(orgId, body as never);

    // 2. Find the 3 Sales Pipeline listings
    const listings = await prisma.agentListing.findMany({
      where: {
        slug: { in: ["speed-to-lead", "sales-closer", "nurture-specialist"] },
        status: "listed",
      },
    });

    if (listings.length === 0) {
      return reply.code(404).send({ error: "Sales Pipeline agents not found. Run db:seed first." });
    }

    // 3. Create deployments (upsert to avoid duplicates)
    const deployments = await Promise.all(
      listings.map((listing) =>
        prisma.agentDeployment.upsert({
          where: {
            organizationId_listingId: {
              organizationId: orgId,
              listingId: listing.id,
            },
          },
          create: {
            organizationId: orgId,
            listingId: listing.id,
            status: "active",
            inputConfig: { personaId: persona.id },
            governanceSettings: {},
          },
          update: {
            status: "active",
            inputConfig: { personaId: persona.id },
          },
        }),
      ),
    );

    return reply.send({ persona, deployments, count: deployments.length });
  });
};
