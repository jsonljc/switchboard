import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WinsBlock } from "../wins-block";
import type { WinsViewModel } from "@/lib/agent-home/types";

vi.mock("@/hooks/use-undo-win", () => ({
  useUndoWin: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

const baseWin = {
  id: "w1",
  agentKey: "alex" as const,
  source: "recommendation" as const,
  occurredAt: "2026-05-04T11:42:00.000Z",
  timeFolio: "11:42 AM",
  proseSegments: [
    { kind: "accent" as const, text: "Booked" },
    { kind: "text" as const, text: " a tour with Jordan." },
  ],
  undo: { available: true as const, until: "2026-05-05T11:42:00.000Z" },
};

const baseVm: WinsViewModel = {
  wins: [baseWin],
  hasMore: false,
  freshness: { generatedAt: "2026-05-04T08:00:00.000Z", window: "today", dataSource: "live" },
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

  it("renders 'Undo window closed' inline when undo is expired", () => {
    const expired: WinsViewModel = {
      ...baseVm,
      wins: [
        {
          ...baseWin,
          undo: {
            available: false,
            until: "2026-05-04T05:00:00.000Z",
            unavailableReason: "expired",
          },
        },
      ],
    };
    render(<WinsBlock vm={expired} agentKey="alex" />);
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
    expect(screen.getByText(/undo window closed/i)).toBeInTheDocument();
  });

  it("renders no undo controls when not-reversible", () => {
    const notReversible: WinsViewModel = {
      ...baseVm,
      wins: [
        {
          ...baseWin,
          undo: { available: false, until: null, unavailableReason: "not-reversible" },
        },
      ],
    };
    render(<WinsBlock vm={notReversible} agentKey="alex" />);
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/undo window closed/i)).not.toBeInTheDocument();
  });

  it("renders the new empty-state copy", () => {
    const empty: WinsViewModel = { ...baseVm, wins: [] };
    render(<WinsBlock vm={empty} agentKey="alex" />);
    expect(screen.getByText(/no recent wins yet/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the next approved action/i)).toBeInTheDocument();
  });
});
