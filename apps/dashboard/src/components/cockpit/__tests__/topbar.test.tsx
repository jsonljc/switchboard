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
