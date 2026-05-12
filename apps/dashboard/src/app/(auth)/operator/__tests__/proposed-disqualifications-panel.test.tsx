// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

// Mock toast hook
const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function makeItem(
  overrides?: Partial<{
    conversationThreadId: string;
    contactId: string;
    currentState: string;
    evidence: unknown;
  }>,
) {
  return {
    conversationThreadId: "thread-uuid-0001",
    contactId: "contact-uuid-0001",
    currentState: "qualified",
    evidence: {
      candidateType: "explicit_opt_out",
      evidenceQuote: "I don't want to proceed",
    },
    ...overrides,
  };
}

describe("ProposedDisqualificationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no items", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { ProposedDisqualificationsPanel } = await import(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore dynamic import with .js
      "../_components/proposed-disqualifications-panel.js"
    );

    render(createElement(ProposedDisqualificationsPanel), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(screen.getByText(/no proposed disqualifications/i)).toBeInTheDocument(),
    );
  });

  it("renders one row per item with signal and evidence", async () => {
    const items = [
      makeItem({ conversationThreadId: "aaa-0001", contactId: "c-001" }),
      makeItem({ conversationThreadId: "bbb-0002", contactId: "c-002" }),
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items }),
    });

    const { ProposedDisqualificationsPanel } = await import(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore dynamic import with .js
      "../_components/proposed-disqualifications-panel.js"
    );

    render(createElement(ProposedDisqualificationsPanel), { wrapper: createWrapper() });

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /confirm/i })).toHaveLength(2),
    );

    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(2);
    expect(screen.getAllByText(/explicit_opt_out/i)).toHaveLength(2);
    expect(screen.getAllByText(/I don't want to proceed/i)).toHaveLength(2);
  });

  it("invalidates query on successful confirm", async () => {
    const item = makeItem();
    // First fetch: load the list
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [item] }),
    });
    // Second fetch: confirm action
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    // Third fetch: re-fetch after invalidation (empty)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { ProposedDisqualificationsPanel } = await import(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore dynamic import with .js
      "../_components/proposed-disqualifications-panel.js"
    );

    render(createElement(ProposedDisqualificationsPanel), { wrapper: createWrapper() });

    const confirmBtn = await screen.findByRole("button", { name: /confirm/i });
    await userEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByText(/no proposed disqualifications/i)).toBeInTheDocument(),
    );

    // Confirm that the mutation POST was made
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/dashboard/lifecycle/disqualifications/thread-uuid-0001/confirm",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
