import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentResultCard } from "../payment-result-card";

describe("PaymentResultCard", () => {
  it("renders the success confirmation copy", () => {
    render(<PaymentResultCard variant="success" />);
    expect(
      screen.getByRole("heading", { name: /thank you for your payment/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/clinic will confirm your appointment/i)).toBeInTheDocument();
  });

  it("renders the cancel copy and reassures no charge was made", () => {
    render(<PaymentResultCard variant="cancel" />);
    expect(screen.getByRole("heading", { name: /payment canceled/i })).toBeInTheDocument();
    expect(screen.getByText(/have not been charged/i)).toBeInTheDocument();
  });

  it("is purely static: a wordmark, no links/buttons, no operator or tenant data", () => {
    const { container } = render(<PaymentResultCard variant="success" />);
    expect(screen.getByText(/^Switchboard$/)).toBeInTheDocument();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
