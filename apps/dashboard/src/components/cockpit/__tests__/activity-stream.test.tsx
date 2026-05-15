// apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const rowsWithIds: ActivityRow[] = [
  {
    id: "a1",
    time: "11:58",
    kind: "booked",
    head: "Maya Lin confirmed",
    body: "Calendar held.",
    who: "Maya Lin",
    contactId: "c1",
    preview: [{ from: "contact", text: "hi" }],
    replyable: true,
  },
  {
    id: "a2",
    time: "11:30",
    kind: "qualified",
    head: "Jordan F. qualified",
    body: "Looking soon.",
    who: "Jordan F.",
    contactId: "c2",
    preview: [{ from: "contact", text: "yo" }],
    replyable: true,
  },
];

describe("<ActivityStream>", () => {
  it("keeps each row's open state independent", async () => {
    const user = userEvent.setup();
    render(<ActivityStream rows={rowsWithIds} filter="all" setFilter={() => {}} />);
    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]!);
    expect(screen.getByText("Calendar held.")).toBeInTheDocument();
    expect(screen.queryByText("Looking soon.")).not.toBeInTheDocument();
  });

  it("filter chips preserve open state on switch back to 'all'", async () => {
    const user = userEvent.setup();
    let filter: "all" | "booked" | "escalations" = "all";
    const setFilter = (f: typeof filter) => {
      filter = f;
    };
    const { rerender } = render(
      <ActivityStream rows={rowsWithIds} filter={filter} setFilter={setFilter} />,
    );
    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]!);
    rerender(<ActivityStream rows={rowsWithIds} filter="booked" setFilter={setFilter} />);
    rerender(<ActivityStream rows={rowsWithIds} filter="all" setFilter={setFilter} />);
    expect(screen.getByText("Calendar held.")).toBeInTheDocument();
  });
});
