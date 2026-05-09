import { describe, expect, it, vi } from "vitest";
import { getContactDetail, ContactNotFoundError } from "../detail.js";

const mkContact = (id = "c-1") => ({
  id,
  organizationId: "org-1",
  name: "Maya Rahman",
  phone: "+6591234567",
  email: "maya@example.com",
  primaryChannel: "whatsapp" as const,
  firstTouchChannel: null,
  stage: "active" as const,
  source: "ctwa",
  sourceType: "ctwa" as const,
  attribution: { adSet: "summer pricing v3" },
  qualificationData: null,
  roles: ["lead"],
  leadgenId: null,
  idempotencyKey: null,
  messagingOptIn: true,
  messagingOptInAt: new Date("2026-04-29T00:00:00Z"),
  messagingOptInSource: "organic_inbound" as const,
  messagingOptOutAt: null,
  firstContactAt: new Date("2026-04-27T00:00:00Z"),
  lastActivityAt: new Date("2026-05-09T00:00:00Z"),
  createdAt: new Date("2026-04-27T00:00:00Z"),
  updatedAt: new Date("2026-05-09T00:00:00Z"),
});

const mkDeps = (overrides: Record<string, unknown> = {}) =>
  ({
    contactStore: { findById: vi.fn().mockResolvedValue(mkContact()) },
    opportunityStore: { findByContact: vi.fn().mockResolvedValue([]) },
    threadStore: { getByContact: vi.fn().mockResolvedValue(null) },
    recommendationStore: { listBySurface: vi.fn().mockResolvedValue([]) },
    handoffStore: { listPending: vi.fn().mockResolvedValue([]) },
    revenueEventStore: { findByContact: vi.fn().mockResolvedValue([]) },
    ...overrides,
  }) as unknown as Parameters<typeof getContactDetail>[1];

