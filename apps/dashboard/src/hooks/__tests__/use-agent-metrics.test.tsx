import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentMetrics } from "../use-agent-metrics";

describe("useAgentMetrics (fixture form)", () => {
  it("returns immediate metrics fixture", () => {
    const { result } = renderHook(() => useAgentMetrics("alex"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.stats).toHaveLength(3);
    expect(result.current.data?.freshness.dataSource).toBe("fixture");
  });

  it("alex hero kind is tours-booked", () => {
    const { result } = renderHook(() => useAgentMetrics("alex"));
    expect(result.current.data?.hero.kind).toBe("tours-booked");
  });

  it("riley hero kind is ad-leads", () => {
    const { result } = renderHook(() => useAgentMetrics("riley"));
    expect(result.current.data?.hero.kind).toBe("ad-leads");
  });
});
