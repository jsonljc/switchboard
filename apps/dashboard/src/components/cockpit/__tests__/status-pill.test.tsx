// apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../status-pill";
import type { CockpitStatus } from "../types";

describe("StatusPill", () => {
  it("renders WORKING when status is WORKING and not halted", () => {
    render(<StatusPill statusKey="WORKING" halted={false} />);
    expect(screen.getByText("WORKING")).toBeInTheDocument();
  });

  it("renders HALTED when halted regardless of statusKey", () => {
    render(<StatusPill statusKey="WAITING" halted />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
  });

  it("renders WAITING label", () => {
    render(<StatusPill statusKey="WAITING" halted={false} />);
    expect(screen.getByText("WAITING")).toBeInTheDocument();
  });

  it("renders IDLE label", () => {
    render(<StatusPill statusKey="IDLE" halted={false} />);
    expect(screen.getByText("IDLE")).toBeInTheDocument();
  });
});

describe("StatusPill — colorFor / pulseFor overrides", () => {
  it("uses the supplied colorFor and pulseFor when provided", () => {
    const colorFor = (_s: CockpitStatus, _halted: boolean) => "rgb(184, 108, 80)";
    const pulseFor = (_s: CockpitStatus, _halted: boolean) => true;
    const { container } = render(
      <StatusPill statusKey="WAITING" halted={false} colorFor={colorFor} pulseFor={pulseFor} />,
    );
    // label span is the last direct child of the outer wrapper span
    const label = container.firstElementChild!.lastElementChild as HTMLElement;
    expect(label.style.color).toBe("rgb(184, 108, 80)");
    expect(label.textContent).toBe("WAITING");
  });

  it("falls back to alex-config statusColor / statusPulse when overrides are absent", () => {
    const { container } = render(<StatusPill statusKey="WAITING" halted={false} />);
    // label span is the last direct child of the outer wrapper span
    const label = container.firstElementChild!.lastElementChild as HTMLElement;
    expect(label.style.color).not.toBe("rgb(184, 108, 80)");
    expect(label.style.color.length).toBeGreaterThan(0);
  });
});
