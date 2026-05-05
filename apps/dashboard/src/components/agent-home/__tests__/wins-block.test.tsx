import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WinsBlock } from "../wins-block";
import type { WinsViewModel } from "@/lib/agent-home/types";

const baseVm: WinsViewModel = {
  wins: [
    {
      id: "w1",
      agentKey: "alex",
      source: "recommendation",
      occurredAt: "2026-05-04T11:42:00.000Z",
      timeFolio: "11:42 AM",
      proseSegments: [
        { kind: "accent", text: "Booked" },
        { kind: "text", text: " a tour with Jordan." },
      ],
      undo: { available: true, until: "2026-05-05T11:42:00.000Z" },
    },
  ],
  hasMore: true,
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "fixture" },
};

describe("WinsBlock", () => {
  it("renders win prose with accent", () => {
    render(<WinsBlock vm={baseVm} agentKey="alex" />);
    expect(screen.getByText("Booked")).toHaveClass("accent");
  });

  it("renders Undo button when undo.available is true", () => {
    render(<WinsBlock vm={baseVm} agentKey="alex" />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("renders empty-state copy when wins array is empty", () => {
    const empty: WinsViewModel = { ...baseVm, wins: [] };
    render(<WinsBlock vm={empty} agentKey="alex" />);
    expect(screen.getByText(/still warming up/i)).toBeInTheDocument();
  });
});
