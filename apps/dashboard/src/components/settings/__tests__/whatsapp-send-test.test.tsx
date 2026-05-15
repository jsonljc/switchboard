import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  WhatsAppSendTest,
  type SendTestPhoneNumber,
  type SendTestTemplate,
} from "../whatsapp-send-test";

const useSendWhatsAppTestMock = vi.fn();
vi.mock("@/hooks/use-whatsapp-send-test", () => ({
  useSendWhatsAppTest: () => useSendWhatsAppTestMock(),
}));

const phone: SendTestPhoneNumber = {
  id: "phone_1",
  displayPhoneNumber: "+15551234567",
  verifiedName: "Test Business",
  status: "active",
};

const approvedTemplate: SendTestTemplate = {
  name: "hello_world",
  status: "APPROVED",
  language: "en_US",
};

describe("WhatsAppSendTest", () => {
  beforeEach(() => {
    useSendWhatsAppTestMock.mockReset();
    useSendWhatsAppTestMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        messageId: "wamid.HBgL",
        status: "sent",
        sentAt: "2026-05-15T13:00:00Z",
      }),
      isPending: false,
      data: undefined,
    });
  });

  it("renders heading and submit button", () => {
    render(
      <WhatsAppSendTest
        phoneNumbers={[phone]}
        templates={[approvedTemplate]}
        allowedRecipients={["+15559999999"]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Send test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test" })).toBeInTheDocument();
  });

  it("disables submit when there are no APPROVED templates", () => {
    const pendingTemplate: SendTestTemplate = {
      name: "pending_template",
      status: "PENDING",
      language: "en_US",
    };
    render(
      <WhatsAppSendTest
        phoneNumbers={[phone]}
        templates={[pendingTemplate]}
        allowedRecipients={["+15559999999"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
  });

  it("disables submit and shows hint when allowedRecipients is empty", () => {
    render(
      <WhatsAppSendTest
        phoneNumbers={[phone]}
        templates={[approvedTemplate]}
        allowedRecipients={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
    expect(screen.getByText(/Add a test recipient to this channel/i)).toBeInTheDocument();
  });

  it("renders success pane with messageId after a successful send", () => {
    useSendWhatsAppTestMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        messageId: "wamid.SUCCESS",
        status: "sent",
        sentAt: "2026-05-15T13:00:00Z",
      }),
      isPending: false,
      data: {
        messageId: "wamid.SUCCESS",
        status: "sent",
        sentAt: "2026-05-15T13:00:00Z",
      },
    });

    render(
      <WhatsAppSendTest
        phoneNumbers={[phone]}
        templates={[approvedTemplate]}
        allowedRecipients={["+15559999999"]}
      />,
    );

    expect(screen.getByText("Accepted by WhatsApp.")).toBeInTheDocument();
    expect(screen.getByText(/wamid\.SUCCESS/)).toBeInTheDocument();
  });

  it("renders error pane after a failed send", async () => {
    useSendWhatsAppTestMock.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("Template not APPROVED")),
      isPending: false,
      data: undefined,
    });

    render(
      <WhatsAppSendTest
        phoneNumbers={[phone]}
        templates={[approvedTemplate]}
        allowedRecipients={["+15559999999"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send test" }));

    await waitFor(() => {
      expect(screen.getByText("Template not APPROVED")).toBeInTheDocument();
    });
  });
});
