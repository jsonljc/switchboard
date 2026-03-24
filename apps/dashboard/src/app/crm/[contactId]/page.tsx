"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ContactDetail } from "@/components/crm/contact-detail.js";

export default function ContactDetailPage() {
  const { status } = useSession();
  const params = useParams();
  const router = useRouter();
  const contactId = params.contactId as string;

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <ContactDetail contactId={contactId} conversationId={contactId} />
    </div>
  );
}
