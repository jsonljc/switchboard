import { describe, it, expect, vi } from "vitest";
import { sendBookingConfirmationEmail } from "../booking-confirmation-email.js";

describe("sendBookingConfirmationEmail", () => {
  it("posts to Resend with correct payload and returns void on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    await sendBookingConfirmationEmail({
      apiKey: "re_test",
      fromAddress: "bookings@example.com",
      to: "lead@example.com",
      attendeeName: "Jane",
      service: "Consultation",
      startsAt: "2026-05-01T10:00:00Z",
      endsAt: "2026-05-01T11:00:00Z",
      bookingId: "bk-1",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer re_test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("bookings@example.com");
    expect(body.to).toBe("lead@example.com");
    expect(body.subject).toContain("Consultation");
    expect(body.html).toContain("2026-05-01");
    expect(body.html).toContain("Jane");
    expect(body.html).toContain("bk-1");
  });

  it("throws on non-2xx response with status in message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal",
    });

    await expect(
      sendBookingConfirmationEmail({
        apiKey: "re_test",
        fromAddress: "bookings@example.com",
        to: "lead@example.com",
        attendeeName: null,
        service: "Consultation",
        startsAt: "2026-05-01T10:00:00Z",
        endsAt: "2026-05-01T11:00:00Z",
        bookingId: "bk-1",
        fetchImpl,
      }),
    ).rejects.toThrow(/Resend.*500/);
  });

  it("handles null attendeeName gracefully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    await sendBookingConfirmationEmail({
      apiKey: "re_test",
      fromAddress: "bookings@example.com",
      to: "lead@example.com",
      attendeeName: null,
      service: "Consultation",
      startsAt: "2026-05-01T10:00:00Z",
      endsAt: "2026-05-01T11:00:00Z",
      bookingId: "bk-1",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
