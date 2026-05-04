import { describe, expect, it } from "vitest";
import { resolveAgentKey } from "../agent-key-resolver.js";

describe("resolveAgentKey", () => {
  it("maps canonical names directly", () => {
    expect(resolveAgentKey("alex")).toBe("alex");
    expect(resolveAgentKey("riley")).toBe("riley");
    expect(resolveAgentKey("mira")).toBe("mira");
  });

  it("maps role aliases", () => {
    expect(resolveAgentKey("lead-specialist")).toBe("alex");
    expect(resolveAgentKey("speed-to-lead")).toBe("alex");
    expect(resolveAgentKey("ad-optimizer")).toBe("riley");
    expect(resolveAgentKey("creative-director")).toBe("mira");
  });

  it("is case-insensitive", () => {
    expect(resolveAgentKey("ALEX")).toBe("alex");
    expect(resolveAgentKey("Riley")).toBe("riley");
  });

  it("defaults to alex when sourceAgent is null/undefined/empty", () => {
    expect(resolveAgentKey(null)).toBe("alex");
    expect(resolveAgentKey(undefined)).toBe("alex");
    expect(resolveAgentKey("")).toBe("alex");
  });

  it("defaults to alex for unknown strings", () => {
    expect(resolveAgentKey("unknown-bot")).toBe("alex");
  });
});
