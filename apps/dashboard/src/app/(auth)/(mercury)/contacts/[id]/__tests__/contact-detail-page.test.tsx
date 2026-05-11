import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContactDetailPage } from "../contact-detail-page";

vi.mock("../hooks/use-contact-detail");
vi.mock("../../components/header", () => ({ ContactsHeader: () => <div data-testid="header" /> }));

import { useContactDetail } from "../hooks/use-contact-detail";

const happyPayload = {
  profile: {
    id: "c-1",
    displayName: "Maya Rahman",
    primaryChannel: "whatsapp" as const,
    stage: "active" as const,
    phone: "+6591234567",
    email: null,
    source: "ctwa",
    sourceType: "ctwa",
    attributionSummary: null,
    messagingConsent: { optedIn: true, optedInAt: null, source: null, optedOutAt: null },
    firstContactAt: "2026-04-27T00:00:00.000Z",
    lastActivityAt: "2026-05-09T00:00:00.000Z",
  },
  opportunities: [],
  threads: [],
  openDecisions: [],
  revenueEvents: [],
};

beforeEach(() => vi.resetAllMocks());

describe("ContactDetailPage", () => {
  it("renders skeleton when loading", () => {
    (useContactDetail as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    });
    render(<ContactDetailPage contactId="c-1" />);
    expect(screen.getByLabelText(/loading contact/i)).toBeInTheDocument();
  });

  it("renders error state with Try again on error", () => {
    const refetch = vi.fn();
    (useContactDetail as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("HTTP 500"),
      refetch,
    });
    render(<ContactDetailPage contactId="c-1" />);
    expect(screen.getByText(/couldn't load contact/i)).toBeInTheDocument();
    screen.getByRole("button", { name: /try again/i }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders all six sections on happy path", () => {
    (useContactDetail as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isError: false,
      data: happyPayload,
      error: null,
      refetch: vi.fn(),
    });
    render(<ContactDetailPage contactId="c-1" />);
    expect(screen.getByText("Maya Rahman")).toBeInTheDocument();
    // Section labels
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Opportunities")).toBeInTheDocument();
    expect(screen.getByText(/Conversation threads/)).toBeInTheDocument();
    expect(screen.getByText("Open decisions")).toBeInTheDocument();
    expect(screen.getByText("Revenue events")).toBeInTheDocument();
  });
});
