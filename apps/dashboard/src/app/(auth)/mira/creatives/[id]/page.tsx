import type { Metadata } from "next";
import { MiraCreativeDetailPage } from "./creative-detail-page";

export const metadata: Metadata = {
  title: "Draft — Mira",
  description: "Draft-only review for a single creative. Nothing is published without you.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MiraCreativeDetailPage id={id} />;
}
