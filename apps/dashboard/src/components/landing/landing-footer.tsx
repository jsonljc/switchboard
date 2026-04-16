import Link from "next/link";

export function LandingFooter() {
  return (
    <footer style={{ background: "hsl(40 20% 96%)", borderTop: "1px solid hsl(35 12% 90%)" }}>
      <div className="page-width py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <span className="font-display text-xl font-medium" style={{ color: "hsl(30 8% 12%)" }}>
              Switchboard
            </span>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "hsl(30 5% 52%)" }}>
              AI agents that earn your trust over time.
            </p>
          </div>

          {/* Product */}
          <div>
            <p
              className="mb-3 text-xs font-medium uppercase tracking-wider"
              style={{ color: "hsl(30 5% 48%)" }}
            >
              Product
            </p>
            <div className="flex flex-col gap-2">
              {[
                { href: "/agents", label: "Browse agents" },
                { href: "/how-it-works", label: "How it works" },
                { href: "/pricing", label: "Pricing" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm transition-colors"
                  style={{ color: "hsl(30 5% 50%)" }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <p
              className="mb-3 text-xs font-medium uppercase tracking-wider"
              style={{ color: "hsl(30 5% 48%)" }}
            >
              Company
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="mailto:builders@switchboard.ai"
                className="text-sm transition-colors"
                style={{ color: "hsl(30 5% 50%)" }}
              >
                Build an agent
              </a>
              <a
                href="mailto:hello@switchboard.ai"
                className="text-sm transition-colors"
                style={{ color: "hsl(30 5% 50%)" }}
              >
                Contact us
              </a>
            </div>
          </div>

          {/* CTA */}
          <div>
            <p
              className="mb-3 text-xs font-medium uppercase tracking-wider"
              style={{ color: "hsl(30 5% 48%)" }}
            >
              Get started
            </p>
            <Link
              href="/get-started"
              className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: "hsl(30 48% 42%)" }}
            >
              Get early access →
            </Link>
          </div>
        </div>

        <div
          className="mt-10 flex flex-col gap-2 border-t pt-8 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: "hsl(35 12% 89%)" }}
        >
          <span className="text-xs" style={{ color: "hsl(30 5% 58%)" }}>
            &copy; {new Date().getFullYear()} Switchboard. All rights reserved.
          </span>
          <span className="text-xs" style={{ color: "hsl(30 5% 62%)" }}>
            AI agents that earn autonomy through trust.
          </span>
        </div>
      </div>
    </footer>
  );
}
