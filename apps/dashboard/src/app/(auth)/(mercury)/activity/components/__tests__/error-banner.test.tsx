import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBanner } from "../error-banner.js";

describe("ErrorBanner", () => {
  it("renders eyebrow + italic display-serif message with full telemetry when all fields are known", () => {
    render(
      <ErrorBanner
        method="GET"
        path="/api/dashboard/activity"
        status={503}
        durationMs={8000}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/request failed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/GET \/api\/dashboard\/activity returned 503 after 8s/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/previous page of entries is still shown below; nothing was dropped/),
    ).toBeInTheDocument();
  });

  it("degrades to minimal copy when only the path is known (no fabricated telemetry)", () => {
    render(<ErrorBanner path="/api/dashboard/activity" onRetry={() => {}} />);
    expect(screen.getByText(/Request to \/api\/dashboard\/activity failed\./)).toBeInTheDocument();
    expect(screen.queryByText(/503/)).toBeNull();
    expect(screen.queryByText(/after \d+s/)).toBeNull();
    expect(
      screen.getByText(/previous page of entries is still shown below; nothing was dropped/),
    ).toBeInTheDocument();
  });

  it("retry button fires onRetry on click", async () => {
    const onRetry = vi.fn();
    render(<ErrorBanner path="/api/dashboard/activity" onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has role='alert' so AT users get the failure announcement", () => {
    render(<ErrorBanner path="/api/dashboard/activity" onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("includes partial telemetry only when complete (method+status+durationMs all present) — otherwise minimal copy", () => {
    render(
      <ErrorBanner method="GET" status={503} path="/api/dashboard/activity" onRetry={() => {}} />,
    );
    expect(screen.getByText(/Request to \/api\/dashboard\/activity failed\./)).toBeInTheDocument();
    expect(screen.queryByText(/returned 503/)).toBeNull();
  });
});
