// ---------------------------------------------------------------------------
// Billing routes — Stripe checkout, portal, webhook, status
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";
import {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
} from "../services/stripe-service.js";

function resolvePlanName(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const mapping: Record<string, string> = {};
  if (process.env["STRIPE_PRICE_STARTER"]) mapping[process.env["STRIPE_PRICE_STARTER"]] = "Starter";
  if (process.env["STRIPE_PRICE_PRO"]) mapping[process.env["STRIPE_PRICE_PRO"]] = "Pro";
  if (process.env["STRIPE_PRICE_SCALE"]) mapping[process.env["STRIPE_PRICE_SCALE"]] = "Scale";
  return mapping[priceId] ?? "Current Plan";
}

export const billingRoutes: FastifyPluginAsync = async (app) => {
  // --- POST /checkout — create Stripe checkout session ---
  app.post(
    "/checkout",
    {
      schema: {
        description: "Create a Stripe checkout session for subscription billing.",
        tags: ["Billing"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const body = request.body as {
        email?: string;
        priceId?: string;
        successUrl?: string;
        cancelUrl?: string;
      };

      if (!body.email || !body.priceId || !body.successUrl || !body.cancelUrl) {
        return reply.code(400).send({
          error: "Missing required fields: email, priceId, successUrl, cancelUrl",
          statusCode: 400,
        });
      }

      const url = await createCheckoutSession({
        organizationId: orgId,
        email: body.email,
        priceId: body.priceId,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      });

      return reply.code(200).send({ url });
    },
  );

  // --- POST /portal — create Stripe billing portal session ---
  app.post(
    "/portal",
    {
      schema: {
        description: "Create a Stripe billing portal session.",
        tags: ["Billing"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const body = request.body as { returnUrl?: string };
      if (!body.returnUrl) {
        return reply.code(400).send({
          error: "Missing required field: returnUrl",
          statusCode: 400,
        });
      }

      const orgConfig = await app.prisma.organizationConfig.findUnique({
        where: { id: orgId },
        select: { stripeCustomerId: true },
      });

      if (!orgConfig?.stripeCustomerId) {
        return reply.code(400).send({
          error: "No Stripe customer found for this organization",
          statusCode: 400,
        });
      }

      const url = await createPortalSession(orgConfig.stripeCustomerId, body.returnUrl);
      return reply.code(200).send({ url });
    },
  );

  // --- GET /status — billing status for current org ---
  app.get(
    "/status",
    {
      schema: {
        description: "Get current billing status for the organization.",
        tags: ["Billing"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgConfig = await app.prisma.organizationConfig.findUnique({
        where: { id: orgId },
        select: {
          subscriptionStatus: true,
          stripeSubscriptionId: true,
          stripePriceId: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      });

      if (!orgConfig) {
        return reply.code(404).send({
          error: "Organization not found",
          statusCode: 404,
        });
      }

      return reply.code(200).send({
        subscriptionId: orgConfig.stripeSubscriptionId ?? null,
        status: orgConfig.subscriptionStatus,
        planName: resolvePlanName(orgConfig.stripePriceId),
        priceId: orgConfig.stripePriceId ?? null,
        currentPeriodEnd: orgConfig.currentPeriodEnd?.toISOString() ?? null,
        trialEnd: orgConfig.trialEndsAt?.toISOString() ?? null,
        cancelAtPeriodEnd: orgConfig.cancelAtPeriodEnd ?? false,
      });
    },
  );

  // --- POST /webhook — Stripe webhook handler (raw body, no auth) ---
  app.post(
    "/webhook",
    {
      config: { rawBody: true },
      schema: {
        description: "Stripe webhook handler for subscription events.",
        tags: ["Billing"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const signature = request.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return reply.code(400).send({
          error: "Missing stripe-signature header",
          statusCode: 400,
        });
      }

      const rawBody = (request as unknown as { rawBody?: string }).rawBody;
      if (!rawBody) {
        return reply.code(500).send({
          error: "Raw body not available — configure Fastify rawBody parser for webhook routes",
          statusCode: 500,
        });
      }

      let result: Awaited<ReturnType<typeof handleWebhookEvent>>;
      try {
        result = await handleWebhookEvent(rawBody, signature);
      } catch {
        return reply.code(400).send({
          error: "Invalid webhook signature",
          statusCode: 400,
        });
      }

      // Idempotency: check if event was already processed
      const eventId = result.data.eventId as string | undefined;
      if (eventId) {
        const existing = await app.prisma.webhookEventLog.findUnique({
          where: { eventId },
        });
        if (existing) {
          app.log.info({ eventId }, "Duplicate webhook event, skipping");
          return reply.code(200).send({ received: true });
        }
      }

      if (!result.organizationId) {
        return reply.code(200).send({ received: true });
      }

      const orgId = result.organizationId;

      switch (result.type) {
        case "checkout.session.completed": {
          await app.prisma.organizationConfig.update({
            where: { id: orgId },
            data: {
              stripeCustomerId: result.data.customerId as string,
              stripeSubscriptionId: result.data.subscriptionId as string,
              subscriptionStatus: "trialing",
            },
          });
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const updateData: Record<string, unknown> = {
            subscriptionStatus: result.data.status as string,
            stripePriceId: (result.data.priceId as string) ?? null,
            cancelAtPeriodEnd: result.data.cancelAtPeriodEnd ?? false,
            currentPeriodEnd: result.data.currentPeriodEnd
              ? new Date(result.data.currentPeriodEnd as string)
              : null,
          };
          if (result.data.trialEnd) {
            updateData.trialEndsAt = new Date(result.data.trialEnd as string);
          }
          await app.prisma.organizationConfig.update({
            where: { id: orgId },
            data: updateData,
          });

          // Side effect: deactivate resources on cancellation
          if (result.data.status === "canceled") {
            await app.prisma.agentDeployment.updateMany({
              where: { organizationId: orgId, status: "active" },
              data: { status: "suspended" },
            });
            await app.prisma.managedChannel.updateMany({
              where: { organizationId: orgId, status: "active" },
              data: { status: "suspended" },
            });
            app.log.info({ orgId }, "Subscription canceled — suspended agents and channels");
          }
          break;
        }
        case "invoice.payment_failed": {
          await app.prisma.organizationConfig.update({
            where: { id: orgId },
            data: { subscriptionStatus: "past_due" },
          });
          break;
        }
        case "customer.subscription.trial_will_end": {
          if (result.data.trialEnd) {
            await app.prisma.organizationConfig.update({
              where: { id: orgId },
              data: { trialEndsAt: new Date(result.data.trialEnd as string) },
            });
          }
          break;
        }
      }

      // Record the event for idempotency
      if (eventId) {
        await app.prisma.webhookEventLog
          .create({
            data: { eventId, eventType: result.type, processedAt: new Date() },
          })
          .catch((err: unknown) => {
            app.log.warn(
              { err, eventId },
              "Failed to record webhook event — duplicate may reprocess",
            );
          });
      }

      return reply.code(200).send({ received: true });
    },
  );
};
