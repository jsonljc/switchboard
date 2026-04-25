import Link from "next/link";

export function LandingFooter() {
  return (
    <footer style={{ background: "#EDEAE5", borderTop: "1px solid #DDD9D3" }}>
      <div className="page-width" style={{ paddingTop: "3rem", paddingBottom: "3rem" }}>
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "2rem" }}
          className="sm:grid-cols-3"
        >
          {/* Brand */}
          <div>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.125rem",
                letterSpacing: "-0.015em",
                color: "#1A1714",
              }}
            >
              Switchboard
            </span>
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.8125rem",
                color: "#9C958F",
                lineHeight: 1.5,
              }}
            >
              AI agents that earn your trust over time.
            </p>
          </div>

          {/* Product */}
          <div>
            <p
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C958F",
              }}
            >
              Product
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[
                { href: "/how-it-works", label: "How it works" },
                { href: "/pricing", label: "Pricing" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "0.875rem",
                    color: "#6B6560",
                    textDecoration: "none",
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <p
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C958F",
              }}
            >
              Company
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <a
                href="mailto:hello@switchboard.ai"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "0.875rem",
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Contact us
              </a>
              <Link
                href="/privacy"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "0.875rem",
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "0.875rem",
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Terms
              </Link>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "2.5rem",
            paddingTop: "2rem",
            borderTop: "1px solid #DDD9D3",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
          className="sm:flex-row sm:items-center sm:justify-between"
        >
          <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>
            &copy; {new Date().getFullYear()} Switchboard. All rights reserved.
          </span>
          <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>
            AI agents that earn autonomy through trust.
          </span>
        </div>
      </div>
    </footer>
  );
}
