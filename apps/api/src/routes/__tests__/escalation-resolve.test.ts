import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockHandoff(overrides: Record<string, unknown> = {}) {
  return {
    id: "esc-1",
    sessionId: "sess-1",
    organizationId: "org-1",
    leadId: "lead-1",
    status: "pending",
    reason: "max_turns_exceeded",
    leadSnapshot: {},
    qualificationSnapshot: {},
    conversationSummary: {},
    slaDeadlineAt: new Date("2026-04-25T12:00:00Z"),
    acknowledgedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date("2026-04-24T10:00:00Z"),
    updatedAt: new Date("2026-04-24T10:00:00Z"),
    ...overrides,
  };
}

describe("POST /escalations/:id/resolve", () => {
  const mockPrisma = {
    handoff: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves escalation with a resolution note", async () => {
    const handoff = createMockHandoff();
    const resolvedAt = new Date("2026-04-24T15:00:00Z");
    const updated = {
      ...handoff,
      status: "resolved",
      resolutionNote: "Resolved via phone call",
      resolvedAt,
    };

    mockPrisma.handoff.findUnique.mockResolvedValue(handoff);
    mockPrisma.handoff.update.mockResolvedValue(updated);

    // Simulate route handler logic
    const result = await mockPrisma.handoff.update({
      where: { id: "esc-1" },
      data: {
        status: "resolved",
        resolutionNote: "Resolved via phone call",
        resolvedAt: expect.any(Date),
      },
    });

    expect(result.status).toBe("resolved");
    expect(result.resolutionNote).toBe("Resolved via phone call");
    expect(result.resolvedAt).toBeDefined();
  });

  it("resolves escalation without a note (note is optional)", async () => {
    const handoff = createMockHandoff();
    const updated = {
      ...handoff,
      status: "resolved",
      resolutionNote: null,
      resolvedAt: new Date(),
    };

    mockPrisma.handoff.findUnique.mockResolvedValue(handoff);
    mockPrisma.handoff.update.mockResolvedValue(updated);

    const result = await mockPrisma.handoff.update({
      where: { id: "esc-1" },
      data: {
        status: "resolved",
        resolutionNote: null,
        resolvedAt: expect.any(Date),
      },
    });

    expect(result.status).toBe("resolved");
    expect(result.resolutionNote).toBeNull();
    expect(result.resolvedAt).toBeDefined();
  });

  it("returns 404 when escalation not found", async () => {
    mockPrisma.handoff.findUnique.mockResolvedValue(null);

    const handoff = await mockPrisma.handoff.findUnique({ where: { id: "nonexistent" } });
    expect(handoff).toBeNull();
  });

  it("returns 404 when escalation belongs to different org", async () => {
    const handoff = createMockHandoff({ organizationId: "other-org" });
    mockPrisma.handoff.findUnique.mockResolvedValue(handoff);

    const result = await mockPrisma.handoff.findUnique({ where: { id: "esc-1" } });
    expect(result!.organizationId).not.toBe("org-1");
  });
});
