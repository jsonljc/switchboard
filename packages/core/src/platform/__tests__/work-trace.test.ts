import { describe, it, expect } from "vitest";
import type { WorkTrace } from "../work-trace.js";

describe("WorkTrace type", () => {
  it("accepts ingressPath = 'platform_ingress'", () => {
    const t: Partial<WorkTrace> = { ingressPath: "platform_ingress" };
    expect(t.ingressPath).toBe("platform_ingress");
  });

  it("accepts ingressPath = 'store_recorded_operator_mutation'", () => {
    const t: Partial<WorkTrace> = { ingressPath: "store_recorded_operator_mutation" };
    expect(t.ingressPath).toBe("store_recorded_operator_mutation");
  });

  it("accepts hashInputVersion as a number", () => {
    const t: Partial<WorkTrace> = { hashInputVersion: 2 };
    expect(t.hashInputVersion).toBe(2);
  });
});
