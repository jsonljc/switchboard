import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalsQueue } from "../components/queue";
import { APPROVALS_FIXTURES } from "../fixtures";
import { formatRemaining } from "../format";

// The queue is fed PendingRow data, not DetailRow. Strip the rich fields
// so the test matches the runtime contract (amendment C).
const PENDING_FIXTURES = APPROVALS_FIXTURES.map((r) => ({
  id: r.id,
  summary: r.summary,
  riskCategory: r.riskCategory,
  status: r.status,
  envelopeId: r.envelopeId,
  expiresAt: r.expiresAt,
  bindingHash: r.bindingHash,
  createdAt: r.createdAt,
}));

describe("ApprovalsQueue", () => {
  it("renders one row per approval (scoped by accessible label)", () => {
    render(<ApprovalsQueue items={PENDING_FIXTURES} activeId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^Open approval:/ })).toHaveLength(
      PENDING_FIXTURES.length,
    );
  });

  it("renders the summary text", () => {
    render(
      <ApprovalsQueue items={PENDING_FIXTURES.slice(0, 1)} activeId={null} onSelect={() => {}} />,
    );
    expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument();
  });

  it("does not render an agent label in queue rows (agent moves to detail)", () => {
    render(
      <ApprovalsQueue items={PENDING_FIXTURES.slice(0, 1)} activeId={null} onSelect={() => {}} />,
    );
    // The pending wire shape does not include `agent`; queue rows don't display it.
    expect(screen.queryByText(/Alex/)).not.toBeInTheDocument();
    expect(screen.queryByText(/billing-agent/)).not.toBeInTheDocument();
  });

  it("calls onSelect with the row id on click", () => {
    const onSelect = vi.fn();
    render(
      <ApprovalsQueue items={PENDING_FIXTURES.slice(0, 2)} activeId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Refund SGD 4,820/ }));
    expect(onSelect).toHaveBeenCalledWith("apr_2f1a08");
  });

  it("renders skeleton when loading", () => {
    render(<ApprovalsQueue items={[]} activeId={null} onSelect={() => {}} loading />);
    expect(screen.getAllByTestId("queue-skeleton-row")).toHaveLength(6);
  });

  it("renders empty state when not loading and no items", () => {
    render(<ApprovalsQueue items={[]} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it("renders no risk pips (deliberate omission from locked design)", () => {
    render(<ApprovalsQueue items={PENDING_FIXTURES} activeId={null} onSelect={() => {}} />);
    expect(document.querySelectorAll('[data-testid="risk-pip"]')).toHaveLength(0);
  });

  it("contains no engineering vocabulary in visible text", () => {
    render(<ApprovalsQueue items={PENDING_FIXTURES} activeId={null} onSelect={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/binding|envelope|lifecycle|dispatch|cartridge/i);
  });
});

describe("ApprovalsQueue live timer", () => {
  it("renders the time-remaining for each row when `now` is passed", () => {
    const now = Date.now();
    const item = { ...PENDING_FIXTURES[0], expiresAt: new Date(now + 90_000).toISOString() };
    render(<ApprovalsQueue items={[item]} activeId={null} onSelect={() => {}} now={now} />);
    expect(screen.getByText(formatRemaining(90_000))).toBeInTheDocument();
  });

  it("applies critical class when remaining < 5 minutes", () => {
    const now = Date.now();
    const item = { ...PENDING_FIXTURES[0], expiresAt: new Date(now + 60_000).toISOString() };
    render(<ApprovalsQueue items={[item]} activeId={null} onSelect={() => {}} now={now} />);
    const timer = screen.getByTestId("queue-row-timer");
    expect(timer.className).toMatch(/critical/);
  });
});
