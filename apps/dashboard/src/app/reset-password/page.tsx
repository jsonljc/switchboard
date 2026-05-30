"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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

function BackToSignIn({ label = "Back to sign in" }: { label?: string }) {
  return (
    <div className="text-center">
      <Link
        href="/login"
        style={{ fontSize: "14px", color: "var(--sw-text-muted)", textDecoration: "none" }}
      >
        {label}
      </Link>
    </div>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <Shell title="Invalid reset link" subtitle="This link is missing or incomplete.">
        <div className="space-y-5 text-center">
          <p style={{ fontSize: "15px", color: "var(--sw-text-secondary)" }}>
            Request a fresh link and try again.
          </p>
          <BackToSignIn label="Request a new link" />
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password updated" subtitle="You can now sign in with your new password.">
        <BackToSignIn label="Go to sign in" />
      </Shell>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const disabled = isLoading || !password || !confirm;

  return (
    <Shell title="Set a new password" subtitle="Choose a new password for your account.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="password" style={labelStyle}>
            New password
          </label>
          <input
            id="password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm" style={labelStyle}>
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            placeholder="Re-enter your new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          disabled={disabled}
          className="w-full flex items-center justify-center transition-all active:scale-[0.98]"
          style={{
            height: "48px",
            borderRadius: "8px",
            border: "none",
            background: "var(--sw-accent)",
            color: "white",
            fontSize: "16px",
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.35 : 1,
          }}
        >
          {isLoading ? "Updating..." : "Reset password"}
        </button>
        <BackToSignIn />
      </form>
    </Shell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
