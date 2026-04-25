"use client";

import { useState, useEffect } from "react";

type LaunchPhase = "launching" | "channel_live" | "status" | "done";

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
      setTimeout(() => setPhase("done"), 2200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="space-y-6 text-center">
      {(phase === "channel_live" || phase === "status" || phase === "done") && (
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
      {(phase === "status" || phase === "done") && (
        <p className="text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
          <span
            className="mr-2 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(145, 45%, 42%)" }}
          />
          Alex is now live on {channel}
        </p>
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
