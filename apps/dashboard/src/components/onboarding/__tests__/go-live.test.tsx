import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoLive } from "../go-live";
import { createEmptyPlaybook } from "@switchboard/schemas";

describe("GoLive", () => {
  it("renders page title and checklist", () => {
    const playbook = createEmptyPlaybook();
    playbook.businessIdentity.status = "ready";
    render(
      <GoLive
        playbook={playbook}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={[]}
        scenariosTested={0}
      />,
    );
    expect(screen.getByText("Alex is ready for your business")).toBeTruthy();
    expect(screen.getByText(/required to launch/i)).toBeTruthy();
  });

  it("disables launch button when no channel connected", () => {
    render(
      <GoLive
        playbook={createEmptyPlaybook()}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={[]}
        scenariosTested={0}
      />,
    );
    const button = screen.getByRole("button", { name: /launch alex/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables launch button when a channel is connected", () => {
    render(
      <GoLive
        playbook={createEmptyPlaybook()}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={["whatsapp"]}
        scenariosTested={3}
      />,
    );
    const button = screen.getByRole("button", { name: /launch alex/i });
    expect(button).toHaveProperty("disabled", false);
  });
});
