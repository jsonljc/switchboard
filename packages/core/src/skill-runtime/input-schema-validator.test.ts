import { describe, it, expect } from "vitest";
import { validateToolInput, redactInputForLog } from "./input-schema-validator.js";

describe("validateToolInput", () => {
  const schema = {
    type: "object" as const,
    properties: {
      name: { type: "string" },
      age: { type: "number" },
      stage: { type: "string", enum: ["new", "active", "closed"] },
      tags: { type: "array" },
      flag: { type: "boolean" },
    },
    required: ["name", "stage"],
  };

  it("passes well-formed input", () => {
    const result = validateToolInput(schema, {
      name: "alice",
      stage: "active",
      tags: ["x", "y"],
    });
    expect(result.ok).toBe(true);
  });

  it("flags a missing required field", () => {
    const result = validateToolInput(schema, { name: "alice" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("stage");
  });

  it("flags a wrong type", () => {
    const result = validateToolInput(schema, { name: 42, stage: "new" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("string");
  });

  it("flags an enum violation", () => {
    const result = validateToolInput(schema, { name: "alice", stage: "evil" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("one of");
  });

  it("rejects non-object inputs", () => {
    const result = validateToolInput(schema, "definitely not an object");
    expect(result.ok).toBe(false);
  });

  it("is lenient when no schema is provided", () => {
    expect(validateToolInput(undefined, { anything: 1 }).ok).toBe(true);
    expect(validateToolInput({}, { anything: 1 }).ok).toBe(true);
  });

  it("ignores fields not in the schema (does not fail closed)", () => {
    // Schema-validation defense is layered with the factory pattern. We
    // intentionally accept extras so tools tolerate slight model drift; the
    // factory-with-context closes the security loop.
    const result = validateToolInput(schema, { name: "x", stage: "new", extra: "junk" });
    expect(result.ok).toBe(true);
  });
});

describe("redactInputForLog", () => {
  it("preserves keys but elides values", () => {
    const out = redactInputForLog({
      name: "alice",
      orgId: "evil-org",
      tags: [1, 2, 3],
      meta: { secret: 1 },
    });
    expect(out).not.toContain("alice");
    expect(out).not.toContain("evil-org");
    expect(out).toContain("name");
    expect(out).toContain("orgId");
    expect(out).toContain("<string>");
    expect(out).toContain("<array:3>");
  });

  it("handles null and primitives", () => {
    expect(redactInputForLog(null)).toBe("null");
    expect(redactInputForLog("hello")).toBe("<string>");
  });
});
