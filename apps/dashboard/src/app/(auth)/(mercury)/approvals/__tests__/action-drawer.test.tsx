import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionDrawer } from "../components/detail/action-drawer";
import { APPROVALS_FIXTURES } from "../fixtures";

const lowRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_55ab10")!; // low risk
const criticalRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_2f1a08")!;
const recoveryRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_e0c4a5")!;

const baseHandlers = { onApprove: vi.fn(), onReject: vi.fn() };

beforeEach(() => {
  baseHandlers.onApprove.mockReset();
  baseHandlers.onReject.mockReset();
});

describe("ActionDrawer", () => {
  it("renders approve + reject for a low-risk pending row", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} principalId="p-1" {...baseHandlers} />);
    expect(screen.getByRole("button", { name: /^approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("low-risk approve does not require checkbox", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} principalId="p-1" {...baseHandlers} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("critical-risk approve requires checkbox tick", () => {
    render(<ActionDrawer row={criticalRow} now={Date.now()} principalId="p-1" {...baseHandlers} />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("expired row shows read-only operator copy", () => {
    const expired = { ...lowRow, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    render(<ActionDrawer row={expired} now={Date.now()} principalId="p-1" {...baseHandlers} />);
    expect(screen.getByText(/this expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("recovery row shows operator-language copy and Dismiss only", () => {
    render(<ActionDrawer row={recoveryRow} now={Date.now()} principalId="p-1" {...baseHandlers} />);
    expect(screen.getByText(/couldn't be prepared/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("missing principalId blocks all actions and shows sign-in notice", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} principalId={null} {...baseHandlers} />);
    expect(screen.getByText(/sign in again/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("renders dispatch banner after a successful approve", () => {
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        decision={{ kind: "approved" }}
        {...baseHandlers}
      />,
    );
    expect(screen.getByText(/processing this now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("renders 409 conflict copy", () => {
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        error={{ status: 409 }}
        {...baseHandlers}
      />,
    );
    expect(screen.getByText(/already decided by a teammate/i)).toBeInTheDocument();
  });

  it("renders 5xx copy", () => {
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        error={{ status: 500 }}
        {...baseHandlers}
      />,
    );
    expect(screen.getByText(/couldn't send your approval/i)).toBeInTheDocument();
  });

  it("dismiss on a recovery row calls onReject", () => {
    const onReject = vi.fn();
    render(
      <ActionDrawer
        row={recoveryRow}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    dismiss.click();
    expect(onReject).toHaveBeenCalled();
  });
});

describe("ActionDrawer — advanced JSON toggle", () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Default to desktop width for these tests.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  });

  it("hides the JSON toggle on mobile widths even when sessionStorage says open", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    sessionStorage.setItem("approvals.advancedJsonOpen", "true");
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /view json/i })).not.toBeInTheDocument();
  });

  it("renders the JSON toggle on desktop widths when onPatch is provided", () => {
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /view json/i })).toBeInTheDocument();
  });

  it("opening the toggle reveals the patch editor", () => {
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view json/i }));
    // The patch editor renders a textarea
    expect(screen.getByRole("textbox", { name: /patch JSON editor/i })).toBeInTheDocument();
  });

  it("persists open state to sessionStorage", () => {
    render(
      <ActionDrawer
        row={lowRow}
        now={Date.now()}
        principalId="p-1"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view json/i }));
    expect(sessionStorage.getItem("approvals.advancedJsonOpen")).toBe("true");
  });
});
