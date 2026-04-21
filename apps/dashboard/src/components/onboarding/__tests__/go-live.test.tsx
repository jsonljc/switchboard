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

  it("includes hours in playbook summary", () => {
    const playbook = {
      ...createEmptyPlaybook(),
      services: [
        {
          id: "s1",
          name: "Cleaning",
          bookingBehavior: "ask_first" as const,
          status: "ready" as const,
          source: "scan" as const,
        },
        {
          id: "s2",
          name: "Whitening",
          bookingBehavior: "ask_first" as const,
          status: "ready" as const,
          source: "scan" as const,
        },
      ],
      hours: {
        timezone: "",
        schedule: {
          mon: "09:00-18:00",
          tue: "09:00-18:00",
          wed: "09:00-18:00",
          thu: "09:00-18:00",
          fri: "09:00-18:00",
          sat: "10:00-14:00",
        },
        afterHoursBehavior: "",
        status: "ready" as const,
        source: "scan" as const,
      },
      approvalMode: {
        bookingApproval: "ask_before_booking" as const,
        status: "ready" as const,
        source: "manual" as const,
      },
    };
    render(
      <GoLive
        playbook={playbook}
        onLaunch={vi.fn()}
        onBack={vi.fn()}
        connectedChannels={["whatsapp"]}
        scenariosTested={3}
      />,
    );
    expect(screen.getByText(/Mon-Sat/i)).toBeTruthy();
    expect(screen.getByText(/9am/i)).toBeTruthy();
  });
});
