import { describe, expect, it } from "vitest";
import {
  QualificationSignalsSchema,
  QualificationSidecarValidationStatusSchema,
  WorkTraceQualificationSignalsSchema,
} from "../qualification-signals.js";

describe("QualificationSignalsSchema", () => {
  const valid = {
    treatmentInterest: "HIFU",
    preferredTimeWindow: "weekday evenings",
    serviceableMarket: "SG" as const,
    buyingIntent: "soft" as const,
    budgetAcknowledged: null,
    explicitDecline: false,
    disqualifierCandidates: [],
  };

  it("accepts a fully-populated payload", () => {
    expect(QualificationSignalsSchema.parse(valid)).toEqual(valid);
  });

  it("accepts nulls on optional-ish fields", () => {
    const payload = { ...valid, treatmentInterest: null, preferredTimeWindow: null };
    expect(QualificationSignalsSchema.parse(payload).treatmentInterest).toBeNull();
  });

  it("rejects unknown serviceableMarket values", () => {
    expect(() => QualificationSignalsSchema.parse({ ...valid, serviceableMarket: "TH" })).toThrow();
  });

  it("rejects unknown buyingIntent values", () => {
    expect(() => QualificationSignalsSchema.parse({ ...valid, buyingIntent: "maybe" })).toThrow();
  });

  it("caps disqualifierCandidates at 4 entries", () => {
    const tooMany = Array.from({ length: 5 }, () => ({ type: "out_of_area", evidence: "x" }));
    expect(() =>
      QualificationSignalsSchema.parse({ ...valid, disqualifierCandidates: tooMany }),
    ).toThrow();
  });

  it("caps evidence string at 280 chars", () => {
    const long = "x".repeat(281);
    expect(() =>
      QualificationSignalsSchema.parse({
        ...valid,
        disqualifierCandidates: [{ type: "out_of_area", evidence: long }],
      }),
    ).toThrow();
  });

  it("requires evidence to be non-empty", () => {
    expect(() =>
      QualificationSignalsSchema.parse({
        ...valid,
        disqualifierCandidates: [{ type: "out_of_area", evidence: "" }],
      }),
    ).toThrow();
  });
});

describe("QualificationSidecarValidationStatusSchema", () => {
  it("enumerates ok, multiple_blocks, malformed_json, schema_mismatch", () => {
    for (const s of ["ok", "multiple_blocks", "malformed_json", "schema_mismatch"]) {
      expect(QualificationSidecarValidationStatusSchema.parse(s)).toBe(s);
    }
    expect(() => QualificationSidecarValidationStatusSchema.parse("ok_ish")).toThrow();
  });
});

describe("WorkTraceQualificationSignalsSchema", () => {
  it("accepts the ok shape with a parsed payload", () => {
    const ok = {
      validationStatus: "ok" as const,
      payload: {
        treatmentInterest: "HIFU",
        preferredTimeWindow: null,
        serviceableMarket: "SG" as const,
        buyingIntent: "strong" as const,
        budgetAcknowledged: null,
        explicitDecline: false,
        disqualifierCandidates: [],
      },
    };
    expect(WorkTraceQualificationSignalsSchema.parse(ok)).toEqual(ok);
  });

  it("accepts the multiple_blocks shape with raw text", () => {
    const m = { validationStatus: "multiple_blocks" as const, raw: "<tag>x</tag><tag>y</tag>" };
    expect(WorkTraceQualificationSignalsSchema.parse(m)).toEqual(m);
  });

  it("accepts the malformed_json shape with raw text", () => {
    const m = { validationStatus: "malformed_json" as const, raw: "<tag>{not json}</tag>" };
    expect(WorkTraceQualificationSignalsSchema.parse(m)).toEqual(m);
  });

  it("accepts the schema_mismatch shape with raw + zodError", () => {
    const m = {
      validationStatus: "schema_mismatch" as const,
      raw: "<tag>{}</tag>",
      zodError: { issues: [{ path: ["buyingIntent"], message: "Required" }] },
    };
    expect(WorkTraceQualificationSignalsSchema.parse(m)).toEqual(m);
  });

  it("rejects an ok shape missing payload", () => {
    expect(() => WorkTraceQualificationSignalsSchema.parse({ validationStatus: "ok" })).toThrow();
  });
});
