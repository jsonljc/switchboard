import { describe, it, expect, vi } from "vitest";
import { PipelineBoardResponseSchema } from "@switchboard/schemas";
import type { OpportunityBoardRow, OpportunityStore } from "../opportunity-store.js";
import {
  OpportunityNotFoundError,
  type TransitionStageInput,
  type TransitionStageResult,
} from "../opportunity-store.js";
import { listOpportunitiesForBoard, transitionOpportunityStage } from "../opportunity-board.js";

function mkRow(overrides: Partial<OpportunityBoardRow> = {}): OpportunityBoardRow {
  return {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc_profhilo",
    serviceName: "Profhilo · 2-session protocol",
    stage: "quoted",
    timeline: "soon",
    priceReadiness: "flexible",
    objections: [
      { category: "price", raisedAt: new Date("2026-05-12T02:00:00Z"), resolvedAt: null },
    ],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: "alex",
    assignedStaff: "Dr. Yeo",
    lostReason: null,
    notes: "Quote sent Monday",
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia Goh", primaryChannel: "whatsapp" },
    ...overrides,
  };
}

function mkStore(rows: OpportunityBoardRow[]): Pick<OpportunityStore, "findOrgBoard"> {
  return { findOrgBoard: vi.fn().mockResolvedValue(rows) };
}

describe("listOpportunitiesForBoard", () => {
  it("returns rows parseable by PipelineBoardResponseSchema", async () => {
    const store = mkStore([mkRow()]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(() => PipelineBoardResponseSchema.parse(result)).not.toThrow();
  });

  it("converts every Date field to an ISO string", async () => {
    const store = mkStore([mkRow()]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    const row = result.rows[0]!;
    expect(typeof row.openedAt).toBe("string");
    expect(row.openedAt).toBe("2026-05-06T05:00:00.000Z");
    expect(typeof row.updatedAt).toBe("string");
    expect(row.closedAt).toBeNull();
    expect(typeof row.objections[0]!.raisedAt).toBe("string");
    expect(row.objections[0]!.resolvedAt).toBeNull();
  });

  it("preserves closedAt as ISO when present", async () => {
    const store = mkStore([
      mkRow({ stage: "won", closedAt: new Date("2026-05-14T10:00:00Z"), revenueTotal: 168000 }),
    ]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(result.rows[0]!.closedAt).toBe("2026-05-14T10:00:00.000Z");
  });

  it("substitutes 'Unknown' for empty contact names", async () => {
    const store = mkStore([
      mkRow({ contact: { id: "c_1", name: "   ", primaryChannel: "whatsapp" } }),
    ]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(result.rows[0]!.contact.name).toBe("Unknown");
  });

  it("calls findOrgBoard with the requested orgId", async () => {
    const store = mkStore([]);
    await listOpportunitiesForBoard({ orgId: "org_xyz" }, { opportunityStore: store });
    expect(store.findOrgBoard).toHaveBeenCalledWith("org_xyz");
  });

  it("returns { rows: [] } for an org with no opportunities", async () => {
    const store = mkStore([]);
    const result = await listOpportunitiesForBoard(
      { orgId: "org_acme" },
      { opportunityStore: store },
    );
    expect(result).toEqual({ rows: [] });
  });
});

function mkTransitioningStore(
  result: TransitionStageResult | OpportunityNotFoundError,
): Pick<OpportunityStore, "transitionStage"> {
  return {
    transitionStage: vi.fn().mockImplementation((_: TransitionStageInput) => {
      if (result instanceof OpportunityNotFoundError) return Promise.reject(result);
      return Promise.resolve(result);
    }),
  };
}

describe("transitionOpportunityStage", () => {
  it("returns { opportunity } with the wire shape", async () => {
    const store = mkTransitioningStore({
      opportunity: mkRow({ stage: "booked" }),
    });
    const result = await transitionOpportunityStage(
      { orgId: "org_acme", id: "opp_1", stage: "booked", actor: { id: "user_42", type: "user" } },
      { opportunityStore: store },
    );
    expect(result.opportunity.stage).toBe("booked");
    expect(typeof result.opportunity.updatedAt).toBe("string");
  });

  it("propagates OpportunityNotFoundError from the store", async () => {
    const err = new OpportunityNotFoundError("opp_missing");
    const store = mkTransitioningStore(err);
    await expect(
      transitionOpportunityStage(
        { orgId: "org_acme", id: "opp_missing", stage: "booked", actor: { id: "u", type: "user" } },
        { opportunityStore: store },
      ),
    ).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });

  it("forwards the input verbatim to the store", async () => {
    const store = mkTransitioningStore({ opportunity: mkRow() });
    const input = {
      orgId: "org_acme",
      id: "opp_1",
      stage: "won" as const,
      actor: { id: "user_42", type: "user" as const },
    };
    await transitionOpportunityStage(input, { opportunityStore: store });
    expect(store.transitionStage).toHaveBeenCalledWith(input);
  });
});
