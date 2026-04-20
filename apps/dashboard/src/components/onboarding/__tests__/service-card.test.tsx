import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServiceCard } from "../service-card";
import type { PlaybookService } from "@switchboard/schemas";

const mockService: PlaybookService = {
  id: "svc-1",
  name: "Teeth Whitening",
  price: 350,
  duration: 60,
  bookingBehavior: "book_directly",
  details: "Professional whitening",
  status: "ready",
  source: "scan",
};

describe("ServiceCard", () => {
  it("renders service name and price", () => {
    render(<ServiceCard service={mockService} onChange={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByDisplayValue("Teeth Whitening")).toBeTruthy();
    expect(screen.getByText(/\$350/)).toBeTruthy();
  });

  it("shows 'Needs price' when price is missing", () => {
    render(
      <ServiceCard
        service={{ ...mockService, price: undefined }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Needs price")).toBeTruthy();
  });

  it("shows scan tint for scan-sourced services", () => {
    const { container } = render(
      <ServiceCard
        service={{ ...mockService, status: "check_this" }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.style.backgroundColor).toContain("rgba");
  });

  it("shows delete confirmation when delete is clicked", () => {
    render(<ServiceCard service={mockService} onChange={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText("✕"));
    expect(screen.getByText("Remove?")).toBeTruthy();
  });

  it("calls onDelete when confirmed", () => {
    const onDelete = vi.fn();
    render(<ServiceCard service={mockService} onChange={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("✕"));
    fireEvent.click(screen.getByText("Yes"));
    expect(onDelete).toHaveBeenCalledWith("svc-1");
  });
});
