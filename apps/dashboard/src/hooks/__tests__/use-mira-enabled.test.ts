// apps/dashboard/src/hooks/__tests__/use-mira-enabled.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock useAgentMission to control the three states under test.
// The actual hook calls tanstack-query + fetch; we don't need any of that here —
// useMiraEnabled is a thin derivation layer whose logic is what we're testing.
let mockReturn: { data: unknown; isLoading: boolean; isError: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
};

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: (_agentKey: string) => mockReturn,
}));

import { useMiraEnabled } from "../use-mira-enabled";

describe("useMiraEnabled", () => {
  it("loading → enabled is undefined, isLoading is true", () => {
    mockReturn = { data: undefined, isLoading: true, isError: false, error: null };
    const { result } = renderHook(() => useMiraEnabled());
    expect(result.current.enabled).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it("error (no data) → enabled is false, isLoading is false", () => {
    mockReturn = { data: undefined, isLoading: false, isError: true, error: new Error("404") };
    const { result } = renderHook(() => useMiraEnabled());
    expect(result.current.enabled).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("data present (no error) → enabled is true, isLoading is false", () => {
    mockReturn = {
      data: { agentKey: "mira", displayName: "Mira" },
      isLoading: false,
      isError: false,
      error: null,
    };
    const { result } = renderHook(() => useMiraEnabled());
    expect(result.current.enabled).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});
