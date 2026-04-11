import type { FastifyPluginAsync } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import {
  PrismaDeploymentStore,
  PrismaDeploymentConnectionStore,
  PrismaListingStore,
  encryptCredentials,
} from "@switchboard/db";
import { SetupSchema } from "@switchboard/schemas";
import { z } from "zod";

const OnboardInput = z.object({
  listingId: z.string().min(1),
  setupAnswers: z.record(z.unknown()).default({}),
  scannedProfile: z.record(z.unknown()).optional(),
  businessName: z.string().min(1),
});

export function slugify(name: string, suffix?: number): string {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (suffix && suffix > 1) slug += `-${suffix}`;
  return slug;
}

const DEFAULT_ONBOARDING = {
  websiteScan: true,
  publicChannels: true,
  privateChannel: false,
  integrations: [] as string[],
};

export const onboardRoutes: FastifyPluginAsync = async (app) => {
  const listingStore = new PrismaListingStore(app.prisma);
  const deploymentStore = new PrismaDeploymentStore(app.prisma);
  const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);

  app.post("/onboard", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const body = OnboardInput.parse(request.body);
    const listing = await listingStore.findById(body.listingId);
    if (!listing) return reply.code(404).send({ error: "Listing not found" });

    // Resolve onboarding config
    const metadata = (listing.metadata as Record<string, unknown>) ?? {};
    let onboarding = DEFAULT_ONBOARDING;
    if (metadata.setupSchema) {
      const parsed = SetupSchema.safeParse(metadata.setupSchema);
      if (parsed.success) {
        onboarding = { ...DEFAULT_ONBOARDING, ...parsed.data.onboarding };
      }
    }

    // Generate unique slug
    let slug = slugify(body.businessName);
    let suffix = 1;
    let resolved = false;
    while (!resolved) {
      const candidate = suffix === 1 ? slug : `${slug}-${suffix}`;
      const existing = await app.prisma.agentDeployment.findUnique({
        where: { slug: candidate },
      });
      if (!existing) {
        slug = candidate;
        resolved = true;
      } else {
        suffix++;
        if (suffix > 100) {
          slug = `${slug}-${randomBytes(4).toString("hex")}`;
          resolved = true;
        }
      }
    }

    // Create deployment
    const inputConfig = {
      ...body.setupAnswers,
      scannedProfile: body.scannedProfile ?? null,
      businessName: body.businessName,
    };

    const deployment = await deploymentStore.create({
      organizationId: orgId,
      listingId: body.listingId,
      inputConfig,
      governanceSettings: { startingAutonomy: "supervised" },
      slug,
    });

    const result: Record<string, unknown> = {
      deploymentId: deployment.id,
      slug,
      dashboardUrl: `/deployments/${deployment.id}`,
    };

    // Auto-create widget connection if publicChannels
    if (onboarding.publicChannels) {
      const token = "sw_" + randomBytes(15).toString("base64url").slice(0, 20);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const encrypted = encryptCredentials({ token });

      await connectionStore.create({
        deploymentId: deployment.id,
        type: "web_widget",
        credentials: encrypted,
        tokenHash,
      });

      result.storefrontUrl = `/agent/${slug}`;
      result.widgetToken = token;
      result.embedCode = `<script src="${process.env.CHAT_SERVER_URL || "http://localhost:3001"}/widget.js" data-token="${token}"></script>`;
    }

    return reply.code(201).send(result);
  });
};
