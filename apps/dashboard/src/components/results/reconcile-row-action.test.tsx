import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReconcileRowAction } from "./reconcile-row-action";
import type { ReceiptedBookingWorklistItem } from "@switchboard/schemas";

vi.mock("@/lib/idempotency", () => ({
  createIdempotencyKey: vi.fn(() => "test-idem-key"),
}));

const invalidateQueriesMock = vi.fn<(args: { queryKey: unknown }) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    reports: {
      all: () => ["test-org", "reports"],
    },
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  invalidateQueriesMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRow(
  overrides: Partial<ReceiptedBookingWorklistItem> = {},
): ReceiptedBookingWorklistItem {
  return {
    bookingId: "bk-1",
    service: "Botox consult",
    startsAt: "2026-06-16T02:00:00.000Z",
    attributionConfidence: "unattributed",
    openExceptionCodes: ["missing_source"],
    issuedAt: null,
    overridden: false,
    ...overrides,
  };
}

describe("ReconcileRowAction", () => {
  it("always shows the Fix attribution button (override available even when issuedAt is null)", () => {
    render(<ReconcileRowAction row={makeRow({ issuedAt: null })} />);
    expect(screen.getByRole("button", { name: /fix attribution/i })).toBeTruthy();
  });

  it("hides Flag duplicate and Dismiss when issuedAt is null (no persisted row)", () => {
    render(<ReconcileRowAction row={makeRow({ issuedAt: null })} />);
    expect(screen.queryByRole("button", { name: /flag duplicate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("shows Flag duplicate when issuedAt is set (persisted row exists)", () => {
    render(
      <ReconcileRowAction
        row={makeRow({
          issuedAt: "2026-06-15T10:00:00.000Z",
          openExceptionCodes: ["missing_source"],
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /flag duplicate/i })).toBeTruthy();
  });

  it("submits override_attribution with the selected confidence and reason", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const onReconciled = vi.fn<() => void>();

    render(<ReconcileRowAction row={makeRow()} onReconciled={onReconciled} />);

    // Open the override form
    fireEvent.click(screen.getByRole("button", { name: /fix attribution/i }));

    // Fill in reason
    const reasonInput = screen.getByPlaceholderText(/reason/i);
    fireEvent.change(reasonInput, { target: { value: "owner knows the source" } });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/dashboard/bookings/bk-1/reconcile");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("test-idem-key");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.action).toBe("override_attribution");
    expect(body.reason).toBe("owner knows the source");
    expect(body).not.toHaveProperty("bookingId");

    // Callback and cache invalidation must fire on success
    await waitFor(() => expect(onReconciled).toHaveBeenCalledTimes(1));
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["test-org", "reports"],
    });
  });

  it("does not show a resolve button for missing_consent (PDPA: inline note only)", () => {
    render(
      <ReconcileRowAction
        row={makeRow({
          issuedAt: "2026-06-15T10:00:00.000Z",
          openExceptionCodes: ["missing_consent"],
        })}
      />,
    );
    // The consent code must surface a note, not a "resolve" button and not a link
    expect(screen.queryByRole("button", { name: /resolve/i })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/record consent on the contact/i)).toBeTruthy();
  });
});
