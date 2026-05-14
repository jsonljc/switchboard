import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import WhatsAppPage from "../page";

describe("/whatsapp public page", () => {
  it("renders the canonical hero headline", () => {
    render(<WhatsAppPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/WhatsApp Business/i);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/managed by Alex/i);
  });

  it("names Tech Provider explicitly for Meta reviewers", () => {
    render(<WhatsAppPage />);
    expect(screen.getAllByText(/Tech Provider/i).length).toBeGreaterThan(0);
  });

  it("links to /privacy and /terms from the operator block", () => {
    render(<WhatsAppPage />);
    const privacy = screen.getByRole("link", { name: /privacy/i });
    const terms = screen.getByRole("link", { name: /terms/i });
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(terms).toHaveAttribute("href", "/terms");
  });

  it("exposes Join the waitlist as the single primary CTA pattern", () => {
    render(<WhatsAppPage />);
    const ctas = screen.getAllByText(/Join the waitlist/i);
    expect(ctas.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the operator support email", () => {
    render(<WhatsAppPage />);
    expect(screen.getAllByText(/wa-support@switchboard\.ai/i).length).toBeGreaterThan(0);
  });
});
