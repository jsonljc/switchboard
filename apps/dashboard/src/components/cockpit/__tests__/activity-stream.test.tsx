// apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityStream } from "../activity-stream";
import type { ActivityRow } from "../types";

// ActivityRow now calls useRouter() for the "Tell Alex about" deep-link.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const rows: ActivityRow[] = [
  { time: "11:42", kind: "booked", head: "Maya R. confirmed" },
  { time: "10:55", kind: "replied", head: "Tom W. answered" },
  { time: "09:30", kind: "escalated", head: "Refund request" },
];

describe("ActivityStream", () => {
  it("renders all rows when filter is 'all'", () => {
    render(<ActivityStream rows={rows} filter="all" setFilter={() => {}} />);
    expect(screen.getByText("Maya R. confirmed")).toBeInTheDocument();
    expect(screen.getByText("Tom W. answered")).toBeInTheDocument();
    expect(screen.getByText("Refund request")).toBeInTheDocument();
  });

  it("filters to bookings only when filter is 'booked'", () => {
    render(<ActivityStream rows={rows} filter="booked" setFilter={() => {}} />);
    expect(screen.getByText("Maya R. confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Tom W. answered")).not.toBeInTheDocument();
    expect(screen.queryByText("Refund request")).not.toBeInTheDocument();
  });

  it("filters to escalations + waiting when filter is 'escalations'", () => {
    render(<ActivityStream rows={rows} filter="escalations" setFilter={() => {}} />);
    expect(screen.queryByText("Maya R. confirmed")).not.toBeInTheDocument();
    expect(screen.getByText("Refund request")).toBeInTheDocument();
  });

  it("invokes setFilter when a filter button is clicked", () => {
    const handler = vi.fn();
    render(<ActivityStream rows={rows} filter="all" setFilter={handler} />);
    fireEvent.click(screen.getByRole("button", { name: /booked/i }));
    expect(handler).toHaveBeenCalledWith("booked");
  });

  it("renders the empty-state copy when no rows match the filter", () => {
    render(<ActivityStream rows={[]} filter="all" setFilter={() => {}} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
