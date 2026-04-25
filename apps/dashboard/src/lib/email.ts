import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
const MAX_REGISTRATION_ATTEMPTS_PER_HOUR = 3;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getEmailFrom(): string {
  return process.env.EMAIL_FROM || "noreply@switchboard.app";
}

function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";
}

export async function sendVerificationEmail(
  prisma: PrismaClient,
  email: string,
): Promise<{ sent: boolean }> {
  const token = randomUUID();
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.dashboardVerificationToken.create({
    data: { identifier: email, token, expires },
  });

  const resend = getResendClient();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — verification email not sent");
    return { sent: false };
  }

  const verifyUrl = `${getBaseUrl()}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

  await resend.emails.send({
    from: getEmailFrom(),
    to: email,
    subject: "Verify your Switchboard account",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; color: #1A1714; margin-bottom: 16px;">Verify your email</h1>
        <p style="color: #4A4540; line-height: 1.6; margin-bottom: 24px;">
          Click the button below to verify your email and activate your Switchboard account.
        </p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 32px; background: #A07850; color: #ffffff; text-decoration: none; border-radius: 9999px; font-weight: 600; font-size: 15px;">
          Verify email
        </a>
        <p style="color: #7A736C; font-size: 13px; margin-top: 32px;">
          This link expires in ${VERIFICATION_TOKEN_EXPIRY_HOURS} hours. If you didn't create this account, ignore this email.
        </p>
      </div>
    `,
  });

  return { sent: true };
}

export async function verifyEmailToken(
  prisma: PrismaClient,
  email: string,
  token: string,
): Promise<{ verified: boolean; error?: string }> {
  try {
    const record = await prisma.dashboardVerificationToken.delete({
      where: { identifier_token: { identifier: email, token } },
    });

    if (record.expires < new Date()) {
      return { verified: false, error: "Verification link has expired. Please register again." };
    }

    await prisma.dashboardUser.update({
      where: { email },
      data: { emailVerified: new Date() },
    });

    return { verified: true };
  } catch {
    return { verified: false, error: "Invalid or already-used verification link." };
  }
}

export async function checkRegistrationRateLimit(
  prisma: PrismaClient,
  email: string,
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentAttempts = await prisma.dashboardVerificationToken.count({
    where: {
      identifier: email,
      expires: { gt: oneHourAgo },
    },
  });
  return recentAttempts < MAX_REGISTRATION_ATTEMPTS_PER_HOUR;
}
