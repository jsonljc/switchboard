import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { getCtaHref, getCtaLabel } from "@/lib/launch-mode";

export function FinalCta() {
  return (
    <section style={{ background: "#1E1C1A", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width" style={{ textAlign: "center" }}>
        <FadeIn>
          <h2
            style={{
              fontSize: "clamp(2rem, 4vw, 3.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#EDE8E1",
              marginBottom: "0.75rem",
            }}
          >
            Your next lead is already waiting.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              color: "#7A736C",
              marginBottom: "2.5rem",
            }}
          >
            Get Alex live where your leads already come in.
          </p>
          <Link
            href={getCtaHref()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#A07850",
              color: "#1A1714",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {getCtaLabel()} →
          </Link>
          <p
            style={{
              marginTop: "1.5rem",
              fontSize: "0.8125rem",
              color: "#7A736C",
            }}
          >
            No dev team required.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
