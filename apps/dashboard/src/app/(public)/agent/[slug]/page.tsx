import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { StorefrontPage } from "@/components/marketplace/storefront-page";
import type { StorefrontData } from "@/components/marketplace/storefront-page";

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function fetchStorefront(slug: string): Promise<StorefrontData | null> {
  const apiUrl = process.env.SWITCHBOARD_API_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${apiUrl}/api/storefront/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as StorefrontData;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchStorefront(slug);
  if (!data) return { title: "Agent Not Found — Switchboard" };
  return {
    title: `${data.businessName} — Switchboard`,
    description:
      typeof data.scannedProfile?.description === "string"
        ? (data.scannedProfile.description as string)
        : `Chat with ${data.agentName} on Switchboard`,
    openGraph: {
      title: `${data.businessName} — Switchboard`,
      description:
        typeof data.scannedProfile?.description === "string"
          ? (data.scannedProfile.description as string)
          : `Chat with ${data.agentName} on Switchboard`,
      type: "website",
    },
  };
}

export default async function AgentStorefrontPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await fetchStorefront(slug);
  if (!data) notFound();
  return <StorefrontPage data={data} />;
}
