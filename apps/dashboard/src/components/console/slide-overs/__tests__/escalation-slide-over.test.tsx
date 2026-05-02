import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EscalationSlideOver } from "../escalation-slide-over";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { principalId: "p-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("EscalationSlideOver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Reply textarea and Send button when open", () => {
    render(<EscalationSlideOver escalationId="e-1" open onOpenChange={() => {}} />, { wrapper });
    expect(screen.getByRole("textbox", { name: /reply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send reply/i })).toBeInTheDocument();
  });

  it("renders an 'Open full conversation' deep-link to /conversations/[id]", () => {
    render(<EscalationSlideOver escalationId="e-1" open onOpenChange={() => {}} />, { wrapper });
    const link = screen.getByRole("link", { name: /full conversation/i });
    expect(link).toHaveAttribute("href", "/conversations/e-1");
  });

  it("posts reply on Send and closes on 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        escalation: { id: "e-1", status: "released" },
        replySent: true,
      }),
    });
    const onOpenChange = vi.fn();
    render(<EscalationSlideOver escalationId="e-1" open onOpenChange={onOpenChange} />, {
      wrapper,
    });
    const textarea = screen.getByRole("textbox", { name: /reply/i }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "thanks for reaching out" } });
    fireEvent.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/escalations/e-1/reply",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"message":"thanks for reaching out"'),
        }),
      );
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("preserves textarea and shows error on 502 delivery failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        escalation: { id: "e-1", status: "released" },
        replySent: false,
        error: "delivery failed",
      }),
    });
    const onOpenChange = vi.fn();
    render(<EscalationSlideOver escalationId="e-1" open onOpenChange={onOpenChange} />, {
      wrapper,
    });
    const textarea = screen.getByRole("textbox", { name: /reply/i }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "thanks for reaching out" } });
    fireEvent.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/delivery failed/i);
    });
    expect(textarea.value).toBe("thanks for reaching out");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
