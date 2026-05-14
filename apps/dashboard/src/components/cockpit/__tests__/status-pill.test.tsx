// apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../status-pill";

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
