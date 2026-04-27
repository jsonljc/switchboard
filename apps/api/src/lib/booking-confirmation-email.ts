export interface BookingConfirmationEmailArgs {
  apiKey: string;
  fromAddress: string;
  to: string;
  attendeeName: string | null;
  service: string;
  startsAt: string;
  endsAt: string;
  bookingId: string;
  fetchImpl?: typeof fetch;
}

export async function sendBookingConfirmationEmail(
  args: BookingConfirmationEmailArgs,
): Promise<void> {
  const fetchFn = args.fetchImpl ?? fetch;
  const greeting = args.attendeeName ? `Hi ${args.attendeeName},` : "Hi,";
  const html = [
    `<p>${greeting}</p>`,
    `<p>Your booking for <strong>${args.service}</strong> is confirmed.</p>`,
    `<p><strong>When:</strong> ${args.startsAt} – ${args.endsAt}</p>`,
    `<p>Booking reference: <code>${args.bookingId}</code></p>`,
    `<p>Reply to this email to reschedule.</p>`,
  ].join("\n");

  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.fromAddress,
      to: args.to,
      subject: `Booking confirmation — ${args.service}`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend confirmation send failed: ${res.status} ${body}`);
  }
}
