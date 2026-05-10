import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContactDetailProfile } from "@switchboard/schemas";
import { ProfileSection } from "../profile-section";

const baseProfile: ContactDetailProfile = {
  id: "c-1",
  displayName: "Lisa K.",
  primaryChannel: "whatsapp",
  stage: "active",
  phone: "+6591234567",
  email: "lisa@example.com",
  source: "instagram-spring",
  sourceType: "ctwa",
  attributionSummary: 'ad set "spring 2026"',
  messagingConsent: {
    optedIn: true,
    optedInAt: "2026-05-01T12:00:00.000Z",
    source: "ctwa",
    optedOutAt: null,
  },
  firstContactAt: "2026-05-01T12:00:00.000Z",
  lastActivityAt: "2026-05-09T09:00:00.000Z",
};

describe("ProfileSection", () => {
  it("renders the six labeled rows with values", () => {
    render(<ProfileSection profile={baseProfile} />);
    for (const label of [
      "Phone",
      "Email",
      "Source",
      "Messaging",
      "Last activity",
      "First contact",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("+6591234567")).toBeInTheDocument();
    expect(screen.getByText("lisa@example.com")).toBeInTheDocument();
    expect(screen.getByText(/instagram-spring · ad set/)).toBeInTheDocument();
    expect(screen.getByText(/opted in/)).toBeInTheDocument();
  });

  it("renders em-dashes when phone, email, and source are null", () => {
    render(
      <ProfileSection
        profile={{
          ...baseProfile,
          phone: null,
          email: null,
          source: null,
          attributionSummary: null,
          messagingConsent: { optedIn: false, optedInAt: null, source: null, optedOutAt: null },
        }}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("no consent on file")).toBeInTheDocument();
  });
});
