import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChannelConnectCard } from "../channel-connect-card";

describe("ChannelConnectCard", () => {
  it("renders channel icon for whatsapp", () => {
    render(
      <ChannelConnectCard
        channel="whatsapp"
        label="WhatsApp"
        description="Primary"
        recommended={false}
        isConnected={false}
        comingSoon={false}
        onConnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("channel-icon-whatsapp")).toBeTruthy();
  });

  it("renders channel icon for telegram", () => {
    render(
      <ChannelConnectCard
        channel="telegram"
        label="Telegram"
        description="Alt"
        recommended={false}
        isConnected={false}
        comingSoon={false}
        onConnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("channel-icon-telegram")).toBeTruthy();
  });

  it("renders channel icon for webchat", () => {
    render(
      <ChannelConnectCard
        channel="webchat"
        label="Web Chat"
        description="Website"
        recommended={false}
        isConnected={false}
        comingSoon={true}
        onConnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("channel-icon-webchat")).toBeTruthy();
  });
});
