import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Opportunity, LifecycleRevenueEvent } from "@switchboard/schemas";
import { buildTestServer, type TestContext } from "./test-server.js";
import { TestOpportunityStore, TestRevenueStore } from "./test-stores.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

async function seedContact(orgId: string, overrides: Record<string, unknown> = {}) {
  return ctx.app.contactStore!.create({
    organizationId: orgId,
    name: "Lisa K.",
    phone: "+6591234567",
    email: "lisa@example.com",
    primaryChannel: "whatsapp",
    ...overrides,
  });
}

function makeOpportunity(overrides: Partial<Opportunity>): Opportunity {
  const now = new Date();
  return {
    id: "opp-1",
    organizationId: "org-test",
    contactId: "contact-1",
    serviceId: "svc-1",
    serviceName: "Service A",
    stage: "qualified",
    objections: [],
    qualificationComplete: false,
    estimatedValue: 1000,
    revenueTotal: 0,
    assignedAgent: null,
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Opportunity;
}

function makeRevenueEvent(overrides: Partial<LifecycleRevenueEvent>): LifecycleRevenueEvent {
  const now = new Date();
  return {
    id: "rev-1",
    organizationId: "org-test",
    contactId: "contact-1",
    opportunityId: "opp-1",
    amount: 250,
    currency: "USD",
    type: "payment",
    status: "confirmed",
    recordedBy: "owner",
    externalReference: null,
    verified: true,
    sourceCampaignId: null,
    sourceAdId: null,
    recordedAt: now,
    createdAt: now,
    ...overrides,
  } as LifecycleRevenueEvent;
}

describe("GET /api/dashboard/contacts/:id", () => {
  it("returns 403 without org scope", async () => {
    // Build a fresh app with authDisabled=false to mimic missing auth.
    const app = ctx.app;
    // Remove the dev-mode auto-fill by switching authDisabled off transiently.
    Object.defineProperty(app, "authDisabled", { value: false, configurable: true });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/contacts/anything",
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 + ContactDetailResponse on happy path", async () => {
    const c = await seedContact("org-test");
    (ctx.app.opportunityStore as TestOpportunityStore).seed(
      makeOpportunity({ id: "opp-A", contactId: c.id, organizationId: "org-test" }),
    );
    (ctx.app.revenueEventStore as TestRevenueStore).seed(
      makeRevenueEvent({ id: "rev-A", contactId: c.id, organizationId: "org-test" }),
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/dashboard/contacts/${c.id}`,
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.id).toBe(c.id);
    expect(body.profile.displayName).toBe("Lisa K.");
    expect(Array.isArray(body.opportunities)).toBe(true);
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0].id).toBe("opp-A");
    expect(Array.isArray(body.threads)).toBe(true);
    expect(Array.isArray(body.openDecisions)).toBe(true);
    expect(Array.isArray(body.revenueEvents)).toBe(true);
    expect(body.revenueEvents).toHaveLength(1);
    expect(body.revenueEvents[0].id).toBe("rev-A");
  });

  it("returns 404 for unknown contactId", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts/does-not-exist",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("CONTACT_NOT_FOUND");
  });

  it("returns 404 for cross-org access (no info leak)", async () => {
    const c = await seedContact("org-A", { name: "Alice", phone: "+6510000000" });
    // Fetch as a different org — should be indistinguishable from "missing".
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/dashboard/contacts/${c.id}`,
      headers: { "x-org-id": "org-B" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("CONTACT_NOT_FOUND");
  });
});
