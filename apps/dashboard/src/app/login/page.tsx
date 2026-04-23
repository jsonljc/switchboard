"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn, useSession, SessionProvider } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AgentMark } from "@/components/character/agent-mark";

const smtpConfigured = process.env.NEXT_PUBLIC_SMTP_CONFIGURED === "true";
const googleConfigured = process.env.NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED === "true";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const isVerify = searchParams.get("verify") === "true";
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.push(callbackUrl);
    }
  }, [status, callbackUrl, router]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setIsLoading(false);
    } else {
      window.location.href = callbackUrl;
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await signIn("email", { email, callbackUrl });
    setIsLoading(false);
  };

  if (isVerify) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "var(--sw-base)" }}
      >
        <div
          className="w-full max-w-sm rounded-xl p-8 text-center"
          style={{
            background: "var(--sw-surface-raised)",
            border: "1px solid var(--sw-border)",
          }}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "hsl(145, 45%, 42%, 0.1)" }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="hsl(145, 45%, 42%)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1
            className="text-xl font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
          >
            Check your email
          </h1>
          <p className="mt-2" style={{ fontSize: "16px", color: "var(--sw-text-secondary)" }}>
            We sent you a magic link. Click the link in your email to sign in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--sw-base)" }}
    >
      {/* Wordmark — fixed top-left */}
      <Link
        href="/"
        className="fixed top-6 left-6 z-10"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "18px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          textDecoration: "none",
        }}
      >
        Switchboard
      </Link>

      {/* Login card — centered with 40/60 upward bias */}
      <div className="w-full max-w-[400px]" style={{ marginTop: "-5vh" }}>
        {/* Alex mark + heading */}
        <div className="flex flex-col items-center mb-10">
          <div className="mb-5 animate-aura-breathe">
            <AgentMark agent="alex" size="lg" />
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "32px",
              fontWeight: 600,
              lineHeight: "40px",
              color: "var(--sw-text-primary)",
              textAlign: "center",
            }}
          >
            Welcome back
          </h1>
          <p
            className="mt-2 text-center"
            style={{ fontSize: "16px", color: "var(--sw-text-secondary)" }}
          >
            Sign in to your workspace
          </p>
        </div>

        {/* Form card */}
        <div
          className="rounded-xl p-8"
          style={{
            background: "var(--sw-surface-raised)",
            border: "1px solid var(--sw-border)",
          }}
        >
          {googleConfigured && (
            <>
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl })}
                className="w-full flex items-center justify-center gap-3 transition-colors"
                style={{
                  height: "48px",
                  borderRadius: "8px",
                  border: "1px solid var(--sw-border)",
                  background: "white",
                  fontSize: "16px",
                  fontWeight: 500,
                  color: "var(--sw-text-primary)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--sw-border-strong)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--sw-border)";
                }}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full" style={{ borderTop: "1px solid var(--sw-border)" }} />
                </div>
                <div className="relative flex justify-center">
                  <span
                    className="px-3 text-xs uppercase"
                    style={{
                      background: "var(--sw-surface-raised)",
                      color: "var(--sw-text-muted)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    or
                  </span>
                </div>
              </div>
            </>
          )}

          {showMagicLink ? (
            <>
              <form onSubmit={handleMagicLinkSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="magic-email"
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--sw-text-primary)",
                    }}
                  >
                    Email
                  </label>
                  <input
                    id="magic-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full transition-colors"
                    style={{
                      height: "48px",
                      padding: "0 16px",
                      fontSize: "16px",
                      borderRadius: "8px",
                      border: "1px solid var(--sw-border)",
                      background: "white",
                      color: "var(--sw-text-primary)",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "var(--sw-accent)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(160, 120, 80, 0.12)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--sw-border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !email}
                  className="w-full flex items-center justify-center gap-2 transition-all"
                  style={{
                    height: "48px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--sw-accent)",
                    color: "white",
                    fontSize: "16px",
                    fontWeight: 600,
                    cursor: isLoading || !email ? "not-allowed" : "pointer",
                    opacity: isLoading || !email ? 0.35 : 1,
                  }}
                >
                  {isLoading ? "Sending..." : "Send magic link"}
                </button>
              </form>
              <div className="mt-5 text-center">
                <button
                  type="button"
                  style={{
                    fontSize: "14px",
                    color: "var(--sw-text-muted)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--sw-text-secondary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--sw-text-muted)";
                  }}
                  onClick={() => {
                    setShowMagicLink(false);
                    setError("");
                  }}
                >
                  Sign in with password instead
                </button>
              </div>
            </>
          ) : (
            <>
              <form onSubmit={handleCredentialsSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--sw-text-primary)",
                    }}
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full transition-colors"
                    style={{
                      height: "48px",
                      padding: "0 16px",
                      fontSize: "16px",
                      borderRadius: "8px",
                      border: "1px solid var(--sw-border)",
                      background: "white",
                      color: "var(--sw-text-primary)",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "var(--sw-accent)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(160, 120, 80, 0.12)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--sw-border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="password"
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--sw-text-primary)",
                    }}
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full transition-colors"
                    style={{
                      height: "48px",
                      padding: "0 16px",
                      fontSize: "16px",
                      borderRadius: "8px",
                      border: "1px solid var(--sw-border)",
                      background: "white",
                      color: "var(--sw-text-primary)",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "var(--sw-accent)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(160, 120, 80, 0.12)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--sw-border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                </div>
                {error && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: "8px",
                      border: "1px solid hsl(0, 20%, 88%)",
                      background: "hsl(0, 20%, 97%)",
                      fontSize: "16px",
                      lineHeight: "24px",
                      color: "hsl(0, 38%, 40%)",
                    }}
                  >
                    That email and password didn&apos;t match. Try again.
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isLoading || !email || !password}
                  className="w-full flex items-center justify-center transition-all active:scale-[0.98]"
                  style={{
                    height: "48px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--sw-accent)",
                    color: "white",
                    fontSize: "16px",
                    fontWeight: 600,
                    cursor: isLoading || !email || !password ? "not-allowed" : "pointer",
                    opacity: isLoading || !email || !password ? 0.35 : 1,
                  }}
                >
                  {isLoading ? "Signing in..." : "Sign in"}
                </button>
              </form>
              {smtpConfigured && (
                <div className="mt-5 text-center">
                  <button
                    type="button"
                    style={{
                      fontSize: "14px",
                      color: "var(--sw-text-muted)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--sw-text-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--sw-text-muted)";
                    }}
                    onClick={() => {
                      setShowMagicLink(true);
                      setError("");
                    }}
                  >
                    Or sign in with magic link
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center" style={{ fontSize: "13px", color: "var(--sw-text-muted)" }}>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            style={{
              color: "var(--sw-text-secondary)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--sw-text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--sw-text-secondary)";
            }}
          >
            Get started
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <SessionProvider>
      <Suspense>
        <LoginForm />
      </Suspense>
    </SessionProvider>
  );
}
