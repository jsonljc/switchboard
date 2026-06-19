"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { UploadPanel } from "@/components/knowledge/upload-panel";
import { KnowledgeSkeleton } from "@/components/settings/knowledge-skeleton";
import { PageTitle } from "@/components/layout/page-title";

export default function SettingsKnowledgePage() {
  const { status } = useSession();
  if (status === "loading") return <KnowledgeSkeleton />;
  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow="Settings"
        sub="Upload documents your agents will use to answer customer questions."
      >
        Knowledge Base
      </PageTitle>

      <UploadPanel />
    </div>
  );
}
