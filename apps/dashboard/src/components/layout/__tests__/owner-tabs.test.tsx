import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OwnerTabs } from "../owner-tabs.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/hooks/use-approvals", () => ({
  useApprovalCount: () => 3,
}));

describe("OwnerTabs", () => {
  it("renders 3 tab items", () => {
    render(<OwnerTabs />);
    expect(screen.getByText("Home")).toBeDefined();
    expect(screen.getByText("Decide")).toBeDefined();
    expect(screen.getByText("Me")).toBeDefined();
  });

  it("shows approval count badge on Decide", () => {
    render(<OwnerTabs />);
    expect(screen.getByText("3")).toBeDefined();
  });
});
