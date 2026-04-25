import { FadeIn } from "@/components/ui/fade-in";

/** Placeholder count — wire to real data when available. */
const EARLY_ADOPTER_COUNT = 50;

export function SocialProof() {
  return (
    <section style={{ background: "#EDEAE5", paddingTop: "3rem", paddingBottom: "3rem" }}>
      <div className="page-width" style={{ textAlign: "center" }}>
        <FadeIn>
          <p
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#9C958F",
              marginBottom: "0.5rem",
            }}
          >
            Join our early adopters
          </p>
          <p
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              color: "#1A1714",
            }}
          >
            {EARLY_ADOPTER_COUNT}+ businesses are already using Switchboard to respond faster.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
