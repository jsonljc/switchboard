"use client";

import { useState } from "react";
import Link from "next/link";
import { isSelfServeSignupOpen } from "@/lib/register";

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

const primaryActionStyle: React.CSSProperties = {
  height: "48px",
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "8px",
  border: "none",
  background: "var(--sw-accent)",
  color: "white",
  fontSize: "16px",
  fontWeight: 600,
  textDecoration: "none",
};

const mutedLinkStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "var(--sw-text-muted)",
  textDecoration: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  fontWeight: 500,
  color: "var(--sw-text-primary)",
};

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
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
            {title}
          </h1>
          <p
            className="mt-2 text-center"
            style={{ fontSize: "16px", color: "var(--sw-text-secondary)" }}
          >
            {subtitle}
          </p>
        </div>

        <div
          className="rounded-xl p-8"
          style={{ background: "var(--sw-surface-raised)", border: "1px solid var(--sw-border)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const signupOpen = isSelfServeSignupOpen();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Something went wrong. Please try again.",
        );
        return;
      }
      setEmailSent(Boolean(data.verificationEmailSent));
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Closed launch mode: no self-serve form, route visitors to the waitlist. The
  // server route also returns 403 here, so this is UX over an enforced gate.
  if (!signupOpen) {
    return (
      <Shell
        title="Signups are not open yet"
        subtitle="We are onboarding businesses gradually. Join the waitlist and we will reach out when a spot opens."
      >
        <div className="text-center space-y-5">
          <Link href="/welcome" style={primaryActionStyle}>
            Join the waitlist
          </Link>
          <div>
            <Link href="/login" style={mutedLinkStyle}>
              Back to sign in
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (submitted) {
    return (
      <Shell
        title={emailSent ? "Check your email" : "Account created"}
        subtitle={
          emailSent
            ? "We sent a verification link to your email. Click it to activate your account, then sign in."
            : "Your account is ready. Sign in to get started."
        }
      >
        <div className="text-center">
          <Link href="/login" style={primaryActionStyle}>
            Continue to sign in
          </Link>
        </div>
      </Shell>
    );
  }

  const disabled = isLoading || !email || !password;

  return (
    <Shell title="Create your account" subtitle="Start running your revenue desk in minutes.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" style={labelStyle}>
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
        <div className="space-y-2">
          <label htmlFor="password" style={labelStyle}>
            Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
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
          disabled={disabled}
          className="transition-all active:scale-[0.98]"
          style={{
            ...primaryActionStyle,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.35 : 1,
          }}
        >
          {isLoading ? "Creating account..." : "Create account"}
        </button>
      </form>
      <div className="mt-5 text-center">
        <Link href="/login" style={mutedLinkStyle}>
          Already have an account? Sign in
        </Link>
      </div>
    </Shell>
  );
}
