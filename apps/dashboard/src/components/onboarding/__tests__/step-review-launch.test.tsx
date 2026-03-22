import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepReviewLaunch } from "../step-review-launch";
import type { ChannelConfig } from "@/app/onboarding/page";

describe("StepReviewLaunch", () => {
  const defaultProps = {
    businessName: "Radiance Spa",
    selectedAgents: ["lead-responder", "sales-closer"],
    agentTones: {
      "lead-responder": "warm-professional",
      "sales-closer": "direct-efficient",
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
    expect(screen.getByText(/Radiance Spa/)).toBeTruthy();
  });

  it("lists all selected agents with tones", () => {
    render(<StepReviewLaunch {...defaultProps} />);
    expect(screen.getByText("Lead Responder")).toBeTruthy();
    expect(screen.getByText("Sales Closer")).toBeTruthy();
    expect(screen.getByText(/Warm/)).toBeTruthy();
    expect(screen.getByText(/Direct/)).toBeTruthy();
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
