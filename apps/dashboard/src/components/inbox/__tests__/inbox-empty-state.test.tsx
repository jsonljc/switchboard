import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InboxEmptyState } from "../inbox-empty-state";

describe("<InboxEmptyState>", () => {
  it("shows the unfiltered copy when filtered is false", () => {
    render(<InboxEmptyState filtered={false} />);
    expect(screen.getByText("That's everything.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your team is on top of it. New items will land here as they need a decision.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the filtered copy naming the agent when filtered is true", () => {
    render(<InboxEmptyState filtered agentName="Alex" />);
    expect(screen.getByText("Nothing from Alex.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Alex doesn't have anything waiting for you. Switch back to All to see the rest of the queue.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the polling meta line", () => {
    render(<InboxEmptyState filtered={false} />);
    expect(screen.getByText("Polling · checked just now")).toBeInTheDocument();
  });

  it("does not render the error eyebrow (empty is calm, not an error)", () => {
    render(<InboxEmptyState filtered={false} />);
    expect(screen.queryByText("Couldn't load")).toBeNull();
  });
});
