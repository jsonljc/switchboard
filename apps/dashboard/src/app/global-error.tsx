"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary (Next.js App Router `global-error`). This file is the
 * ONLY thing rendered when the root layout itself throws, so — unlike the nested
 * `error.tsx` — it must supply its own <html> and <body>. Without it, a throw in
 * the root layout shows Next's unstyled default white screen; this gives a
 * branded, recoverable fallback instead.
 *
 * It cannot rely on globals.css class tokens (the failed layout is what loads
 * them), so the fallback is inline-styled and self-contained. Type intentionally
 * inherits the UA sans-serif: the next/font CSS variables live on the (now
 * failed) root <html>, so a raw inline font-family here would both miss those
 * tokens and trip the type-honesty governance guard.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf8f3",
          color: "#1a1714",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }} role="alert">
          <p
            style={{
              margin: "0 0 4px",
              fontSize: "13px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8a8178",
            }}
          >
            Switchboard
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: "20px", fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 20px", fontSize: "14px", lineHeight: 1.6, color: "#5c554d" }}>
            The app hit an unexpected error and could not finish loading. Your data is safe — try
            again, and if it keeps happening, reload the page.
          </p>
          {error.digest && (
            <p
              style={{
                margin: "0 0 20px",
                fontSize: "12px",
                letterSpacing: "0.04em",
                color: "#a39a8f",
              }}
            >
              Ref: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#9a5b2e",
              color: "#ffffff",
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
