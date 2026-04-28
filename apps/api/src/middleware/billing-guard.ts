import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import type { BillingEntitlementResolver } from "@switchboard/core/billing";

/**
 * HTTP methods that mutate state. Anything else (GET/HEAD/OPTIONS) is treated as
 * read-only and bypasses the entitlement check.
 */
export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Public allowlist — routes that must remain reachable for blocked / unpaid orgs
 * so they can still authenticate, finish onboarding, and reach billing/Stripe.
 *
 * Matched as exact equality OR prefix-with-trailing-slash, so `/api/billing` and
 * `/api/billing/checkout` both match the `"/api/billing"` entry, but
 * `/api/billing-evil` does not.
 */
const PUBLIC_PREFIXES: readonly string[] = [
  "/health",
  "/api/health",
  "/api/auth",
  "/api/sessions",
  "/api/setup",
  "/api/onboard",
  "/api/billing",
  "/api/webhooks",
];

export function isPublicRoute(url: string): boolean {
  // Strip query string before matching.
  const path = url.split("?")[0] ?? url;
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

declare module "fastify" {
  interface FastifyInstance {
    billingEntitlementResolver?: BillingEntitlementResolver;
  }
}

const billingGuardPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    // Only gate mutating verbs.
    if (!MUTATING_METHODS.has(request.method)) return;

    // Allow public routes (auth, setup, billing portal, webhooks, health).
    if (isPublicRoute(request.url)) return;

    const orgId = request.organizationIdFromAuth;
    // Unauthenticated requests are handled by the auth middleware; if we got here
    // without an org, let the route handler decide (it will 401 normally).
    if (!orgId) return;

    const resolver = app.billingEntitlementResolver;
    if (!resolver) return; // Resolver not wired (legacy / certain test setups) — fail open.

    const entitlement = await resolver.resolve(orgId);
    if (entitlement.entitled) return;

    return reply.code(402).send({
      error: "Active subscription required",
      statusCode: 402,
      blockedStatus: entitlement.blockedStatus,
    });
  });
};

export const billingGuard = fp(billingGuardPlugin, { name: "billing-guard" });
