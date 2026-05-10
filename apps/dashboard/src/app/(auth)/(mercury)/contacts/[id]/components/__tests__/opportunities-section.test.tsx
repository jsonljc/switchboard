import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetailOpportunity } from "@switchboard/schemas";
import { OpportunitiesSection } from "../opportunities-section";

describe("OpportunitiesSection", () => {
  it("renders the empty copy when items is empty", () => {
    render(<OpportunitiesSection items={[]} />);
    expect(screen.getByText("No opportunities yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a hairline table with the documented columns", () => {
    const items: ContactDetailOpportunity[] = [
      {
        id: "opp-1",
        serviceName: "Wedding day",
        stage: "interested",
        estimatedValue: 4800,
        openedAt: "2026-05-01T12:00:00.000Z",
        closedAt: null,
      },
    ];
    render(<OpportunitiesSection items={items} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Service", "Stage", "Value", "Opened", "Closed"]);
    expect(screen.getByText("Wedding day")).toBeInTheDocument();
    expect(screen.getByText("Interested")).toBeInTheDocument();
    // Em-dash for null closedAt.
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
