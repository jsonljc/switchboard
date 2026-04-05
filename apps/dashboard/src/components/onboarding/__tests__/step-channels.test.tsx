import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepChannels } from "../step-channels";
import type { ChannelConfig } from "@/app/(auth)/onboarding/page";

describe("StepChannels", () => {
  const emptyChannels: ChannelConfig = {
    founderChannel: null,
    founderTelegramToken: "",
    founderWhatsAppToken: "",
    founderWhatsAppPhoneNumberId: "",
    customerWhatsAppToken: "",
    customerWhatsAppPhoneNumberId: "",
  };

  it("renders founder channel choice", () => {
    render(<StepChannels channels={emptyChannels} onChannelsChange={vi.fn()} />);
    expect(screen.getByText(/How do you want to hear from your agents/i)).toBeTruthy();
    expect(screen.getByText("Telegram")).toBeTruthy();
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("shows Telegram token input when Telegram selected", () => {
    const channels: ChannelConfig = { ...emptyChannels, founderChannel: "telegram" };
    render(<StepChannels channels={channels} onChannelsChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/bot token/i)).toBeTruthy();
  });

  it("shows WhatsApp fields when WhatsApp selected for founder", () => {
    const channels: ChannelConfig = { ...emptyChannels, founderChannel: "whatsapp" };
    render(<StepChannels channels={channels} onChannelsChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Access Token/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Phone Number ID/i)).toBeTruthy();
  });

  it("shows customer WhatsApp section", () => {
    render(<StepChannels channels={emptyChannels} onChannelsChange={vi.fn()} />);
    expect(screen.getByText(/Customer channel/i)).toBeTruthy();
  });

  it("auto-fills customer WhatsApp when founder picks WhatsApp", () => {
    const onChannelsChange = vi.fn();
    render(<StepChannels channels={emptyChannels} onChannelsChange={onChannelsChange} />);
    // Select WhatsApp as founder channel
    fireEvent.click(screen.getByText("WhatsApp"));
    const call = onChannelsChange.mock.calls[0]![0] as ChannelConfig;
    expect(call.founderChannel).toBe("whatsapp");
  });
});
