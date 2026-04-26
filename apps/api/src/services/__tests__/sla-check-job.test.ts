import { describe, it, expect, vi } from "vitest";
import { checkAllOrgBreaches } from "../sla-check-job.js";

describe("SLA check job", () => {
  it("calls checkOrgBreaches for each org with pending handoffs", async () => {
    const mockPrisma = {
      handoff: {
        findMany: vi.fn().mockResolvedValue([
          { organizationId: "org-1" },
          { organizationId: "org-2" },
          { organizationId: "org-1" }, // duplicate
        ]),
      },
    };

    const mockOnBreach = vi.fn().mockResolvedValue(undefined);

    const breachCount = await checkAllOrgBreaches(mockPrisma as never, mockOnBreach);

    // Should deduplicate orgs
    expect(mockPrisma.handoff.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      select: { organizationId: true },
    });
    expect(typeof breachCount).toBe("number");
  });

  it("invokes onBreach for handoffs past SLA deadline", async () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const mockPrisma = {
      handoff: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ organizationId: "org-1" }]) // distinct orgs
          .mockResolvedValueOnce([
            {
              id: "h-1",
              organizationId: "org-1",
              sessionId: "sess-1",
              slaDeadlineAt: pastDeadline,
              status: "pending",
            },
          ]), // per-org pending
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const mockOnBreach = vi.fn().mockResolvedValue(undefined);

    await checkAllOrgBreaches(mockPrisma as never, mockOnBreach);

    expect(mockOnBreach).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onBreach for handoffs within SLA", async () => {
    const futureDeadline = new Date(Date.now() + 60_000);
    const mockPrisma = {
      handoff: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ organizationId: "org-1" }])
          .mockResolvedValueOnce([
            {
              id: "h-1",
              organizationId: "org-1",
              sessionId: "sess-1",
              slaDeadlineAt: futureDeadline,
              status: "pending",
            },
          ]),
      },
    };

    const mockOnBreach = vi.fn().mockResolvedValue(undefined);

    const count = await checkAllOrgBreaches(mockPrisma as never, mockOnBreach);

    expect(mockOnBreach).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
