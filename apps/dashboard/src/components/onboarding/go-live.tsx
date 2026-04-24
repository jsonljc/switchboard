"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, AlertCircle, Loader2, Zap } from "lucide-react";
import { AgentMark } from "@/components/character/agent-mark";
import { ChannelConnectCard } from "./channel-connect-card";
import { LaunchSequence } from "./launch-sequence";
import { useReadiness } from "@/hooks/use-governance";
import type { Playbook } from "@switchboard/schemas";

interface GoLiveProps {
  playbook: Playbook;
  onLaunch: () => Promise<void>;
  onBack: () => void;
  connectedChannels: string[];
  scenariosTested: number;
  onConnectChannel: (channel: string, credentials: Record<string, string>) => void;
  onLaunchComplete: () => void;
  isConnecting: boolean;
  connectError?: string;
}

interface ReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "fail";
  message: string;
  blocking: boolean;
}

function BlockingCheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-2 text-[16px]"
        style={{
          color: check.status === "fail" ? "hsl(0, 70%, 50%)" : "var(--sw-text-primary)",
        }}
      >
        {check.status === "pass" ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
        <span>{check.label}</span>
      </div>
      {check.status === "fail" && check.message && (
        <p className="ml-6 text-[13px]" style={{ color: "var(--sw-text-muted)" }}>
          {check.message}
        </p>
      )}
    </div>
  );
}

function AdvisoryCheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-2 text-[16px]"
        style={{ color: "var(--sw-text-primary)" }}
      >
        {check.status === "pass" ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" />
        )}
        <span>{check.label}</span>
      </div>
      {check.status === "fail" && check.message && (
        <p className="ml-6 text-[13px]" style={{ color: "var(--sw-text-muted)" }}>
          {check.message}
        </p>
      )}
    </div>
  );
}

function ChannelCards({
  recommended,
  connectedChannels,
  onConnectChannel,
  isConnecting,
}: {
  recommended: string;
  connectedChannels: string[];
  onConnectChannel: (channel: string, credentials: Record<string, string>) => void;
  isConnecting: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border" style={{ borderColor: "var(--sw-border)" }}>
      <ChannelConnectCard
        channel="whatsapp"
        label="WhatsApp"
        description="Your customers' primary channel"
        recommended={recommended === "whatsapp"}
        isConnected={connectedChannels.includes("whatsapp")}
        comingSoon={false}
        onConnect={(creds) => onConnectChannel("whatsapp", creds)}
        isConnecting={isConnecting}
      />
      <ChannelConnectCard
        channel="telegram"
        label="Telegram"
        description="Alternative messaging"
        recommended={recommended === "telegram"}
        isConnected={connectedChannels.includes("telegram")}
        comingSoon={false}
        onConnect={(creds) => onConnectChannel("telegram", creds)}
        isConnecting={isConnecting}
      />
      <ChannelConnectCard
        channel="webchat"
        label="Web Chat"
        description="Embed on your website"
        recommended={false}
        isConnected={false}
        comingSoon={true}
        onConnect={(creds) => onConnectChannel("webchat", creds)}
      />
    </div>
  );
}

export function GoLive({
  playbook,
  onLaunch,
  onBack,
  connectedChannels,
  scenariosTested: _scenariosTested,
  onConnectChannel,
  onLaunchComplete,
  isConnecting,
  connectError,
}: GoLiveProps) {
  const [launched, setLaunched] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const readiness = useReadiness("alex");
  const isReady = readiness.data?.ready ?? false;
  const recommended = playbook.channels.recommended ?? "whatsapp";

  const blockingChecks = readiness.data?.checks.filter((c) => c.blocking) ?? [];
  const advisoryChecks = readiness.data?.checks.filter((c) => !c.blocking) ?? [];

  if (launched) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "var(--sw-base)" }}
      >
        <LaunchSequence
          channel={connectedChannels[0] ?? "WhatsApp"}
          onComplete={onLaunchComplete}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div className="fixed left-6 top-6 z-10">
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center" style={{ paddingBottom: "10vh" }}>
        <div className="mx-auto w-full max-w-[520px] px-6 text-center">
          <div className="mb-8 flex justify-center">
            <AgentMark agent="alex" size="lg" />
          </div>
          <h1
            className="mb-10 text-[32px] font-semibold leading-[40px]"
            style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
          >
            Alex is ready for your business
          </h1>

          <div className="mb-8 text-left">
            <p
              className="mb-3 text-[13px] font-medium uppercase tracking-[0.05em]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              Required to launch
            </p>

            {readiness.isLoading ? (
              <div
                className="mb-4 flex items-center gap-2 text-[16px]"
                style={{ color: "var(--sw-text-muted)" }}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Checking readiness&hellip;</span>
              </div>
            ) : (
              blockingChecks.map((check) => <BlockingCheckRow key={check.id} check={check} />)
            )}

            <ChannelCards
              recommended={recommended}
              connectedChannels={connectedChannels}
              onConnectChannel={onConnectChannel}
              isConnecting={isConnecting}
            />
            {connectError && (
              <p className="mt-2 text-[14px]" style={{ color: "hsl(0, 70%, 50%)" }}>
                {connectError}
              </p>
            )}
          </div>

          {advisoryChecks.length > 0 && (
            <div className="mb-8 text-left">
              <p
                className="mb-3 text-[13px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--sw-text-muted)" }}
              >
                Recommended
              </p>
              {advisoryChecks.map((check) => (
                <AdvisoryCheckRow key={check.id} check={check} />
              ))}
            </div>
          )}

          <button
            onClick={async () => {
              setIsLaunching(true);
              try {
                await onLaunch();
                setLaunched(true);
              } catch {
                setIsLaunching(false);
              }
            }}
            disabled={!isReady || isLaunching}
            className="flex h-[52px] min-w-[200px] items-center justify-center gap-2 rounded-lg text-[16px] font-semibold transition-all duration-200"
            style={{
              backgroundColor: "var(--sw-accent)",
              color: "white",
              opacity: isReady && !isLaunching ? 1 : 0.35,
              cursor: isReady && !isLaunching ? "pointer" : "default",
              margin: "0 auto",
            }}
          >
            {isLaunching ? (
              "Launching..."
            ) : (
              <>
                <Zap className="h-4 w-4" />
                Launch Alex
              </>
            )}
          </button>
          {!isReady && !readiness.isLoading && (
            <p className="mt-2 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
              Resolve required checks to launch.
            </p>
          )}
          <div className="mt-4">
            <button
              onClick={onBack}
              className="text-[14px]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              &larr; Back to training
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
