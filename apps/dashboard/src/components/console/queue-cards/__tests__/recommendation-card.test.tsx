import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecommendationCardView } from "../recommendation-card.js";
import type { RecommendationCard } from "../../console-data";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

const baseCard: RecommendationCard = {
  kind: "recommendation",
  id: "r-1",
  agent: "alex",
  action: "Pause Whitening Ad Set B",
  timer: { label: "Immediate", confidence: "0.90" },
  dataLines: [],
  primary: { label: "Pause" },
  secondary: { label: "Reduce 50%" },
  dismiss: { label: "Dismiss" },
};

function renderCard(overrides: Partial<{ resolving: boolean; onResolve: () => void }> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RecommendationCardView
        card={baseCard}
        resolving={overrides.resolving ?? false}
        onResolve={overrides.onResolve ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => fetchMock.mockReset());

describe("RecommendationCardView (backend-wired)", () => {
  it("primary click calls API and onResolve on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/recommendations",
      expect.objectContaining({ body: expect.stringContaining('"action":"primary"') }),
    );
  });

  it("secondary click calls API and onResolve on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Reduce 50%" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
  });

  it("dismiss click calls API and onResolve on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
  });

  it("409 silently calls onResolve (already-resolved)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "already_terminal" }),
    });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it("non-409 error shows .qerror row and does NOT call onResolve", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    });
    const onResolve = vi.fn();
    renderCard({ onResolve });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    expect(onResolve).not.toHaveBeenCalled();
  });
});
