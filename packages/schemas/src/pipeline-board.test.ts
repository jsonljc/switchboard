import { describe, expect, it } from "vitest";
import {
  PipelineBoardContactSchema,
  PipelineBoardOpportunitySchema,
  PipelineBoardResponseSchema,
} from "./pipeline-board.js";

const VALID_ROW = {
  id: "opp_001",
  contactId: "c_001",
  serviceId: "svc_hydra",
  serviceName: "Hydrafacial · single session",
  stage: "interested" as const,
  timeline: "exploring" as const,
  priceReadiness: "unknown" as const,
  objections: [],
  qualificationComplete: false,
  estimatedValue: 28000,
  revenueTotal: 0,
  assignedAgent: "alex",
  assignedStaff: null,
  lostReason: null,
  notes: "Saw the ad on IG.",
  openedAt: "2026-05-13T01:14:00.000Z",
  updatedAt: "2026-05-13T01:41:00.000Z",
  closedAt: null,
  contact: { id: "c_001", name: "Jia Min Tan", primaryChannel: "whatsapp" as const },
};

describe("PipelineBoardContactSchema", () => {
  it("accepts a valid minimal contact", () => {
    const out = PipelineBoardContactSchema.parse({
      id: "c_001",
      name: "Jia Min Tan",
      primaryChannel: "whatsapp",
    });
    expect(out.name).toBe("Jia Min Tan");
  });

  it("rejects empty name", () => {
    expect(() =>
      PipelineBoardContactSchema.parse({ id: "c_001", name: "", primaryChannel: "whatsapp" }),
    ).toThrow();
  });

  it("rejects unknown channel", () => {
    expect(() =>
      PipelineBoardContactSchema.parse({ id: "c_001", name: "X", primaryChannel: "sms" }),
    ).toThrow();
  });
});

describe("PipelineBoardOpportunitySchema", () => {
  it("accepts a valid row", () => {
    const out = PipelineBoardOpportunitySchema.parse(VALID_ROW);
    expect(out.stage).toBe("interested");
    expect(out.contact.name).toBe("Jia Min Tan");
  });

  it("accepts null estimatedValue and missing notes", () => {
    const row = { ...VALID_ROW, estimatedValue: null, notes: null };
    expect(() => PipelineBoardOpportunitySchema.parse(row)).not.toThrow();
  });

  it("rejects invalid stage", () => {
    expect(() =>
      PipelineBoardOpportunitySchema.parse({ ...VALID_ROW, stage: "in_progress" }),
    ).toThrow();
  });

  it("rejects rows without a joined contact", () => {
    const { contact: _drop, ...rest } = VALID_ROW;
    expect(() => PipelineBoardOpportunitySchema.parse(rest)).toThrow();
  });
});

describe("PipelineBoardResponseSchema", () => {
  it("accepts an empty rows array", () => {
    expect(PipelineBoardResponseSchema.parse({ rows: [] })).toEqual({ rows: [] });
  });

  it("accepts an array of rows", () => {
    const parsed = PipelineBoardResponseSchema.parse({ rows: [VALID_ROW] });
    expect(parsed.rows).toHaveLength(1);
  });
});

describe("PipelineBoardResponseSchema — locked PR-C2 wire shape", () => {
  // Locked PR-C2 wire shape. If PR-C2's projection drifts from this, the test
  // fires before integration testing does. Maximal: every optional field
  // populated, no defaults, realistic SGD-medspa values (cents storage).
  const PR_C2_REPRESENTATIVE_PAYLOAD = {
    rows: [
      {
        id: "opp_pr_c2_lock_001",
        contactId: "c_pr_c2_lock_001",
        serviceId: "svc_profhilo",
        serviceName: "Profhilo · 2-session protocol",
        stage: "quoted",
        timeline: "soon",
        priceReadiness: "flexible",
        objections: [{ category: "price", raisedAt: "2026-05-12T02:00:00.000Z", resolvedAt: null }],
        qualificationComplete: true,
        estimatedValue: 168000, // cents = S$1,680
        revenueTotal: 0,
        assignedAgent: "alex",
        assignedStaff: "Dr. Yeo",
        lostReason: null,
        notes: "Quote sent Monday, asked for instalment options.",
        openedAt: "2026-05-06T05:00:00.000Z",
        updatedAt: "2026-05-13T07:19:00.000Z",
        closedAt: null,
        contact: {
          id: "c_pr_c2_lock_001",
          name: "Felicia Goh",
          primaryChannel: "whatsapp",
        },
      },
    ],
  };

  it("accepts the locked PR-C2 wire shape", () => {
    const parsed = PipelineBoardResponseSchema.parse(PR_C2_REPRESENTATIVE_PAYLOAD);
    // Explicit field asserts so Zod can't silently strip a field and pass.
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0]!;
    expect(row.estimatedValue).toBe(168000);
    const objection = row.objections[0]!;
    expect(objection.category).toBe("price");
    // Wire shape: ISO string, NOT Date (canonical ObjectionRecordSchema uses
    // z.coerce.date(), so this guards against the board schema accidentally
    // reusing that shape).
    expect(objection.raisedAt).toBe("2026-05-12T02:00:00.000Z");
    expect(typeof objection.raisedAt).toBe("string");
    expect(objection.resolvedAt).toBeNull();
    expect(row.contact.name).toBe("Felicia Goh");
    expect(row.closedAt).toBeNull();
    expect(row.assignedStaff).toBe("Dr. Yeo");
  });
});

describe("private exports lock", () => {
  it("does not export PipelineBoardObjectionSchema", () => {
    // Type-level lock: PipelineBoardObjectionSchema is intentionally private to
    // pipeline-board.ts (consumed only inside PipelineBoardOpportunitySchema).
    // If a future change exports it, the @ts-expect-error fires at compile time.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error PipelineBoardObjectionSchema is intentionally not exported
    const _check: typeof import("./pipeline-board.js").PipelineBoardObjectionSchema =
      undefined as never;
    expect(_check).toBeUndefined();
  });
});
