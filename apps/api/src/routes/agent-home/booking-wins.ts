// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { projectBookingWins } from "@switchboard/core";
import { PrismaBookingOutcomeLedgerStore } from "@switchboard/db";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });
// VISIBLE_LIMIT (5) + 1 so the projection can compute hasMore.
const FETCH_LIMIT = 6;

/**
 * GET /api/dashboard/agents/:agentId/booking-wins — Alex's converted bookings
 * surfaced from the F5 booking-outcome ledger (trace + revenue). Booking is
 * Alex-exclusive, so the route is Alex-scoped (404 otherwise). Read-only.
 */
export const bookingWinsRoute: FastifyPluginAsync = async (app) => {
  // Dev/test mode: allow `x-org-id` header to set the org scope (mirrors the
  // wins/pipeline routes). In production the auth middleware sets
  // organizationIdFromAuth before handlers run.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/agents/:agentId/booking-wins", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });
    const { agentId } = params.data;

    // Booking outcomes are produced only by Alex's calendar-book tool.
    if (agentId !== "alex") {
      return reply.code(404).send({ error: "Booking wins are an Alex-only surface" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore) {
      return reply.code(503).send({ error: "Enablement store unavailable" });
    }
    if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    // Capture before any await: TypeScript resets property narrowing across awaits.
    const prisma = app.prisma;
    if (!prisma) {
      return reply.code(503).send({ error: "Database unavailable" });
    }

    const timezone = await getOrgTimezone(prisma, orgId);
    const store = new PrismaBookingOutcomeLedgerStore(prisma);

    try {
      // Ledger rows are a structural superset of BookingWinSignalRow; pass through.
      const rows = await store.listForOrg({ orgId, limit: FETCH_LIMIT });
      const vm = projectBookingWins(rows, { now: new Date(), timezone });
      return reply.code(200).send({ vm });
    } catch (err) {
      app.log.error({ err }, "booking-wins projection failed");
      return reply.code(500).send({ error: "Booking wins projection failed" });
    }
  });
};
