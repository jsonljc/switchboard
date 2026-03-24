import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StaffNav } from "../staff-nav.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/hooks/use-approvals", () => ({
  useApprovalCount: () => 2,
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { name: "Test Gym" } } }),
}));

vi.mock("@/hooks/use-view-preference", () => ({
  useViewPreference: () => ({ view: "staff", setView: vi.fn(), isOwner: false, isStaff: true }),
}));

describe("StaffNav", () => {
  it("renders 5 nav items plus settings", () => {
    render(<StaffNav />);
    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("CRM")).toBeDefined();
    expect(screen.getByText("Campaigns")).toBeDefined();
    expect(screen.getByText("Performance")).toBeDefined();
    expect(screen.getByText("Decide")).toBeDefined();
  });

  it("shows Switchboard logo linking to home", () => {
    render(<StaffNav />);
    expect(screen.getByText("Switchboard")).toBeDefined();
  });

  it("shows org name", () => {
    render(<StaffNav />);
    expect(screen.getByText("Test Gym")).toBeDefined();
  });
});
