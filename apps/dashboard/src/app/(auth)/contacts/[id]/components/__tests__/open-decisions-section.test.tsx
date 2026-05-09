import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetailOpenDecision } from "@switchboard/schemas";
import { OpenDecisionsSection } from "../open-decisions-section";

describe("OpenDecisionsSection", () => {
  it("renders the empty copy when items is empty", () => {
    render(<OpenDecisionsSection items={[]} />);
    expect(screen.getByText("No open decisions for this contact.")).toBeInTheDocument();
  });

  it("renders rows with kind badge, title, agent, and time", () => {
    const items: ContactDetailOpenDecision[] = [
      {
        id: "d-1",
        kind: "approval",
        agentKey: "alex",
        title: "Send the prepared wedding quote PDF to Lisa.",
        createdAt: "2026-05-09T07:00:00.000Z",
      },
      {
        id: "d-2",
        kind: "handoff",
        agentKey: null,
        title: "Handoff awaiting reply",
        createdAt: "2026-05-08T07:00:00.000Z",
      },
    ];
    render(<OpenDecisionsSection items={items} />);
    expect(screen.getByText("rec")).toBeInTheDocument();
    expect(screen.getByText("hand")).toBeInTheDocument();
    expect(screen.getByText("Send the prepared wedding quote PDF to Lisa.")).toBeInTheDocument();
    expect(screen.getByText("Handoff awaiting reply")).toBeInTheDocument();
    expect(screen.getByText("alex")).toBeInTheDocument();
    // Null agentKey renders as em-dash.
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
