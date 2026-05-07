import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const searchParamsRef = { current: new URLSearchParams() };
const routerReplaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  useRouter: () => ({ replace: routerReplaceMock }),
}));

import { ConnectCapiStep, ImproveSpendSetup } from "./improve-spend-setup";

describe("ConnectCapiStep", () => {
  function renderStep(overrides: Partial<React.ComponentProps<typeof ConnectCapiStep>> = {}) {
    const props: React.ComponentProps<typeof ConnectCapiStep> = {
      pixelId: "",
      loading: false,
      error: null,
      onPixelIdChange: vi.fn(),
      onSave: vi.fn(),
      ...overrides,
    };
    render(<ConnectCapiStep {...props} />);
    return props;
  }

  it("renders the step title and explainer copy", () => {
    renderStep();
    expect(
      screen.getByRole("heading", { name: /connect.*conversions api|connect.*pixel/i }),
    ).toBeInTheDocument();
    // Label + helper copy both mention pixel id, so use the labelled input.
    expect(screen.getByLabelText(/pixel id/i)).toBeInTheDocument();
    expect(screen.getAllByText(/signal[- ]?health|conversion/i).length).toBeGreaterThan(0);
  });

  it("disables the save button when pixel id is empty", () => {
    renderStep({ pixelId: "" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    expect(button).toBeDisabled();
  });

  it("disables the save button while loading", () => {
    renderStep({ pixelId: "1234567890", loading: true });
    const button = screen.getByRole("button", { name: /save|continue|enable|saving/i });
    expect(button).toBeDisabled();
  });

  it("disables the save button when pixel id is non-numeric", () => {
    // Meta pixel ids are numeric strings; reject obvious bad input early.
    renderStep({ pixelId: "abc" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    expect(button).toBeDisabled();
  });

  it("enables the save button when a valid-looking pixel id is entered", () => {
    renderStep({ pixelId: "1234567890123456" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    expect(button).not.toBeDisabled();
  });

  it("calls onPixelIdChange when the input value changes", () => {
    const props = renderStep({ pixelId: "" });
    const input = screen.getByLabelText(/pixel id/i);
    fireEvent.change(input, { target: { value: "9999999999" } });
    expect(props.onPixelIdChange).toHaveBeenCalledWith("9999999999");
  });

  it("calls onSave when the save button is clicked", () => {
    const props = renderStep({ pixelId: "1234567890123456" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    fireEvent.click(button);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when one is provided", () => {
    renderStep({ pixelId: "1234567890", error: "Could not save pixel id" });
    expect(screen.getByText(/could not save pixel id/i)).toBeInTheDocument();
  });

  it("does not allow skipping — there is no skip button", () => {
    renderStep({ pixelId: "" });
    // The whole point: pixel id is mandatory for this agent. No bypass.
    expect(screen.queryByRole("button", { name: /skip|later|maybe/i })).toBeNull();
  });
});

// ── Wizard-level integration tests ──
//
// The leaf-component tests above prove ConnectCapiStep renders + dispatches
// the right callbacks. These tests prove the gating contract: the wizard
// actually advances to connect-capi after select-account, won't call
// onComplete until pixel id is saved, and routes the URL on transitions.

describe("ImproveSpendSetup wizard", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let onComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerReplaceMock.mockClear();
    onComplete = vi.fn();
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    // Land the wizard on select-account directly — same shape as the
    // OAuth callback round-trip URL.
    searchParamsRef.current = new URLSearchParams({
      step: "select-account",
      connected: "true",
      deploymentId: "dep-1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, ok = true) {
    return { ok, json: () => Promise.resolve(body) } as unknown as Response;
  }

  it("advances from select-account → connect-capi after the ad-account PUT succeeds", async () => {
    fetchSpy
      // initial GET /ad-account
      .mockResolvedValueOnce(
        jsonResponse({ accounts: [{ accountId: "123", name: "A", currency: "USD", status: 1 }] }),
      )
      // PUT /ad-account
      .mockResolvedValueOnce(jsonResponse({}));

    render(
      <ImproveSpendSetup
        initialStep="select-account"
        onComplete={onComplete}
        deploymentId="dep-1"
      />,
    );

    // Wait for accounts to render, click the only one, then confirm.
    const accountButton = await screen.findByRole("button", { name: /act_123/i });
    fireEvent.click(accountButton);
    fireEvent.click(screen.getByRole("button", { name: /confirm selection/i }));

    // The wizard should advance to connect-capi (not call onComplete yet).
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /connect.*conversions api/i }),
      ).toBeInTheDocument();
    });
    expect(onComplete).not.toHaveBeenCalled();
    // URL should be replaced with the new step so a reload sticks.
    expect(routerReplaceMock).toHaveBeenCalled();
    const lastReplace = routerReplaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastReplace).toContain("step=connect-capi");
    expect(lastReplace).toContain("deploymentId=dep-1");
  });

  it("does not call onComplete until pixel id is saved", async () => {
    // Start directly on connect-capi (skip the select-account leg).
    searchParamsRef.current = new URLSearchParams({
      step: "connect-capi",
      deploymentId: "dep-1",
    });
    // Hide the implicit accounts fetch — connect-capi doesn't trigger it.
    fetchSpy.mockResolvedValue(jsonResponse({}));

    render(
      <ImproveSpendSetup initialStep="connect-capi" onComplete={onComplete} deploymentId="dep-1" />,
    );

    const input = screen.getByLabelText(/pixel id/i);
    fireEvent.change(input, { target: { value: "1234567890123456" } });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    // Verify the PUT hit the right endpoint with the right body.
    const pixelPut = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/pixel-id"),
    );
    expect(pixelPut).toBeDefined();
    const init = pixelPut![1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ pixelId: "1234567890123456" });
  });

  it("does not call onComplete when the pixel id PUT fails", async () => {
    searchParamsRef.current = new URLSearchParams({
      step: "connect-capi",
      deploymentId: "dep-1",
    });
    fetchSpy.mockResolvedValue(jsonResponse({ error: "Bad pixel" }, false));

    render(
      <ImproveSpendSetup initialStep="connect-capi" onComplete={onComplete} deploymentId="dep-1" />,
    );

    fireEvent.change(screen.getByLabelText(/pixel id/i), {
      target: { value: "1234567890123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/bad pixel/i)).toBeInTheDocument();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
