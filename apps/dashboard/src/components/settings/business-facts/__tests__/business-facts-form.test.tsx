import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { emptyBusinessFacts } from "../scaffold";
import { BusinessFactsForm } from "../business-facts-form";

describe("BusinessFactsForm", () => {
  it("blocks submit and shows an error when required fields are empty", async () => {
    const onSubmit = vi.fn();
    render(<BusinessFactsForm defaultValues={emptyBusinessFacts()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /save business facts/i }));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    expect(screen.getAllByText(/required|expected|at least/i).length).toBeGreaterThan(0);
    // Section-level errors: location name/address + service name/description +
    // escalation name/address + businessName = 7 "at least 1 character" errors
    await waitFor(() =>
      expect(screen.getAllByText(/at least 1 character/i).length).toBeGreaterThan(3),
    );
  });

  it("submits serialized facts when required fields are filled", async () => {
    const onSubmit = vi.fn();
    const defaults = {
      ...emptyBusinessFacts(),
      businessName: "Glow",
      locations: [
        { name: "Orchard", address: "391 Orchard Rd", parkingNotes: "", accessNotes: "" },
      ],
      services: [{ name: "Botox", description: "Anti-wrinkle", price: "$18", currency: "SGD" }],
      escalationContact: {
        name: "Front desk",
        channel: "whatsapp" as const,
        address: "+6560000000",
      },
    };
    render(<BusinessFactsForm defaultValues={defaults} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /save business facts/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].businessName).toBe("Glow");
  });

  it("shows the malformed banner when malformed", () => {
    render(<BusinessFactsForm defaultValues={emptyBusinessFacts()} malformed onSubmit={vi.fn()} />);
    expect(screen.getByText(/weren't loaded|re-enter/i)).toBeInTheDocument();
  });
});
