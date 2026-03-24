"use client";

import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TestChatWidget } from "@/components/chat/test-chat-widget";
import { useGoLive } from "@/hooks/use-test-chat";
import { useToast } from "@/components/ui/use-toast";

export default function SettingsTestChatPage() {
  const { status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const goLive = useGoLive();

  if (status === "loading") return null;
  if (status === "unauthenticated") redirect("/login");

  const handleGoLive = () => {
    goLive.mutate("lead-responder", {
      onSuccess: () => {
        toast({ title: "Agent is now live!" });
        router.push("/");
      },
      onError: () => {
        toast({ title: "Failed to go live", variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Test your agent
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Chat with your agent to verify answers. Flag wrong answers to teach corrections.
        </p>
      </section>

      <TestChatWidget agentId="lead-responder" />

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => router.push("/settings/knowledge")}>
          ← Upload more docs
        </Button>
        <Button onClick={handleGoLive} disabled={goLive.isPending}>
          {goLive.isPending ? "Going live..." : "Go Live"}
        </Button>
      </div>
    </div>
  );
}
