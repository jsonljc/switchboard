import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
let enabled: boolean | undefined = false;
type DeskItemLike = { id: string; title: string; updatedAt?: string };
let deskData: {
  readyToReviewCount?: number;
  inProduction?: DeskItemLike[];
  keptDrafts?: DeskItemLike[];
  needsAttention?: DeskItemLike[];
} = { readyToReviewCount: 3 };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/use-mira-enabled", () => ({
  useMiraEnabled: () => ({ enabled, isLoading: false }),
}));
vi.mock("@/hooks/use-mira-desk", () => ({
  useMiraDesk: () => ({ data: deskData }),
}));

import { MiraPanel } from "@/components/agent-panel/mira-panel";

describe("MiraPanel", () => {
  beforeEach(() => {
    deskData = { readyToReviewCount: 3 };
  });

  it("not enabled → honest 'not set up', no dead anchors", () => {
    enabled = false;
    const { container } = render(<MiraPanel />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    expect(container.querySelector('a[href^="#"]')).toBeNull();
  });

  it("enabled → drills into the workspace", () => {
    enabled = true;
    render(<MiraPanel />);
    fireEvent.click(screen.getByRole("button", { name: /open.*workspace|open mira/i }));
    expect(push).toHaveBeenCalledWith("/mira");
  });

  it("renders the printed portrait in the not-set-up branch, never a letter disc", () => {
    // The enabled branch mirrors Alex/Riley: identity lives in the panel header,
    // so the body composition carries no portrait. The not-set-up branch keeps
    // the hero portrait. Neither branch renders the retired "M" letter disc.
    enabled = true;
    const { unmount } = render(<MiraPanel />);
    expect(screen.queryByText("M")).toBeNull();
    unmount();

    enabled = false;
    const { container: c2 } = render(<MiraPanel />);
    expect(c2.querySelector('[data-agent="mira"]')).not.toBeNull();
    expect(screen.queryByText("M")).toBeNull();
  });

  it("shows the live drafts-ready count in the key-result slot when enabled", () => {
    enabled = true;
    render(<MiraPanel />);
    const keyResult = screen.getByTestId("mira-key-result");
    expect(keyResult).toHaveTextContent("3");
    expect(keyResult).toHaveTextContent(/ready to review/i);
    expect(keyResult).toHaveTextContent(/drafts/i);
  });

  it("flags a publish failure that needs attention, even when nothing is waiting (D9-F3)", () => {
    enabled = true;
    deskData = { readyToReviewCount: 0, needsAttention: [{ id: "pf", title: "Botox promo" }] };
    render(<MiraPanel />);
    const decisions = screen.getByTestId("mira-open-decisions");
    expect(decisions).toHaveTextContent("Botox promo");
    expect(decisions).toHaveTextContent(/publish failed/i);
  });

  it("stays calm when nothing needs attention", () => {
    enabled = true;
    deskData = { readyToReviewCount: 2, needsAttention: [] };
    render(<MiraPanel />);
    const decisions = screen.getByTestId("mira-open-decisions");
    // Empty bucket → honest empty line, no decision rows.
    expect(decisions).toHaveTextContent(/nothing waiting on you from mira/i);
    expect(decisions.querySelector("button")).toBeNull();
  });

  describe("four-slot parity (Alex/Riley shape, fed by useMiraDesk)", () => {
    it("renders all four slots populated from the desk read-model when enabled", () => {
      enabled = true;
      deskData = {
        readyToReviewCount: 4,
        inProduction: [
          { id: "p1", title: "Lip filler reel", updatedAt: "2026-06-17T10:00:00.000Z" },
          { id: "p2", title: "Botox promo", updatedAt: "2026-06-17T09:00:00.000Z" },
        ],
        needsAttention: [
          { id: "pf1", title: "Spring promo", updatedAt: "2026-06-17T08:00:00.000Z" },
        ],
        keptDrafts: [{ id: "k1", title: "Glow facial cut", updatedAt: "2026-06-16T12:00:00.000Z" }],
      };
      render(<MiraPanel />);

      // ① KeyResult — readyToReview hero
      const keyResult = screen.getByTestId("mira-key-result");
      expect(keyResult).toHaveTextContent("4");
      expect(keyResult).toHaveTextContent(/ready to review/i);

      // ② IdentityStatus — inFlight (in production) presence
      const identity = screen.getByTestId("mira-identity-status");
      expect(identity).toHaveTextContent(/in production/i);

      // ③ OpenDecisions — failed/attention list
      const decisions = screen.getByTestId("mira-open-decisions");
      expect(decisions).toHaveTextContent("Spring promo");

      // ④ WorkLog — recent (kept) drafts
      const workLog = screen.getByTestId("mira-work-log");
      expect(workLog).toHaveTextContent("Glow facial cut");
    });

    it("each slot renders an honest empty state when its bucket is empty", () => {
      enabled = true;
      deskData = {
        readyToReviewCount: 0,
        inProduction: [],
        needsAttention: [],
        keptDrafts: [],
      };
      render(<MiraPanel />);

      // All four slots still mount (parity scaffold), each with its own empty branch.
      expect(screen.getByTestId("mira-key-result")).toBeInTheDocument();
      expect(screen.getByTestId("mira-identity-status")).toBeInTheDocument();
      expect(screen.getByTestId("mira-open-decisions")).toBeInTheDocument();
      expect(screen.getByTestId("mira-work-log")).toBeInTheDocument();
      // No fabricated attention row when the bucket is empty.
      expect(screen.queryByText(/needs attention/i)).toBeNull();
    });

    it("does not render the parity slots in the not-set-up branch", () => {
      enabled = false;
      render(<MiraPanel />);
      expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
      expect(screen.queryByTestId("mira-key-result")).toBeNull();
      expect(screen.queryByTestId("mira-identity-status")).toBeNull();
      expect(screen.queryByTestId("mira-open-decisions")).toBeNull();
      expect(screen.queryByTestId("mira-work-log")).toBeNull();
    });
  });
});
