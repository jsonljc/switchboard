import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CrmTabs, type CrmTab } from "../crm-tabs.js";

describe("CrmTabs", () => {
  const defaultProps = {
    activeTab: "leads" as CrmTab,
    onTabChange: vi.fn(),
    counts: { leads: 12, chats: 3, escalations: 1, inbox: 5 },
  };

  it("renders all 4 tabs with counts", () => {
    render(<CrmTabs {...defaultProps} />);
    expect(screen.getByText(/Leads/)).toBeDefined();
    expect(screen.getByText(/12/)).toBeDefined();
    expect(screen.getByText(/Chats/)).toBeDefined();
    expect(screen.getByText(/3/)).toBeDefined();
    expect(screen.getByText(/Escalations/)).toBeDefined();
    expect(screen.getByText(/Inbox/)).toBeDefined();
  });

  it("calls onTabChange when tab clicked", () => {
    render(<CrmTabs {...defaultProps} />);
    fireEvent.click(screen.getByText(/Chats/));
    expect(defaultProps.onTabChange).toHaveBeenCalledWith("chats");
  });
});
