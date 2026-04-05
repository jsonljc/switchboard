// ---------------------------------------------------------------------------
// Marketplace persona routes — agent persona CRUD & Sales Pipeline deployment
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaAgentPersonaStore } from "@switchboard/db";
import { z } from "zod";
import { PersonaTone } from "@switchboard/schemas";

const PersonaInput = z.object({
  businessName: z.string().min(1),
  businessType: z.string().min(1),
  productService: z.string().min(1),
  valueProposition: z.string().min(1),
  tone: PersonaTone.default("professional"),
  qualificationCriteria: z.record(z.unknown()).default({}),
  disqualificationCriteria: z.record(z.unknown()).default({}),
  escalationRules: z.record(z.unknown()).default({}),
  bookingLink: z.string().url().nullable().optional(),
  customInstructions: z.string().nullable().optional(),
});

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

    const parsed = PersonaInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const store = new PrismaAgentPersonaStore(app.prisma);
    const persona = await store.upsert(request.organizationIdFromAuth, parsed.data as never);
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

    const parsed = PersonaInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const orgId = request.organizationIdFromAuth;
    const prisma = app.prisma;

    // 1. Upsert persona
    const store = new PrismaAgentPersonaStore(prisma);
    const persona = await store.upsert(orgId, parsed.data as never);

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
