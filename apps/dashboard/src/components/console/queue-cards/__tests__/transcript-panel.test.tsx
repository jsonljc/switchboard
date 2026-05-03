import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TranscriptPanel } from "../transcript-panel";

vi.mock("@/hooks/use-escalations");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("TranscriptPanel", () => {
  it("shows loading skeleton while fetching", async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    expect(container.querySelector(".transcript-loading")).not.toBeNull();
  });

  it("renders the last 5 messages, oldest-to-newest", async () => {
    const mod = await import("@/hooks/use-escalations");
    const history = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "lead" : "agent",
      text: `msg ${i + 1}`,
      timestamp: `2026-05-03T10:0${i}:00Z`,
    }));
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: history },
      isLoading: false,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    const rows = container.querySelectorAll(".transcript-row");
    expect(rows.length).toBe(5);
    expect(rows[0].textContent).toContain("msg 4");
    expect(rows[4].textContent).toContain("msg 8");
  });

  it("shows an error fallback when the fetch errors", async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    expect(container.querySelector(".transcript-error")).not.toBeNull();
  });

  it("does NOT render an Open full conversation link (no /conversations/[id] route exists)", async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: [{ role: "lead", text: "hi", timestamp: "t" }] },
      isLoading: false,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    expect(container.querySelector("a[href^='/conversations/']")).toBeNull();
  });

  it("shows an empty-state message when conversationHistory is empty", async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: [] },
      isLoading: false,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    expect(container.querySelector(".transcript-empty")).not.toBeNull();
  });
});
