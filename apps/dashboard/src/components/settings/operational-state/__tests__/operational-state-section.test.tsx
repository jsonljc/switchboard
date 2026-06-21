import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const useOperationalState = vi.fn();
const useRecordOperationalState = vi.fn();
vi.mock("@/hooks/use-operational-state", () => ({
  useOperationalState: (...args: unknown[]) => useOperationalState(...args),
  useRecordOperationalState: (...args: unknown[]) => useRecordOperationalState(...args),
  OperationalStateValidationError: class extends Error {},
}));
const toast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast }) }));

import { OperationalStateSection } from "../operational-state-section";

const WIRE_CONFIRMATION = {
  id: "osc_1",
  organizationId: "org-1",
  state: { staffing: "shortfall" as const },
  confirmedBy: "principal-7",
  confirmedAt: "2026-06-04T02:00:00.000Z",
  createdAt: "2026-06-04T02:00:00.000Z",
};

function mount() {
  return render(<OperationalStateSection deploymentId="dep_1" timezone="Asia/Singapore" />);
}

describe("OperationalStateSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordOperationalState.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("gates loading on !data && !error, not isLoading (no false form on a disabled query)", () => {
    useOperationalState.mockReturnValue({ data: undefined, error: null, isLoading: false });
    mount();
    expect(screen.queryByRole("button", { name: /confirm operational state/i })).toBeNull();
  });

  it("renders honest absence for a never-confirmed org: no fabricated defaults, no re-confirm shortcut", () => {
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    expect(screen.getByText(/never confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /everything still accurate/i })).toBeNull();
    // All three enum dimensions start at the "Not confirming" placeholder.
    expect(screen.getAllByText(/not confirming/i).length).toBeGreaterThanOrEqual(3);
    // Nothing confirmed yet, so submit is disabled.
    expect(screen.getByRole("button", { name: /confirm operational state/i })).toBeDisabled();
  });

  it("renders a load failure honestly instead of an empty form", () => {
    const refetch = vi.fn();
    useOperationalState.mockReturnValue({ data: undefined, error: new Error("boom"), refetch });
    mount();
    // StatePanel error: eyebrow + calm title; no raw destructive text
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // eyebrow "Couldn't load" and title both contain "couldn't load" - use getAllByText
    expect(screen.getAllByText(/couldn't load/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/we couldn't load your operational state/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to load operational state/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm operational state/i })).toBeNull();

    // Clicking "Try again" must call refetch
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the freshness line (when + who) for the latest confirmation", () => {
    useOperationalState.mockReturnValue({
      data: { confirmation: WIRE_CONFIRMATION },
      error: null,
    });
    mount();
    // 2026-06-04T02:00Z is 10:00 in Asia/Singapore.
    expect(screen.getByText(/last confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/by principal-7/i)).toBeInTheDocument();
  });

  it("omits the by-clause when confirmedBy is null (no invented identity)", () => {
    useOperationalState.mockReturnValue({
      data: { confirmation: { ...WIRE_CONFIRMATION, confirmedBy: null } },
      error: null,
    });
    mount();
    expect(screen.getByText(/last confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/by principal/i)).toBeNull();
  });

  it("'everything still accurate' re-records the latest state VERBATIM (fresh confirmedAt is server-side)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({
      data: { confirmation: WIRE_CONFIRMATION },
      error: null,
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /everything still accurate/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual(WIRE_CONFIRMATION.state);
  });

  it("confirming 'none active' submits an explicit [] (distinct from absent)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    const submit = screen.getByRole("button", { name: /confirm operational state/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/confirm current promotions/i));
    expect(screen.getByText(/confirming there are none active/i)).toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ promoWindows: [] });
  });

  it("a window with dates submits org-timezone instants (conversion at the edge)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    fireEvent.click(screen.getByLabelText(/confirm current promotions/i));
    fireEvent.click(screen.getByRole("button", { name: /add promotion/i }));
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "june glow" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm operational state/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      promoWindows: [
        { start: "2026-05-31T16:00:00.000Z", end: "2026-06-15T16:00:00.000Z", label: "june glow" },
      ],
    });
  });

  it("a note alone never enables submit (note-only saves impossible at the UI layer)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "all quiet" } });
    expect(screen.getByRole("button", { name: /confirm operational state/i })).toBeDisabled();
    expect(screen.getByText(/note alone is not a confirmation/i)).toBeInTheDocument();
  });

  it("prefills the form from the latest confirmation and submits the operator's restated state", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({
      data: { confirmation: WIRE_CONFIRMATION },
      error: null,
    });
    mount();
    // staffing: "shortfall" is prefilled, so the form already confirms a
    // dimension and submit is enabled without further interaction.
    const submit = screen.getByRole("button", { name: /confirm operational state/i });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ staffing: "shortfall" });
  });

  it("an invalid interval blocks submit with a message", () => {
    useRecordOperationalState.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    fireEvent.click(screen.getByLabelText(/confirm current promotions/i));
    fireEvent.click(screen.getByRole("button", { name: /add promotion/i }));
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-06-01" } });
    expect(screen.getByText(/must not be before the start date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm operational state/i })).toBeDisabled();
  });
});
