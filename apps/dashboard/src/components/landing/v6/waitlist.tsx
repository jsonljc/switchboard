"use client";

import { useState } from "react";
import { isSelfServeSignupOpen } from "@/lib/register";

export function V6Waitlist() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Something went wrong. Please try again.",
        );
        return;
      }
      setDuplicate(Boolean(data.duplicate));
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // No waitlist when signup is open: visitors can register directly.
  if (isSelfServeSignupOpen()) return null;

  return (
    <section
      id="waitlist"
      data-screen-label="Waitlist"
      className="relative border-t border-[hsl(20_8%_14%_/_0.06)] py-36 text-center max-[900px]:py-24"
    >
      <div className="mx-auto w-full max-w-[80rem] px-10 max-[900px]:px-6">
        <div className="mx-auto flex max-w-[44rem] flex-col items-center">
          <span className="font-mono-v6 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3">
            Early access
          </span>
          <h2
            className="mt-5 text-balance font-semibold leading-[1.05] tracking-[-0.025em] text-v6-graphite"
            style={{ fontSize: "clamp(2rem, 4.5vw, 3.5rem)" }}
          >
            Be first through the door.
          </h2>
          <p className="mx-auto mt-5 max-w-[34rem] text-[1.0625rem] leading-[1.5] text-v6-graphite-2">
            We are opening seats gradually. Drop your email and we will reach out the moment one is
            ready.
          </p>

          {submitted ? (
            <p className="mt-9 text-[1.0625rem] font-medium text-v6-graphite">
              {duplicate
                ? "You are already on the list. We will be in touch."
                : "You are on the list. We will reach out soon."}
            </p>
          ) : (
            <>
              <form
                onSubmit={handleSubmit}
                className="mt-9 flex w-full max-w-[30rem] flex-col items-stretch gap-3 sm:flex-row"
              >
                <label htmlFor="waitlist-email" className="sr-only">
                  Email
                </label>
                <input
                  id="waitlist-email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-[3.25rem] w-full flex-1 rounded-full border border-[hsl(20_8%_14%_/_0.14)] bg-white px-6 text-[0.95rem] text-v6-graphite outline-none transition-colors placeholder:text-v6-graphite-3 focus:border-v6-graphite"
                />
                <button
                  type="submit"
                  disabled={isLoading || !email}
                  className="inline-flex h-[3.25rem] items-center justify-center whitespace-nowrap rounded-full bg-v6-graphite px-7 text-[0.95rem] font-medium text-v6-cream transition-[transform,background-color] duration-[250ms] hover:-translate-y-px hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isLoading ? "Joining..." : "Join the waitlist"}
                </button>
              </form>
              {error && (
                <p className="mt-4 text-[0.9rem] text-v6-coral" role="alert">
                  {error}
                </p>
              )}
              <span className="font-mono-v6 mt-7 text-[11px] tracking-[0.08em] text-v6-graphite-3">
                No spam · one note when your seat is ready
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
