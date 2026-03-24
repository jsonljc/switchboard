"use client";

import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { UploadPanel } from "@/components/knowledge/upload-panel";

export default function SettingsKnowledgePage() {
  const { status } = useSession();
  const router = useRouter();

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

      <UploadPanel agentId="lead-responder" />

      <div className="flex justify-end pt-4">
        <Button onClick={() => router.push("/settings/test-chat")}>Test your agent →</Button>
      </div>
    </div>
  );
}
