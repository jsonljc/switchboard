// apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard } from "../approval-card.js";
import type { AlexApprovalView } from "../types.js";

const fixture: AlexApprovalView = {
  id: "appr_1",
  kind: "pricing",
  urgency: "this_week",
  askedAt: "4 min ago",
  title: "Send Jordan the founding-member rate?",
  body: "Alex wants to offer $89/mo on a 6-month — your founding rate, normally $119.",
  quote: "I'm honestly in if the price is right.",
  quoteFrom: "Jordan F. · 11:53",
  presentation: { primaryLabel: "Accept & send", dismissLabel: "Decline" },
  primary: "Accept & send",
  secondary: "Decline",
  primaryAction: { kind: "respond", bindingHash: "hash_abc", verdict: "accept" },
};

describe("ApprovalCard", () => {
  it("renders title, body, quote, and the Alex 'needs you' eyebrow", () => {
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />);
    expect(screen.getByText(fixture.title)).toBeInTheDocument();
    expect(screen.getByText(/founding-member rate/i)).toBeInTheDocument();
    expect(screen.getByText(/Jordan F\. · 11:53/)).toBeInTheDocument();
    expect(screen.getByText(/Alex needs you/i)).toBeInTheDocument();
  });

  it("invokes onResolve('accept', 0) when primary button is clicked", () => {
    const handler = vi.fn();
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept & send" }));
    expect(handler).toHaveBeenCalledWith("accept", 0);
  });

  it("invokes onResolve('decline', 0) when secondary button is clicked", () => {
    const handler = vi.fn();
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(handler).toHaveBeenCalledWith("decline", 0);
  });

  it("shows the 'N of M' indicator when there are multiple cards", () => {
    render(<ApprovalCard data={fixture} idx={1} total={3} onResolve={() => {}} />);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("renders without a quote when one isn't provided", () => {
    const noQuote: AlexApprovalView = { ...fixture, quote: undefined, quoteFrom: undefined };
    render(<ApprovalCard data={noQuote} idx={0} total={1} onResolve={() => {}} />);
    expect(screen.queryByText(/Jordan F\./)).not.toBeInTheDocument();
  });
});
