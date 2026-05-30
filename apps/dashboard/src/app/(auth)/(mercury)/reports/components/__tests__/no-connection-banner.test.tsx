import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoConnectionBanner } from "../no-connection-banner";

describe("NoConnectionBanner", () => {
  it("renders the eyebrow, message, and CTA", () => {
    render(<NoConnectionBanner />);
    expect(screen.getByText(/no meta ads connection/i)).toBeInTheDocument();
    expect(screen.getByText(/Campaigns and funnel will read zero/i)).toBeInTheDocument();
    // The connections UI lives at /settings/channels (ConnectionsList);
    // /settings/connections does not exist and 404s.
    const cta = screen.getByRole("link", { name: /Connect under Settings/i });
    expect(cta.getAttribute("href")).toBe("/settings/channels");
  });
});
