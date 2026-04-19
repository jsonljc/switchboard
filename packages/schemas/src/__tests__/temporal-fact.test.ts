import { describe, it, expect } from "vitest";
import {
  FactEntityTypeSchema,
  FactCategorySchema,
  FactStatusSchema,
  FactSourceSchema,
  FactValueTypeSchema,
  SOURCE_TRUST_ORDER,
  RecordFactInputSchema,
  RetractFactInputSchema,
  TemporalFactSchema,
} from "../temporal-fact.js";

describe("FactEntityTypeSchema", () => {
  it("accepts valid entity types", () => {
    for (const type of ["account", "campaign", "contact"]) {
      expect(FactEntityTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects invalid entity type", () => {
    expect(() => FactEntityTypeSchema.parse("invalid")).toThrow();
  });
});

describe("FactCategorySchema", () => {
  it("accepts valid categories", () => {
    for (const cat of [
      "configuration",
      "performance",
      "status",
      "relationship",
      "human_assertion",
    ]) {
      expect(FactCategorySchema.parse(cat)).toBe(cat);
    }
  });

  it("rejects invalid category", () => {
    expect(() => FactCategorySchema.parse("invalid")).toThrow();
  });
});

describe("FactStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const status of ["active", "superseded", "retracted"]) {
      expect(FactStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects invalid status", () => {
    expect(() => FactStatusSchema.parse("invalid")).toThrow();
  });
});

describe("FactSourceSchema", () => {
  it("accepts valid sources", () => {
    for (const source of ["system", "api", "human"]) {
      expect(FactSourceSchema.parse(source)).toBe(source);
    }
  });

  it("rejects invalid source", () => {
    expect(() => FactSourceSchema.parse("agent")).toThrow();
    expect(() => FactSourceSchema.parse("invalid")).toThrow();
  });
});

describe("FactValueTypeSchema", () => {
  it("accepts valid value types", () => {
    for (const type of ["string", "number", "boolean", "json", "enum_value"]) {
      expect(FactValueTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects invalid value type", () => {
    expect(() => FactValueTypeSchema.parse("invalid")).toThrow();
  });
});

describe("SOURCE_TRUST_ORDER", () => {
  it("has correct trust ordering", () => {
    expect(SOURCE_TRUST_ORDER.system).toBe(3);
    expect(SOURCE_TRUST_ORDER.api).toBe(2);
    expect(SOURCE_TRUST_ORDER.human).toBe(1);
  });
});

describe("RecordFactInputSchema", () => {
  it("parses valid input with valueText", () => {
    const result = RecordFactInputSchema.parse({
      organizationId: "org-1",
      deploymentId: "dep-1",
      entityType: "account",
      entityId: "acc-1",
      category: "configuration",
      subject: "account-status",
      valueText: "active",
      source: "system",
    });
    expect(result.organizationId).toBe("org-1");
    expect(result.subject).toBe("account-status");
    expect(result.valueType).toBe("string");
    expect(result.confidence).toBe(1.0);
  });

  it("parses valid input with valueJson", () => {
    const result = RecordFactInputSchema.parse({
      organizationId: "org-1",
      deploymentId: "dep-1",
      entityType: "campaign",
      entityId: "camp-1",
      category: "performance",
      subject: "metrics",
      valueJson: { spend: 100, impressions: 5000 },
      valueType: "json",
      source: "api",
    });
    expect(result.valueJson).toEqual({ spend: 100, impressions: 5000 });
    expect(result.valueType).toBe("json");
  });

  it("enforces kebab-case subject", () => {
    expect(() =>
      RecordFactInputSchema.parse({
        organizationId: "org-1",
        deploymentId: "dep-1",
        entityType: "contact",
        entityId: "con-1",
        category: "status",
        subject: "invalid_subject",
        valueText: "test",
        source: "human",
      }),
    ).toThrow();

    expect(() =>
      RecordFactInputSchema.parse({
        organizationId: "org-1",
        deploymentId: "dep-1",
        entityType: "contact",
        entityId: "con-1",
        category: "status",
        subject: "InvalidSubject",
        valueText: "test",
        source: "human",
      }),
    ).toThrow();
  });

  it("requires at least valueText or valueJson", () => {
    expect(() =>
      RecordFactInputSchema.parse({
        organizationId: "org-1",
        deploymentId: "dep-1",
        entityType: "account",
        entityId: "acc-1",
        category: "configuration",
        subject: "test-subject",
        source: "system",
      }),
    ).toThrow();
  });

  it("accepts optional fields", () => {
    const result = RecordFactInputSchema.parse({
      organizationId: "org-1",
      deploymentId: "dep-1",
      entityType: "account",
      entityId: "acc-1",
      category: "configuration",
      subject: "account-status",
      valueText: "active",
      source: "api",
      sourceDetail: "salesforce-sync",
      changeReason: "status update from CRM",
      validFrom: new Date("2026-01-01"),
      observedAt: new Date("2026-01-01T10:00:00Z"),
      confidence: 0.8,
    });
    expect(result.sourceDetail).toBe("salesforce-sync");
    expect(result.changeReason).toBe("status update from CRM");
    expect(result.validFrom).toBeInstanceOf(Date);
    expect(result.observedAt).toBeInstanceOf(Date);
    expect(result.confidence).toBe(0.8);
  });

  it("applies default values", () => {
    const result = RecordFactInputSchema.parse({
      organizationId: "org-1",
      deploymentId: "dep-1",
      entityType: "account",
      entityId: "acc-1",
      category: "configuration",
      subject: "test",
      valueText: "value",
      source: "system",
    });
    expect(result.valueType).toBe("string");
    expect(result.confidence).toBe(1.0);
  });
});

describe("RetractFactInputSchema", () => {
  it("parses valid retract input", () => {
    const result = RetractFactInputSchema.parse({
      reason: "Fact was incorrect",
    });
    expect(result.reason).toBe("Fact was incorrect");
  });

  it("requires reason", () => {
    expect(() => RetractFactInputSchema.parse({})).toThrow();
  });
});

describe("TemporalFactSchema", () => {
  it("parses a full fact object", () => {
    const result = TemporalFactSchema.parse({
      id: "fact-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      entityType: "account",
      entityId: "acc-1",
      category: "configuration",
      subject: "account-status",
      valueText: "active",
      valueJson: null,
      valueType: "string",
      confidence: 1.0,
      source: "system",
      sourceDetail: null,
      changeReason: null,
      status: "active",
      supersededById: null,
      validFrom: new Date("2026-01-01"),
      validUntil: null,
      observedAt: new Date("2026-01-01T10:00:00Z"),
      createdAt: new Date(),
    });
    expect(result.id).toBe("fact-1");
    expect(result.entityType).toBe("account");
    expect(result.status).toBe("active");
  });

  it("accepts fact with supersededById", () => {
    const result = TemporalFactSchema.parse({
      id: "fact-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      entityType: "campaign",
      entityId: "camp-1",
      category: "performance",
      subject: "daily-spend",
      valueText: "100",
      valueJson: null,
      valueType: "number",
      confidence: 1.0,
      source: "api",
      sourceDetail: "analytics-api",
      changeReason: "updated daily metrics",
      status: "superseded",
      supersededById: "fact-2",
      validFrom: new Date("2026-01-01"),
      validUntil: new Date("2026-01-02"),
      observedAt: new Date("2026-01-01T10:00:00Z"),
      createdAt: new Date(),
    });
    expect(result.status).toBe("superseded");
    expect(result.supersededById).toBe("fact-2");
    expect(result.validUntil).toBeInstanceOf(Date);
  });
});
