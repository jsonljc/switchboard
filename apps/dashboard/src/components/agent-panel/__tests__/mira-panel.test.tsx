import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraPanel } from "@/components/agent-panel/mira-panel";

describe("MiraPanel", () => {
  it("states the truth and offers no 'Set up' / dead-link CTA", () => {
    const { container } = render(<MiraPanel />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByText(/set up mira/i)).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="#"]')).toBeNull(); // no dead anchors
  });
});
