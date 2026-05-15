// apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Topbar } from "../topbar";

describe("Topbar", () => {
  it("renders Alex/Riley/Mira tabs", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Riley")).toBeInTheDocument();
    expect(screen.getByText("Mira")).toBeInTheDocument();
  });

  it("wraps Alex and Riley tabs in next/link with correct hrefs", () => {
    // Default tabs come from ALEX_CONFIG: Alex (active) → /alex, Riley → /riley.
    // Mira has no route (no `/mira` page exists in apps/dashboard/src/app/(auth)),
    // so the tab is rendered as a non-routing muted span.
    render(<Topbar paletteEnabled={false} compact={false} />);
    const alexLink = screen.getByText("Alex").closest("a");
    const rileyLink = screen.getByText("Riley").closest("a");
    expect(alexLink).not.toBeNull();
    expect(alexLink).toHaveAttribute("href", "/alex");
    expect(rileyLink).not.toBeNull();
    expect(rileyLink).toHaveAttribute("href", "/riley");
  });

  it("renders muted/no-href tabs as a non-link span (Mira default)", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    // Mira has no href/route; should not be wrapped in an <a>.
    const miraLink = screen.getByText("Mira").closest("a");
    expect(miraLink).toBeNull();
  });

  it("renders the Switchboard wordmark in non-compact mode", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
  });

  it("hides the Switchboard wordmark in compact mode", () => {
    render(<Topbar paletteEnabled={false} compact />);
    expect(screen.queryByText("Switchboard")).not.toBeInTheDocument();
  });

  it("renders the 'Tell Alex…' affordance as disabled when paletteEnabled is false", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    const btn = screen.getByText("Tell Alex…").closest("button")!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("renders 'Tell Alex…' by default", () => {
    render(<Topbar paletteEnabled compact={false} onOpenPalette={() => {}} />);
    expect(screen.getByText("Tell Alex…")).toBeInTheDocument();
  });

  it("renders the custom paletteLabel when provided", () => {
    render(
      <Topbar paletteEnabled compact={false} onOpenPalette={() => {}} paletteLabel="Tell Riley…" />,
    );
    expect(screen.getByText("Tell Riley…")).toBeInTheDocument();
    expect(screen.queryByText("Tell Alex…")).not.toBeInTheDocument();
  });
});
