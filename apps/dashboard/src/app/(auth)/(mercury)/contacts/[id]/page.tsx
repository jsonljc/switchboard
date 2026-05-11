import type { Metadata } from "next";
import { ContactDetailPage } from "./contact-detail-page";

export const metadata: Metadata = {
  title: "Contact — Switchboard",
  description: "Read-only inspection page for a single contact.",
};

export default async function ContactDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactDetailPage contactId={id} />;
}
