import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Switchboard — Hire your revenue desk. One agent at a time.",
  description:
    "Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.",
  openGraph: {
    title: "Switchboard — Hire your revenue desk. One agent at a time.",
    description:
      "Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Switchboard — Hire your revenue desk. One agent at a time.",
    description:
      "Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.",
    images: ["/og-image.png"],
  },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="light min-h-screen flex flex-col" style={{ background: "var(--sw-base)" }}>
      <main className="flex-1">{children}</main>
    </div>
  );
}
