"use client";

import { useState } from "react";

type State = "idle" | "loading" | "success" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok || res.status === 409) {
        setState("success");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: "hsl(38 40% 95%)", border: "1px solid hsl(35 20% 88%)" }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "hsl(30 55% 46% / 0.12)" }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path
              d="M4 11l5 5L18 7"
              stroke="hsl(30 55% 46%)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p
          className="font-display text-xl font-light"
          style={{ color: "hsl(30 8% 12%)", letterSpacing: "-0.01em" }}
        >
          You&rsquo;re on the list.
        </p>
        <p className="mt-2 text-sm" style={{ color: "hsl(30 6% 45%)" }}>
          We review every request personally. We&rsquo;ll reach out when your access opens.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="flex-1 rounded-full px-5 py-3.5 text-sm outline-none transition-all"
          style={{
            background: "hsl(0 0% 100%)",
            border: "1px solid hsl(35 12% 85%)",
            color: "hsl(30 8% 12%)",
            boxShadow: "inset 0 1px 2px hsl(30 8% 10% / 0.04)",
          }}
          onFocus={(e) => {
            (e.target as HTMLElement).style.borderColor = "hsl(30 55% 46% / 0.5)";
            (e.target as HTMLElement).style.boxShadow =
              "0 0 0 3px hsl(30 55% 46% / 0.1), inset 0 1px 2px hsl(30 8% 10% / 0.04)";
          }}
          onBlur={(e) => {
            (e.target as HTMLElement).style.borderColor = "hsl(35 12% 85%)";
            (e.target as HTMLElement).style.boxShadow = "inset 0 1px 2px hsl(30 8% 10% / 0.04)";
          }}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded-full px-7 py-3.5 text-sm font-medium tracking-wide transition-all"
          style={{
            background: state === "loading" ? "hsl(30 40% 55%)" : "hsl(30 55% 46%)",
            color: "white",
            cursor: state === "loading" ? "wait" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {state === "loading" ? "Joining…" : "Join waitlist"}
        </button>
      </div>

      {state === "error" && (
        <p className="pl-2 text-xs" style={{ color: "hsl(0 38% 45%)" }}>
          Something went wrong. Try again or email{" "}
          <a href="mailto:hello@switchboard.ai" style={{ color: "hsl(30 55% 46%)" }}>
            hello@switchboard.ai
          </a>
          .
        </p>
      )}

      {/* Trust signals */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 pl-2">
        {[
          "No credit card required",
          "Early onboarding support",
          "We'll reach out when access opens",
        ].map((t) => (
          <span
            key={t}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "hsl(30 5% 55%)" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 5l2 2 4-4"
                stroke="hsl(30 55% 46%)"
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
