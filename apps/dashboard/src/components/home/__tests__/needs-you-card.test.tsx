import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";

// ── Mutable mock state (house pattern) ───────────────────────────────────────

const pushMock = vi.fn();
const toastMock = vi.fn();

let isPendingState = false;
const primaryMock = vi.fn(() => Promise.resolve({}));
const dismissMock = vi.fn(() => Promise.resolve({}));
const undoMock = vi.fn(() => Promise.resolve({}));

vi.mock("@/hooks/use-recommendation-action", () => ({
  useRecommendationAction: () => ({
    primary: primaryMock,
    secondary: vi.fn(() => Promise.resolve({})),
    dismiss: dismissMock,
    confirm: vi.fn(() => Promise.resolve({})),
    undo: undoMock,
    isPending: isPendingState,
    error: null,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

import { NeedsYouCard } from "../needs-you-card";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Yes, send it",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 80,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { contactName: "Maya R." },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NeedsYouCard", () => {
  beforeEach(() => {
    isPendingState = false;
    pushMock.mockClear();
    toastMock.mockClear();
    primaryMock.mockClear();
    dismissMock.mockClear();
    undoMock.mockClear();
  });

  describe("(a) approval decision — primary click → action.primary called + Undo toast shown", () => {
    it("calls action.primary and shows an Undo toast on success", async () => {
      primaryMock.mockResolvedValueOnce({});
      render(<NeedsYouCard decision={makeDecision()} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));

      // Allow the promise to resolve.
      await vi.waitFor(() => {
        expect(primaryMock).toHaveBeenCalledTimes(1);
        expect(toastMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("(b) silent result → NO toast", () => {
    it("does not show a toast when the result has { silent: true }", async () => {
      primaryMock.mockResolvedValueOnce({ silent: true });
      render(<NeedsYouCard decision={makeDecision()} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));

      await vi.waitFor(() => {
        expect(primaryMock).toHaveBeenCalledTimes(1);
      });
      // Toast must NOT have been called.
      expect(toastMock).not.toHaveBeenCalled();
    });
  });

  describe("(c) approval secondary click → action.dismiss called", () => {
    it("calls action.dismiss when the secondary button is clicked", () => {
      render(<NeedsYouCard decision={makeDecision()} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Not yet" }));

      expect(dismissMock).toHaveBeenCalledTimes(1);
      // Primary action must NOT fire on secondary click.
      expect(primaryMock).not.toHaveBeenCalled();
    });
  });

  describe("(d) handoff decision — primary click → router.push(threadHref), mutation NOT called", () => {
    it("navigates to threadHref and does not call the recommendation mutation", () => {
      const handoff = makeDecision({
        kind: "handoff",
        threadHref: "/inbox/thread-abc",
        sourceRef: { kind: "handoff", sourceId: "esc-1" },
      });
      render(<NeedsYouCard decision={handoff} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));

      expect(pushMock).toHaveBeenCalledWith("/inbox/thread-abc");
      expect(primaryMock).not.toHaveBeenCalled();
    });
  });

  describe("(e) handoff with null threadHref → router.push('/inbox')", () => {
    it("navigates to /inbox when threadHref is null", () => {
      const handoff = makeDecision({
        kind: "handoff",
        threadHref: null,
        sourceRef: { kind: "handoff", sourceId: "esc-2" },
      });
      render(<NeedsYouCard decision={handoff} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));

      expect(pushMock).toHaveBeenCalledWith("/inbox");
      expect(primaryMock).not.toHaveBeenCalled();
    });
  });

  describe("(f) rapid double-click while isPending → action fires only once", () => {
    it("ignores a second primary click when isPending is true", () => {
      // The hook returns isPending=true from the start (simulates the mutation
      // already in flight from a first click).
      isPendingState = true;
      render(<NeedsYouCard decision={makeDecision()} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));

      // Neither click should fire through — the guard blocks both.
      expect(primaryMock).not.toHaveBeenCalled();
    });

    it("ignores a second secondary click when isPending is true", () => {
      isPendingState = true;
      render(<NeedsYouCard decision={makeDecision()} index={0} />);

      fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
      fireEvent.click(screen.getByRole("button", { name: "Not yet" }));

      expect(dismissMock).not.toHaveBeenCalled();
    });
  });
});
