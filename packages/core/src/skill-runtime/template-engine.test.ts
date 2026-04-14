import { describe, it, expect } from "vitest";
import { interpolate } from "./template-engine.js";
import { SkillParameterError } from "./types.js";
import type { ParameterDeclaration } from "./types.js";

const stringParam: ParameterDeclaration = { name: "NAME", type: "string", required: true };
const enumParam: ParameterDeclaration = {
  name: "STAGE",
  type: "enum",
  required: true,
  values: ["a", "b"],
};
const objectParam: ParameterDeclaration = {
  name: "CONFIG",
  type: "object",
  required: true,
  schema: { tone: { type: "string", required: true } },
};
const optionalParam: ParameterDeclaration = { name: "OPT", type: "string", required: false };

describe("interpolate", () => {
  it("replaces {{PARAM}} with string value", () => {
    const result = interpolate("Hello {{NAME}}", { NAME: "World" }, [stringParam]);
    expect(result).toBe("Hello World");
  });

  it("replaces {{PARAM.field}} with nested object value", () => {
    const result = interpolate("Tone: {{CONFIG.tone}}", { CONFIG: { tone: "friendly" } }, [
      objectParam,
    ]);
    expect(result).toBe("Tone: friendly");
  });

  it("serializes object values to YAML when used without dot access", () => {
    const result = interpolate(
      "Config:\n{{CONFIG}}",
      { CONFIG: { tone: "friendly", style: "casual" } },
      [objectParam],
    );
    expect(result).toContain("style: casual");
    expect(result).toContain("tone: friendly");
  });

  it("throws SkillParameterError for missing required param", () => {
    expect(() => interpolate("{{NAME}}", {}, [stringParam])).toThrow(SkillParameterError);
  });

  it("leaves template untouched for missing optional param", () => {
    const result = interpolate("Value: {{OPT}}", {}, [optionalParam]);
    expect(result).toBe("Value: ");
  });

  it("throws SkillParameterError for missing nested field", () => {
    expect(() =>
      interpolate("{{CONFIG.missing}}", { CONFIG: { tone: "x" } }, [objectParam]),
    ).toThrow(SkillParameterError);
  });

  it("validates enum values", () => {
    expect(() => interpolate("{{STAGE}}", { STAGE: "invalid" }, [enumParam])).toThrow(
      SkillParameterError,
    );
  });

  it("accepts valid enum values", () => {
    const result = interpolate("{{STAGE}}", { STAGE: "a" }, [enumParam]);
    expect(result).toBe("a");
  });

  it("replaces multiple occurrences", () => {
    const result = interpolate("{{NAME}} is {{NAME}}", { NAME: "X" }, [stringParam]);
    expect(result).toBe("X is X");
  });

  it("handles template with no placeholders", () => {
    const result = interpolate("No params here", {}, []);
    expect(result).toBe("No params here");
  });

  it("serializes object YAML with sorted keys", () => {
    const result = interpolate("{{CONFIG}}", { CONFIG: { z: 1, a: 2 } }, [objectParam]);
    expect(result.indexOf("a:")).toBeLessThan(result.indexOf("z:"));
  });
});
