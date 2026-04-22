"use client";

import { useState } from "react";

type State = "idle" | "loading" | "success" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || state === "loading") return;
    setState("loading");
    setErrorMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setState("success");
      } else {
        const data = await res.json().catch(() => ({}));
        setState("error");
        setErrorMessage(data.error || "Waitlist signup is temporarily unavailable");
      }
    } catch {
      setState("error");
      setErrorMessage("Waitlist signup is temporarily unavailable");
    }
  }

  if (state === "success") {
    return (
      <div
        style={{
          borderRadius: "1rem",
          padding: "2rem",
          textAlign: "center",
          background: "#F9F8F6",
          border: "1px solid #DDD9D3",
        }}
      >
        <div
          style={{
            margin: "0 auto 1rem",
            display: "flex",
            width: "3rem",
            height: "3rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9999px",
            background: "rgba(160,120,80,0.12)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path
              d="M4 11l5 5L18 7"
              stroke="#A07850"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "#1A1714",
          }}
        >
          You&rsquo;re on the list.
        </p>
        <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#6B6560" }}>
          We review every request personally. We&rsquo;ll reach out when your access opens.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        className="sm:flex-row"
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          style={{
            flex: 1,
            borderRadius: "9999px",
            padding: "0.875rem 1.25rem",
            fontSize: "0.875rem",
            outline: "none",
            background: "#F9F8F6",
            border: "1px solid #DDD9D3",
            color: "#1A1714",
          }}
          onFocus={(e) => {
            (e.target as HTMLElement).style.borderColor = "rgba(160,120,80,0.5)";
            (e.target as HTMLElement).style.boxShadow = "0 0 0 3px rgba(160,120,80,0.1)";
          }}
          onBlur={(e) => {
            (e.target as HTMLElement).style.borderColor = "#DDD9D3";
            (e.target as HTMLElement).style.boxShadow = "none";
          }}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            borderRadius: "9999px",
            padding: "0.875rem 1.75rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            whiteSpace: "nowrap",
            cursor: state === "loading" ? "wait" : "pointer",
            background: state === "loading" ? "#C8C3BC" : "#1A1714",
            color: "#F5F3F0",
            border: "none",
          }}
        >
          {state === "loading" ? "Joining…" : "Join waitlist"}
        </button>
      </div>

      {state === "error" && (
        <p style={{ paddingLeft: "0.5rem", fontSize: "0.75rem", color: "#8B3A3A" }}>
          {errorMessage || "Waitlist signup is temporarily unavailable"} Try again or email{" "}
          <a href="mailto:hello@switchboard.ai" style={{ color: "#A07850" }}>
            hello@switchboard.ai
          </a>
          .
        </p>
      )}

      {/* Trust signals */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1.25rem", paddingLeft: "0.5rem" }}
      >
        {[
          "No credit card required",
          "Early onboarding support",
          "We'll reach out when access opens",
        ].map((t) => (
          <span
            key={t}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.75rem",
              color: "#9C958F",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 5l2 2 4-4"
                stroke="#A07850"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t}
          </span>
        ))}
      </div>
    </form>
  );
}
