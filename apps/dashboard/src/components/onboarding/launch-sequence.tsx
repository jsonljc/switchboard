"use client";

import { useState, useEffect } from "react";

type LaunchPhase = "launching" | "channel_live" | "status" | "test_lead" | "done";

interface LaunchSequenceProps {
  channel: string;
  onComplete: () => void;
}

export function LaunchSequence({ channel, onComplete }: LaunchSequenceProps) {
  const [phase, setPhase] = useState<LaunchPhase>("launching");

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("channel_live"), 600),
      setTimeout(() => setPhase("status"), 1200),
      setTimeout(() => setPhase("test_lead"), 2500),
      setTimeout(() => setPhase("done"), 3500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="space-y-6 text-center">
      {(phase === "channel_live" ||
        phase === "status" ||
        phase === "test_lead" ||
        phase === "done") && (
        <p
          className="text-[14px] transition-opacity duration-300"
          style={{ color: "hsl(145, 45%, 42%)" }}
        >
          <span
            className="mr-1 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(145, 45%, 42%)" }}
          />{" "}
          Live
        </p>
      )}
      {(phase === "status" || phase === "test_lead" || phase === "done") && (
        <p className="text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
          <span
            className="mr-2 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(145, 45%, 42%)" }}
          />
          Alex is live on {channel}
        </p>
      )}
      {(phase === "test_lead" || phase === "done") && (
        <div
          className="mx-auto max-w-[400px] rounded-xl border p-5 text-left"
          style={{ backgroundColor: "var(--sw-surface-raised)", borderColor: "var(--sw-border)" }}
        >
          <p
            className="mb-2 text-[12px] font-medium uppercase tracking-[0.05em]"
            style={{ color: "var(--sw-text-muted)" }}
          >
            Test lead
          </p>
          <p className="mb-4 text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
            &ldquo;Hi, I saw your clinic online — do you do teeth whitening?&rdquo;
          </p>
          <button className="text-[14px]" style={{ color: "var(--sw-accent)" }}>
            See Alex&apos;s response →
          </button>
        </div>
      )}
      {phase === "done" && (
        <button
          onClick={onComplete}
          className="text-[14px]"
          style={{ color: "var(--sw-text-secondary)" }}
        >
          Go to your dashboard →
        </button>
      )}
    </div>
  );
}
