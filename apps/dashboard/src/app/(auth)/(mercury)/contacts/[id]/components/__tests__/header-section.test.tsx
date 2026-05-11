import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetailProfile } from "@switchboard/schemas";
import { HeaderSection } from "../header-section";

const NOW_ISO = "2026-05-09T12:00:00.000Z";

const profile: ContactDetailProfile = {
  id: "c-1",
  displayName: "Lisa K.",
  primaryChannel: "whatsapp",
  stage: "active",
  phone: "+6591234567",
  email: "lisa@example.com",
  source: "instagram-spring",
  sourceType: "ctwa",
  attributionSummary: 'ad set "spring 2026"',
  messagingConsent: { optedIn: true, optedInAt: NOW_ISO, source: "ctwa", optedOutAt: null },
  firstContactAt: "2026-05-01T12:00:00.000Z",
  lastActivityAt: "2026-05-09T09:00:00.000Z",
};

describe("HeaderSection", () => {
  it("renders the Contact label and display name", () => {
    render(<HeaderSection profile={profile} />);
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Lisa K." })).toBeInTheDocument();
  });

  it("renders the channel, stage, and last-seen meta cluster", () => {
    render(<HeaderSection profile={profile} />);
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
  });
});
