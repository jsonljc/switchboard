// apps/dashboard/src/app/(auth)/console/__tests__/redirect.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { redirect } from "next/navigation";
import ConsolePage from "../page";

describe("/console redirect shim (C2a)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("calls Next's redirect with '/'", () => {
    ConsolePage();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
