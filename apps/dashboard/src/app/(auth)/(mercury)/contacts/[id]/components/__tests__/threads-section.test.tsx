import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetailThread } from "@switchboard/schemas";
import { ThreadsSection } from "../threads-section";

describe("ThreadsSection", () => {
  it("renders the empty copy when there is no thread", () => {
    render(<ThreadsSection items={[]} />);
    expect(screen.getByText("No conversation thread yet.")).toBeInTheDocument();
  });

  it("renders an aria-disabled tile with the 'opening soon' sub-label while the thread route is closed", () => {
    const items: ContactDetailThread[] = [
      {
        id: "t-1",
        assignedAgent: "alex",
        summary: "Following up on the wedding-day quote.",
        lastMessageAt: "2026-05-09T09:00:00.000Z",
      },
    ];
    render(<ThreadsSection items={items} />);
    expect(screen.getByText(/opening soon/)).toBeInTheDocument();
    expect(screen.getByText("Following up on the wedding-day quote.")).toBeInTheDocument();
    expect(screen.getByText("alex")).toBeInTheDocument();
    // Tile is rendered as a div with aria-disabled and tooltip while closed.
    const tile = screen.getByTitle("Conversation view coming next");
    expect(tile).toHaveAttribute("aria-disabled", "true");
    // No <a> link while closed.
    expect(screen.queryByRole("link")).toBeNull();
  });
});
