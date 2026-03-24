"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAgentRoster, useUpdateAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentConfigPersonality } from "@/components/team/agent-config-personality";
import { AgentConfigIdentity } from "@/components/team/agent-config-identity";
import { AgentConfigBehavior } from "@/components/team/agent-config-behavior";
import { getPreviewMessage } from "@/components/team/agent-preview-templates";

export default function SettingsAgentConfigPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  // Triggers query cache population so agent.agentState is available on roster entries
  useAgentState();
  const updateRoster = useUpdateAgentRoster();
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agent = rosterData?.roster.find((a) => a.id === agentId);

  // Local state for optimistic editing
  const [displayName, setDisplayName] = useState("");
  const [tonePreset, setTonePreset] = useState("warm-professional");
  const [behaviorConfig, setBehaviorConfig] = useState<Record<string, unknown>>({});

  // Initialize local state from roster data — only when agent first loads or ID changes
  const agentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (agent && agent.id !== agentIdRef.current) {
      agentIdRef.current = agent.id;
      setDisplayName(agent.displayName);
      setTonePreset((agent.config.tonePreset as string) || "warm-professional");
      setBehaviorConfig(agent.config);
    }
  }, [agent]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const debouncedSave = useCallback(
    (updates: { displayName?: string; config?: Record<string, unknown> }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!agent) return;
        updateRoster.mutate(
          { id: agent.id, ...updates },
          {
            onSuccess: () => toast({ title: "Saved", duration: 1500 }),
            onError: () => toast({ title: "Failed to save", variant: "destructive" }),
          },
        );
      }, 500);
    },
    [agent, updateRoster, toast],
  );

  const handleDisplayNameChange = useCallback(
    (name: string) => {
      setDisplayName(name);
      debouncedSave({ displayName: name, config: behaviorConfig });
    },
    [debouncedSave, behaviorConfig],
  );

  const handleToneChange = useCallback(
    (tone: string) => {
      setTonePreset(tone);
      const newConfig = { ...behaviorConfig, tonePreset: tone };
      setBehaviorConfig(newConfig);
      debouncedSave({ displayName, config: newConfig });
    },
    [behaviorConfig, displayName, debouncedSave],
  );

  const handleBehaviorChange = useCallback(
    (key: string, value: unknown) => {
      const newConfig = { ...behaviorConfig, [key]: value };
      setBehaviorConfig(newConfig);
      debouncedSave({ displayName, config: newConfig });
    },
    [behaviorConfig, displayName, debouncedSave],
  );

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-48" />
        <div className="grid gap-8 grid-cols-1 md:grid-cols-3">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/settings/team")}
          className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 inline mr-1" />
          Back to team
        </button>
        <p className="text-[14px] text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
  const metrics = (agent.agentState?.metrics as Record<string, unknown>) ?? {};
  const businessName = (agent.config.businessName as string) ?? "";
  const previewText = getPreviewMessage(agent.agentRole, tonePreset, behaviorConfig, businessName);

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/settings/team")}
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Team
        </button>
        <span className="text-[13px] text-muted-foreground">/</span>
        <span className="text-[13px] text-foreground font-medium">{displayName}</span>
      </div>

      {/* Three-column layout */}
      <div className="grid gap-8 grid-cols-1 md:grid-cols-3">
        {/* Left: Personality */}
        <div className="order-2 md:order-1">
          <AgentConfigPersonality
            displayName={displayName}
            tonePreset={tonePreset}
            onDisplayNameChange={handleDisplayNameChange}
            onToneChange={handleToneChange}
          />
        </div>

        {/* Center: Identity */}
        <div className="order-1 md:order-2">
          <AgentConfigIdentity
            agentRole={agent.agentRole}
            displayName={displayName}
            activityStatus={activityStatus}
            metrics={metrics}
            previewText={previewText}
          />
        </div>

        {/* Right: Behavior */}
        <div className="order-3">
          <AgentConfigBehavior
            agentRole={agent.agentRole}
            config={behaviorConfig}
            onConfigChange={handleBehaviorChange}
          />
        </div>
      </div>
    </div>
  );
}
