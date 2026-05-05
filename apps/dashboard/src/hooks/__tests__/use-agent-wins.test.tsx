import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentWins } from "../use-agent-wins";

describe("useAgentWins (fixture form)", () => {
  it("returns immediate wins fixture data", () => {
    const { result } = renderHook(() => useAgentWins("alex"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.freshness.dataSource).toBe("fixture");
    expect(result.current.data?.wins.length ?? 0).toBeGreaterThan(0);
  });
});
