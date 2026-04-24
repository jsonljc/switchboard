"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";

  if (launchMode !== "beta") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1A1714",
          color: "#EDE8E1",
          padding: "2rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>
            Not yet open
          </h1>
          <p style={{ color: "#7A736C", marginBottom: "2rem" }}>
            Registration is currently invite-only.
          </p>
          <Link href="/get-started" style={{ color: "#A07850", textDecoration: "underline" }}>
            Join the waitlist
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        setError("Account created but sign-in failed. Please log in manually.");
        setLoading(false);
        return;
      }

      window.location.href = "/onboarding";
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1A1714",
        padding: "2rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "24rem" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            color: "#EDE8E1",
            marginBottom: "0.5rem",
          }}
        >
          Create your account
        </h1>
        <p style={{ color: "#7A736C", marginBottom: "2rem" }}>
          Start your free beta — no credit card required.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="email"
            style={{
              display: "block",
              color: "#A09A93",
              fontSize: "0.875rem",
              marginBottom: "0.375rem",
            }}
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#2A2520",
              border: "1px solid #3D3730",
              borderRadius: "0.5rem",
              color: "#EDE8E1",
              marginBottom: "1rem",
              outline: "none",
            }}
          />

          <label
            htmlFor="password"
            style={{
              display: "block",
              color: "#A09A93",
              fontSize: "0.875rem",
              marginBottom: "0.375rem",
            }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#2A2520",
              border: "1px solid #3D3730",
              borderRadius: "0.5rem",
              color: "#EDE8E1",
              marginBottom: "1rem",
              outline: "none",
            }}
          />

          <label
            htmlFor="confirmPassword"
            style={{
              display: "block",
              color: "#A09A93",
              fontSize: "0.875rem",
              marginBottom: "0.375rem",
            }}
          >
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#2A2520",
              border: "1px solid #3D3730",
              borderRadius: "0.5rem",
              color: "#EDE8E1",
              marginBottom: "1.5rem",
              outline: "none",
            }}
          />

          {error && (
            <p style={{ color: "#E5484D", fontSize: "0.875rem", marginBottom: "1rem" }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: loading ? "#7A736C" : "#A07850",
              color: "#1A1714",
              borderRadius: "9999px",
              border: "none",
              fontWeight: 600,
              fontSize: "0.9375rem",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            marginTop: "1.5rem",
            color: "#7A736C",
            fontSize: "0.875rem",
          }}
        >
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#A07850" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