describe("getContactDetail", () => {
  it("throws ContactNotFoundError when contact is missing", async () => {
    const deps = mkDeps({ contactStore: { findById: vi.fn().mockResolvedValue(null) } });
    await expect(
      getContactDetail({ orgId: "org-1", contactId: "c-x" }, deps),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
  });

  it("returns a fully composed payload on happy path", async () => {
    const deps = mkDeps();
    const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
    expect(out.profile.id).toBe("c-1");
    expect(out.profile.displayName).toBe("Maya Rahman");
    expect(out.profile.attributionSummary).toContain("summer pricing v3");
    expect(out.opportunities).toEqual([]);
    expect(out.threads).toEqual([]);
    expect(out.openDecisions).toEqual([]);
    expect(out.revenueEvents).toEqual([]);
  });

  it("renders threads as a 0-or-1 array (1:1 schema invariant)", async () => {
    const thread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "engaged",
      assignedAgent: "alex",
      currentSummary: "Following up on quote.",
      lastOutcomeAt: new Date("2026-05-09T00:00:00Z"),
      messageCount: 5,
    };
    const deps = mkDeps({ threadStore: { getByContact: vi.fn().mockResolvedValue(thread) } });
    const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
    expect(out.threads).toHaveLength(1);
    expect(out.threads[0]?.assignedAgent).toBe("alex");
    expect(out.threads[0]?.summary).toBe("Following up on quote.");
  });

  it("computes displayName: name → phone → email → '—'", async () => {
    const cases = [
      { ...mkContact(), name: null, phone: "+65999", email: null, expected: "+65999" },
      { ...mkContact(), name: null, phone: null, email: "x@y.z", expected: "x@y.z" },
      { ...mkContact(), name: null, phone: null, email: null, expected: "—" },
    ];
    for (const c of cases) {
      const deps = mkDeps({ contactStore: { findById: vi.fn().mockResolvedValue(c) } });
      const out = await getContactDetail({ orgId: "org-1", contactId: c.id }, deps);
      expect(out.profile.displayName).toBe(c.expected);
    }
  });

  describe("open decisions — schema-guarded fail-closed", () => {
    const matchingRec = (overrides = {}) => ({
      id: "rec-1",
      organizationId: "org-1",
      surface: "queue",
      status: "pending",
      sourceAgent: "alex",
      title: "Approve quote draft",
      createdAt: new Date("2026-05-09T00:00:00Z"),
      targetEntities: { contactId: "c-1" },
      ...overrides,
    });
    const matchingHandoff = (overrides = {}) => ({
      id: "h-1",
      organizationId: "org-1",
      createdAt: new Date("2026-05-09T00:00:00Z"),
      leadSnapshot: { leadId: "c-1" },
      ...overrides,
    });

    it("includes records that match exactly", async () => {
      const deps = mkDeps({
        recommendationStore: { listBySurface: vi.fn().mockResolvedValue([matchingRec()]) },
        handoffStore: { listPending: vi.fn().mockResolvedValue([matchingHandoff()]) },
      });
      const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
      expect(out.openDecisions).toHaveLength(2);
      const kinds = out.openDecisions.map((d) => d.kind);
      expect(kinds).toContain("approval");
      expect(kinds).toContain("handoff");
    });

    it("excludes recs with missing targetEntities", async () => {
      const deps = mkDeps({
        recommendationStore: {
          listBySurface: vi.fn().mockResolvedValue([matchingRec({ targetEntities: undefined })]),
        },
      });
      const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
      expect(out.openDecisions).toEqual([]);
    });

    it("excludes recs with null targetEntities", async () => {
      const deps = mkDeps({
        recommendationStore: {
          listBySurface: vi.fn().mockResolvedValue([matchingRec({ targetEntities: null })]),
        },
      });
      const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
      expect(out.openDecisions).toEqual([]);
    });

    it("excludes recs whose targetEntities.contactId is wrong type", async () => {
      const cases = [
        { contactId: 123 },
        { contactId: null },
        { contactId: { nested: "c-1" } },
        { contactId: "" },
      ];
      for (const targetEntities of cases) {
        const deps = mkDeps({
          recommendationStore: {
            listBySurface: vi.fn().mockResolvedValue([matchingRec({ targetEntities })]),
          },
        });
        const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
        expect(out.openDecisions).toEqual([]);
      }
    });

    it("excludes recs whose contactId does not match exactly", async () => {
      const deps = mkDeps({
        recommendationStore: {
          listBySurface: vi
            .fn()
            .mockResolvedValue([matchingRec({ targetEntities: { contactId: "c-OTHER" } })]),
        },
      });
      const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
      expect(out.openDecisions).toEqual([]);
    });

    it("excludes handoffs with missing leadSnapshot", async () => {
      const deps = mkDeps({
        handoffStore: {
          listPending: vi.fn().mockResolvedValue([matchingHandoff({ leadSnapshot: undefined })]),
        },
      });
      const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
      expect(out.openDecisions).toEqual([]);
    });

    it("excludes handoffs whose leadSnapshot.leadId is wrong type", async () => {
      const cases = [{ leadId: 123 }, { leadId: null }, { leadId: "" }];
      for (const leadSnapshot of cases) {
        const deps = mkDeps({
          handoffStore: {
            listPending: vi.fn().mockResolvedValue([matchingHandoff({ leadSnapshot })]),
          },
        });
        const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
        expect(out.openDecisions).toEqual([]);
      }
    });
  });

  it("threads opportunities through unchanged", async () => {
    const opp = {
      id: "o-1",
      organizationId: "org-1",
      contactId: "c-1",
      serviceId: "svc-wedding",
      serviceName: "Wedding day",
      stage: "interested",
      timeline: null,
      priceReadiness: null,
      objections: [],
      qualificationComplete: false,
      estimatedValue: 4800,
      revenueTotal: 0,
      assignedAgent: null,
      assignedStaff: null,
      lostReason: null,
      notes: null,
      openedAt: new Date("2026-05-06T00:00:00Z"),
      closedAt: null,
      createdAt: new Date("2026-05-06T00:00:00Z"),
      updatedAt: new Date("2026-05-06T00:00:00Z"),
    };
    const deps = mkDeps({ opportunityStore: { findByContact: vi.fn().mockResolvedValue([opp]) } });
    const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
    expect(out.opportunities).toHaveLength(1);
    expect(out.opportunities[0]).toMatchObject({
      id: "o-1",
      serviceName: "Wedding day",
      stage: "interested",
      estimatedValue: 4800,
      closedAt: null,
    });
    expect(out.opportunities[0]?.openedAt).toBe("2026-05-06T00:00:00.000Z");
  });

  it("threads revenue events through unchanged", async () => {
    const event = {
      id: "r-1",
      organizationId: "org-1",
      contactId: "c-1",
      opportunityId: "o-1",
      amount: 1200,
      currency: "SGD",
      type: "payment",
      status: "confirmed",
      recordedBy: "owner",
      externalReference: null,
      verified: true,
      sourceCampaignId: null,
      sourceAdId: null,
      recordedAt: new Date("2026-05-09T00:00:00Z"),
      createdAt: new Date("2026-05-09T00:00:00Z"),
    };
    const deps = mkDeps({
      revenueEventStore: { findByContact: vi.fn().mockResolvedValue([event]) },
    });
    const out = await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
    expect(out.revenueEvents).toHaveLength(1);
    expect(out.revenueEvents[0]).toMatchObject({
      id: "r-1",
      amount: 1200,
      currency: "SGD",
      type: "payment",
      status: "confirmed",
    });
  });

  it("scopes the recommendation fetch with surface=queue + status=pending", async () => {
    const listBySurface = vi.fn().mockResolvedValue([]);
    const deps = mkDeps({ recommendationStore: { listBySurface } });
    await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
    expect(listBySurface).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", surface: "queue", status: "pending" }),
    );
  });

  it("scopes the handoff fetch by orgId", async () => {
    const listPending = vi.fn().mockResolvedValue([]);
    const deps = mkDeps({ handoffStore: { listPending } });
    await getContactDetail({ orgId: "org-1", contactId: "c-1" }, deps);
    expect(listPending).toHaveBeenCalledWith("org-1");
  });
});
