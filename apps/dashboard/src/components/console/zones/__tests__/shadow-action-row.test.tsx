import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShadowActionList } from "../shadow-action-row.js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

function renderList() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ShadowActionList />
    </QueryClientProvider>,
  );
}

beforeEach(() => fetchMock.mockReset());

describe("ShadowActionList", () => {
  it("renders nothing when there are zero rows", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations: [] }),
    });
    const { container } = renderList();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector(".shadow-actions")).toBeNull();
  });

  it("renders one row per shadow recommendation", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          recommendations: [
            {
              id: "s-1",
              humanSummary: "Nova flagged for auto-pause — confirm or undo: Whitening Ad Set B",
              undoableUntil: new Date(Date.now() + 3600_000).toISOString(),
            },
            {
              id: "s-2",
              humanSummary: "Nova flagged for auto-reduce: Recovery Set",
              undoableUntil: new Date(Date.now() + 3600_000).toISOString(),
            },
          ],
        }),
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/Whitening Ad Set B/)).toBeInTheDocument());
    expect(screen.getByText(/Recovery Set/)).toBeInTheDocument();
  });

  it("Confirm button calls action.confirm", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          recommendations: [
            {
              id: "s-1",
              humanSummary: "x",
              undoableUntil: new Date(Date.now() + 3600_000).toISOString(),
            },
          ],
        }),
    });
    // The mutation POST is call[1]. onSuccess invalidates the shadow-actions query,
    // which triggers a refetch (call[2]); provide a mock so it resolves cleanly.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations: [] }),
    });
    renderList();
    await waitFor(() => screen.getByRole("button", { name: /confirm/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"action":"confirm"');
  });

  it("Undo button calls action.undo", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          recommendations: [
            {
              id: "s-1",
              humanSummary: "x",
              undoableUntil: new Date(Date.now() + 3600_000).toISOString(),
            },
          ],
        }),
    });
    // The mutation POST is call[1]. onSuccess invalidates the shadow-actions query,
    // which triggers a refetch (call[2]); provide a mock so it resolves cleanly.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations: [] }),
    });
    renderList();
    await waitFor(() => screen.getByRole("button", { name: /undo/i }));
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"action":"undo"');
  });

  it("hides Confirm/Undo buttons after undoableUntil expires", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          recommendations: [
            {
              id: "s-1",
              humanSummary: "x",
              undoableUntil: new Date(Date.now() - 1000).toISOString(),
            },
          ],
        }),
    });
    renderList();
    await waitFor(() => screen.getByText("x"));
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});
