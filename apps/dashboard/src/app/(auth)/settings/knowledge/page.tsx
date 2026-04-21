"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { UploadPanel } from "@/components/knowledge/upload-panel";

export default function SettingsKnowledgePage() {
  const { status } = useSession();
  if (status === "loading") return null;
  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Knowledge Base</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Upload documents your agents will use to answer customer questions.
        </p>
      </section>

      <UploadPanel agentId="creative" />
    </div>
  );
}
