"use client";

import { useState } from "react";
import Link from "next/link";

const inputStyle: React.CSSProperties = {
  height: "48px",
  width: "100%",
  padding: "0 16px",
  fontSize: "16px",
  borderRadius: "8px",
  border: "1px solid var(--sw-border)",
  background: "white",
  color: "var(--sw-text-primary)",
  outline: "none",
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDevResetUrl(typeof data.resetUrl === "string" ? data.resetUrl : null);
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--sw-base)" }}
    >
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

      <div className="w-full max-w-[400px]" style={{ marginTop: "-5vh" }}>
        <div className="flex flex-col items-center mb-10">
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
            {submitted ? "Check your email" : "Reset your password"}
          </h1>
          <p
            className="mt-2 text-center"
            style={{ fontSize: "16px", color: "var(--sw-text-secondary)" }}
          >
            {submitted
              ? "If an account exists for that address, we've sent a link to set a new password."
              : "Enter your email and we'll send you a link to set a new password."}
          </p>
        </div>

        <div
          className="rounded-xl p-8"
          style={{ background: "var(--sw-surface-raised)", border: "1px solid var(--sw-border)" }}
        >
          {submitted ? (
            <div className="text-center space-y-5">
              {devResetUrl && (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--sw-border)",
                    background: "var(--sw-base)",
                    fontSize: "13px",
                    color: "var(--sw-text-secondary)",
                    wordBreak: "break-all",
                    textAlign: "left",
                  }}
                >
                  <p style={{ marginBottom: "8px", fontWeight: 600 }}>
                    Dev mode — no email provider configured. Use this link:
                  </p>
                  <a href={devResetUrl} style={{ color: "var(--sw-accent)" }}>
                    {devResetUrl}
                  </a>
                </div>
              )}
              <Link
                href="/login"
                style={{ fontSize: "14px", color: "var(--sw-text-muted)", textDecoration: "none" }}
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
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
                  style={inputStyle}
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
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={isLoading || !email}
                className="w-full flex items-center justify-center transition-all active:scale-[0.98]"
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
                {isLoading ? "Sending..." : "Send reset link"}
              </button>
              <div className="text-center">
                <Link
                  href="/login"
                  style={{
                    fontSize: "14px",
                    color: "var(--sw-text-muted)",
                    textDecoration: "none",
                  }}
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
