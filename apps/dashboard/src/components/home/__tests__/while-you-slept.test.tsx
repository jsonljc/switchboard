import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhileYouSlept } from "../while-you-slept";
import type { WhileYouSleptRow } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(
  agentKey: WhileYouSleptRow["agentKey"],
  time: string,
  text: string,
): WhileYouSleptRow {
  return { agentKey, time, text };
}

const fiveRows: WhileYouSleptRow[] = [
  makeRow("riley", "2:14a", "Riley paused the $87 ad"),
  makeRow("alex", "1:32a", "Alex booked 2 consults"),
  makeRow("mira", "11:48p", "Mira finished a reel"),
  makeRow("alex", "11:10p", "Alex sent 3 follow-ups"),
  makeRow("riley", "10:55p", "Riley adjusted the campaign budget"),
];

const threeRows: WhileYouSleptRow[] = fiveRows.slice(0, 3);

const oneRow: WhileYouSleptRow[] = [fiveRows[0]];

// ---------------------------------------------------------------------------
// Tests: row cap + "View all" link
// ---------------------------------------------------------------------------

describe("WhileYouSlept — row cap and View all link", () => {
  it("shows only 3 rows when given 5", () => {
    render(<WhileYouSlept rows={fiveRows} />);
    expect(screen.getByRole("heading", { name: /while you slept/i })).toBeInTheDocument();
    // Each row renders its text; the 4th and 5th should not appear.
    expect(screen.queryByText("Alex sent 3 follow-ups")).not.toBeInTheDocument();
    expect(screen.queryByText("Riley adjusted the campaign budget")).not.toBeInTheDocument();
    // First 3 are visible.
    expect(screen.getByText("Riley paused the $87 ad")).toBeInTheDocument();
    expect(screen.getByText("Alex booked 2 consults")).toBeInTheDocument();
    expect(screen.getByText("Mira finished a reel")).toBeInTheDocument();
  });

  it("renders exactly 3 list items when given 5", () => {
    const { container } = render(<WhileYouSlept rows={fiveRows} />);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
  });

  it("shows 'View all' link with href /activity when list exceeds 3", () => {
    render(<WhileYouSlept rows={fiveRows} />);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/activity");
  });

  it("does NOT show 'View all' link when exactly 3 rows given", () => {
    render(<WhileYouSlept rows={threeRows} />);
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
  });

  it("does NOT show 'View all' link when fewer than 3 rows given", () => {
    render(<WhileYouSlept rows={oneRow} />);
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: empty state
// ---------------------------------------------------------------------------

describe("WhileYouSlept — empty state", () => {
  it("renders the calm line when rows is empty", () => {
    const { container } = render(<WhileYouSlept rows={[]} />);
    expect(container.textContent).toContain("All quiet overnight.");
  });

  it("renders NO list items when rows is empty", () => {
    const { container } = render(<WhileYouSlept rows={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("does NOT render any fabricated activity text", () => {
    const { container } = render(<WhileYouSlept rows={[]} />);
    // None of the fixture texts should appear.
    expect(container.textContent).not.toContain("booked");
    expect(container.textContent).not.toContain("paused");
    expect(container.textContent).not.toContain("finished");
  });
});

// ---------------------------------------------------------------------------
// Tests: row rendering (time, text, data-agent stripe)
// ---------------------------------------------------------------------------

describe("WhileYouSlept — individual row rendering", () => {
  it("renders the row time", () => {
    render(<WhileYouSlept rows={oneRow} />);
    expect(screen.getByText("2:14a")).toBeInTheDocument();
  });

  it("renders the row text", () => {
    render(<WhileYouSlept rows={oneRow} />);
    expect(screen.getByText("Riley paused the $87 ad")).toBeInTheDocument();
  });

  it("sets data-agent on the row matching the agentKey", () => {
    const { container } = render(<WhileYouSlept rows={oneRow} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-agent", "riley");
  });

  it("sets data-agent=alex on an alex row", () => {
    const alexRow = makeRow("alex", "9:00a", "Alex did something");
    const { container } = render(<WhileYouSlept rows={[alexRow]} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-agent", "alex");
  });
});
