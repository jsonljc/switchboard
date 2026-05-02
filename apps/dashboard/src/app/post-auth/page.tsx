"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, SessionProvider } from "next-auth/react";
import { defaultCallback } from "../login/redirect-logic";

/**
 * Sentinel resolver route for post-sign-in redirects.
 *
 * The login page sends fresh sign-ins here (instead of `/`) so the destination
 * is computed from the session shape (onboarded → /console, not onboarded →
 * /onboarding) rather than landing the user on the public marketing page.
 *
 * Renders nothing visible: the user sees a brief "Signing you in…" placeholder
 * while NextAuth resolves the session, then this page issues a `router.replace`
 * to the resolved target.
 */
function PostAuthResolver() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated") {
      router.replace(defaultCallback(session));
    }
  }, [status, session, router]);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--sw-base)" }}
    >
      <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)" }}>Signing you in…</p>
    </div>
  );
}

export default function PostAuthPage() {
  return (
    <SessionProvider>
      <PostAuthResolver />
    </SessionProvider>
  );
}
