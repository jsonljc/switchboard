"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

/**
 * Global strip nudging an authenticated-but-unverified user to verify their
 * email, with a one-click resend. Self-hides for verified or unauthenticated
 * sessions. `session.emailVerified` is refreshed from the DB on each token
 * refresh (see lib/auth.ts), so the banner disappears once the user verifies
 * without a re-login. Quiet amber styling, matching DataModeBanner.
 *
 * The resend route (POST /api/dashboard/auth/resend-verification) is session
 * gated, so this in-app banner is the only valid caller; the pre-login
 * /login?verify=true screen cannot use it.
 */
export function VerifyEmailBanner() {
  const { data: session, status } = useSession();
  const [resendState, setResendState] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  // Only for an authenticated user whose email is not yet verified.
  if (status !== "authenticated" || session?.emailVerified) return null;

  const handleResend = async () => {
    setResendState("loading");
    try {
      const res = await fetch("/api/dashboard/auth/resend-verification", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResendState("error");
        setMessage("Could not resend. Please try again.");
        return;
      }
      if (data.alreadyVerified) {
        setResendState("sent");
        setMessage("Your email is already verified.");
        return;
      }
      if (data.sent) {
        setResendState("sent");
        setMessage("Verification email sent. Check your inbox.");
        return;
      }
      setResendState("error");
      setMessage("Could not send the email right now. Please try again later.");
    } catch {
      setResendState("error");
      setMessage("Could not resend. Please try again.");
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
    >
      <span>Verify your email to secure your account.</span>
      {resendState === "sent" || resendState === "error" ? (
        <span>{message}</span>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={resendState === "loading"}
          className="underline underline-offset-2 hover:no-underline disabled:opacity-50"
        >
          {resendState === "loading" ? "Sending..." : "Resend verification email"}
        </button>
      )}
    </div>
  );
}
