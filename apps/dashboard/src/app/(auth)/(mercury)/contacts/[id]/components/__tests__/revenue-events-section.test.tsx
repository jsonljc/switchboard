import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetailRevenueEvent } from "@switchboard/schemas";
import { RevenueEventsSection } from "../revenue-events-section";

describe("RevenueEventsSection", () => {
  it("renders the empty copy when items is empty", () => {
    render(<RevenueEventsSection items={[]} />);
    expect(screen.getByText("No revenue events yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a hairline table with the documented columns", () => {
    const items: ContactDetailRevenueEvent[] = [
      {
        id: "rev-1",
        amount: 800,
        currency: "SGD",
        type: "deposit",
        status: "confirmed",
        recordedAt: "2026-05-07T12:00:00.000Z",
      },
    ];
    render(<RevenueEventsSection items={items} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Type", "Amount", "Status", "Recorded"]);
    expect(screen.getByText("Deposit")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });
});
