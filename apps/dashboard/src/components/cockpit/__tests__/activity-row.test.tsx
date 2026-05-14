// apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityRow } from "../activity-row";
import type { ActivityRow as ActivityRowType } from "../types";

describe("ActivityRow", () => {
  it("renders time, kind label, and head", () => {
    const item: ActivityRowType = {
      time: "11:42",
      kind: "booked",
      head: "Maya R. confirmed Saturday tour",
    };
    render(<ActivityRow item={item} open={false} toggle={() => {}} />);
    expect(screen.getByText("11:42")).toBeInTheDocument();
    expect(screen.getByText("BOOKED")).toBeInTheDocument();
    expect(screen.getByText("Maya R. confirmed Saturday tour")).toBeInTheDocument();
  });

  it("renders the qualified kind label", () => {
    const item: ActivityRowType = { time: "10:30", kind: "qualified", head: "Devon K." };
    render(<ActivityRow item={item} open={false} toggle={() => {}} />);
    expect(screen.getByText("QUALIFIED")).toBeInTheDocument();
  });

  it("renders the escalated kind label as 'TO YOU'", () => {
    const item: ActivityRowType = { time: "09:30", kind: "escalated", head: "Refund request" };
    render(<ActivityRow item={item} open={false} toggle={() => {}} />);
    expect(screen.getByText("TO YOU")).toBeInTheDocument();
  });
});
