import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepReviewLaunch } from "../step-review-launch";
import type { ChannelConfig } from "@/app/(auth)/onboarding/page";

describe("StepReviewLaunch", () => {
  const defaultProps = {
    businessName: "Acme Inc",
    selectedAgents: ["creative"],
    agentTones: {
      creative: "warm-professional",
    },
    channels: {
      founderChannel: "telegram" as const,
      founderTelegramToken: "abc",
      founderWhatsAppToken: "",
      founderWhatsAppPhoneNumberId: "",
      customerWhatsAppToken: "xyz",
      customerWhatsAppPhoneNumberId: "123",
    } satisfies ChannelConfig,
    launchStatus: "idle" as const,
  };

  it("shows business name", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText(/Acme Inc/)).toBeTruthy();
  });

  it("lists all selected agents with tones", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText("AI Creative")).toBeTruthy();
    expect(screen.getByText(/Warm/)).toBeTruthy();
  });

  it("shows channel summary", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText(/Telegram/i)).toBeTruthy();
    expect(screen.getByText(/WhatsApp/i)).toBeTruthy();
  });

  it("shows celebration when launched", () => {
    render(<StepReviewLaunch {...defaultProps} launchStatus="done" />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });
});
