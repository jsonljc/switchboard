import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingEntry } from "../onboarding-entry";

describe("OnboardingEntry", () => {
  it("renders the headline and URL input", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText("Let Alex learn your business")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://yourwebsite.com")).toBeTruthy();
  });

  it("disables CTA when input is empty", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    const button = screen.getByRole("button", { name: /start scanning/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables CTA when URL is entered", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://yourwebsite.com");
    fireEvent.change(input, { target: { value: "https://example.com" } });
    const button = screen.getByRole("button", { name: /start scanning/i });
    expect(button).toHaveProperty("disabled", false);
  });

  it("calls onScan with URL when submitted", () => {
    const onScan = vi.fn();
    render(<OnboardingEntry onScan={onScan} onSkip={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://yourwebsite.com");
    fireEvent.change(input, { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /start scanning/i }));
    expect(onScan).toHaveBeenCalledWith("https://example.com");
  });

  it("shows category selector when skip is clicked", () => {
    render(<OnboardingEntry onScan={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText(/no website/i));
    expect(screen.getByText("Dental")).toBeTruthy();
    expect(screen.getByText("Salon")).toBeTruthy();
  });

  it("calls onSkip with category when selected", () => {
    const onSkip = vi.fn();
    render(<OnboardingEntry onScan={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByText(/no website/i));
    fireEvent.click(screen.getByText("Dental"));
    expect(onSkip).toHaveBeenCalledWith("dental");
  });
});
