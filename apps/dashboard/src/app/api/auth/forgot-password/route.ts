// @route-class: ingress-receiver
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requestPasswordReset } from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/email";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  // Always respond identically whether or not the account exists, so this
  // endpoint cannot be used to enumerate registered emails.
  const { token } = await requestPasswordReset(prisma, email);

  let resetUrl: string | undefined;
  if (token) {
    // Awaited deliberately (not fire-and-forget): Next.js on Vercel does not
    // guarantee un-awaited async work completes after the response returns, so
    // `void sendPasswordResetEmail(...)` would drop emails. The cost is that an
    // existing-account request is latency-distinguishable from an unknown one —
    // an accepted, low-practicality residual timing channel for v1 (the existing
    // registration flow behaves identically). Flatten later via `after()`/
    // waitUntil if it ever matters.
    const { sent, url } = await sendPasswordResetEmail(email, token);
    // Local-dev affordance: when no email provider is configured, surface the
    // link so the flow is testable. Gated to non-production only (Vercel preview
    // and prod both run as production → never leaked there).
    if (!sent && process.env.NODE_ENV !== "production") {
      resetUrl = url;
    }
  }

  return NextResponse.json({ ok: true, ...(resetUrl ? { resetUrl } : {}) }, { status: 200 });
}
