import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";
import { validatePassword } from "./register";

/** Minutes a reset link stays valid. */
export const RESET_TOKEN_EXPIRY_MINUTES = 45;
/** Reset requests honoured per user per rolling hour. */
export const MAX_RESET_REQUESTS_PER_HOUR = 3;

/** SHA-256 hex of a raw reset token. Only the hash is ever persisted. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a password-reset token for `email` if it maps to a password account
 * within the hourly limit. Returns `{ token: null }` for unknown emails,
 * passwordless (e.g. Google-only) accounts, or rate-limited users — callers
 * MUST respond identically in every case to avoid account enumeration.
 */
export async function requestPasswordReset(
  prisma: PrismaClient,
  email: string,
): Promise<{ token: string | null }> {
  const user = await prisma.dashboardUser.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return { token: null };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.dashboardPasswordResetToken.count({
    where: { userId: user.id, createdAt: { gt: oneHourAgo } },
  });
  if (recent >= MAX_RESET_REQUESTS_PER_HOUR) return { token: null };

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
  await prisma.dashboardPasswordResetToken.create({
    data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt },
  });
  return { token };
}

/**
 * Consume a reset token and set the user's new password. Validates the new
 * password, rejects unknown/expired tokens, and on success deletes all of the
 * user's reset tokens (single-use + invalidates any siblings).
 */
export async function resetPasswordWithToken(
  prisma: PrismaClient,
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const pw = validatePassword(newPassword);
  if (!pw.valid) return { ok: false, error: pw.error };

  const tokenHash = hashResetToken(token);
  const record = await prisma.dashboardPasswordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!record) {
    return { ok: false, error: "Invalid or expired reset link. Please request a new one." };
  }
  if (record.expiresAt < new Date()) {
    // Invalidate only the expired token itself — a fresh sibling issued by a
    // later request must remain usable. (The success path below consumes all
    // of the user's tokens; an expired submission must not.)
    await prisma.dashboardPasswordResetToken.deleteMany({ where: { tokenHash } });
    return { ok: false, error: "This reset link has expired. Please request a new one." };
  }

  await prisma.dashboardUser.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await prisma.dashboardPasswordResetToken.deleteMany({ where: { userId: record.userId } });
  return { ok: true };
}
