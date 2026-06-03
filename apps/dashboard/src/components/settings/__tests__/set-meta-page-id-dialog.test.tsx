import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";
import { SetMetaPageIdDialog } from "../set-meta-page-id-dialog";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
const toast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast }) }));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

describe("SetMetaPageIdDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Save until a numeric page id is entered", () => {
    wrap(<SetMetaPageIdDialog connectionId="conn_1" onClose={vi.fn()} />);
    const save = screen.getByRole("button", { name: /save page/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/facebook page id/i), { target: { value: "abc" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/facebook page id/i), {
      target: { value: "123456789012345" },
    });
    expect(save).toBeEnabled();
  });

  it("submits the page id, toasts success, and closes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ connection: { id: "conn_1", updated: true } }),
    });
    const onClose = vi.fn();
    wrap(<SetMetaPageIdDialog connectionId="conn_1" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/facebook page id/i), {
      target: { value: "123456789012345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save page/i }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/connections/conn_1/meta-page-id",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/saved/i) }),
    );
  });

  it("does not render its content when connectionId is null", () => {
    wrap(<SetMetaPageIdDialog connectionId={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /save page/i })).toBeNull();
  });
});
