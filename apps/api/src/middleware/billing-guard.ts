import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

export type BillingTier = "free" | "starter" | "pro" | "scale";

/** Routes that require a paid subscription. Prefix-matched. */
const PAID_ROUTE_PREFIXES = ["/api/agents/deploy", "/api/creative-pipeline", "/api/ad-optimizer"];

/** Map Stripe price IDs to tier names. */
function resolveTier(priceId: string | null, status: string): BillingTier {
  if (status === "none" || status === "canceled") return "free";
  if (!priceId) return "free";
  const starterPriceId = process.env["STRIPE_PRICE_STARTER"];
  const proPriceId = process.env["STRIPE_PRICE_PRO"];
  const scalePriceId = process.env["STRIPE_PRICE_SCALE"];
  if (priceId === scalePriceId) return "scale";
  if (priceId === proPriceId) return "pro";
  if (priceId === starterPriceId) return "starter";
  return "starter"; // unknown price = treat as starter (paid)
}

function requiresPaidPlan(url: string): boolean {
  return PAID_ROUTE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

const billingGuardPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requiresPaidPlan(request.url)) return;

    const orgId = request.organizationIdFromAuth;
    if (!orgId || !app.prisma) return;

    const orgConfig = await app.prisma.organizationConfig.findUnique({
      where: { id: orgId },
      select: { subscriptionStatus: true, stripePriceId: true },
    });

    if (!orgConfig) return;

    const tier = resolveTier(orgConfig.stripePriceId, orgConfig.subscriptionStatus);
    const activeStatuses = ["active", "trialing"];
    const hasActiveSub = activeStatuses.includes(orgConfig.subscriptionStatus);

    if (tier === "free" || !hasActiveSub) {
      return reply.code(402).send({
        error: "This feature requires an active subscription",
        statusCode: 402,
        requiredTier: "starter",
        currentTier: tier,
      });
    }
  });
};

export const billingGuard = fp(billingGuardPlugin, { name: "billing-guard" });
export { resolveTier, requiresPaidPlan };
