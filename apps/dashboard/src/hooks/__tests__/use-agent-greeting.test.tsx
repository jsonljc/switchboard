import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentGreeting } from "../use-agent-greeting";

describe("useAgentGreeting (fixture form)", () => {
  it("returns immediate fixture data with isLoading=false", () => {
    const { result } = renderHook(() => useAgentGreeting("alex"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.freshness.dataSource).toBe("fixture");
  });

  it("differs between alex and riley", () => {
    const a = renderHook(() => useAgentGreeting("alex")).result.current.data;
    const r = renderHook(() => useAgentGreeting("riley")).result.current.data;
    expect(a?.segments).not.toEqual(r?.segments);
  });
});
