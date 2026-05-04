import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentPipeline } from "../use-agent-pipeline";

describe("useAgentPipeline (fixture form)", () => {
  it("alex returns leads pipeline", () => {
    const { result } = renderHook(() => useAgentPipeline("alex"));
    expect(result.current.data?.pipelineKind).toBe("leads");
  });

  it("riley returns ad-sets pipeline", () => {
    const { result } = renderHook(() => useAgentPipeline("riley"));
    expect(result.current.data?.pipelineKind).toBe("ad-sets");
  });
});
