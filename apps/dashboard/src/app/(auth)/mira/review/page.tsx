import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraFeedPage } from "@/components/cockpit/mira/mira-feed-page";

// Phase 2: the vertical review feed (M1) lives here. `/mira` is now the Director's
// Desk. Same opt-in gate as the Desk — 404 unless this org has Mira enabled.
export default async function MiraReviewPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();

  return (
    <div style={{ position: "relative" }}>
      <Link
        href="/mira"
        aria-label="Back to Mira"
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 20,
          padding: "6px 12px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        ← Mira
      </Link>
      <MiraFeedPage />
    </div>
  );
}
