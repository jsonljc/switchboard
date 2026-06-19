"use client";
import { useEffect, useState } from "react";
import { CloudOff, WifiOff, Check } from "lucide-react";
import { StatePanel } from "./state-panel";

export interface StateProps {
  /** The agent (or "your team") the surface speaks for. */
  agentName?: string;
}

function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return offline;
}

/** §5: network offline + API/agent backend down — one offline-aware component. */
export function ConnectionTrouble({
  agentName = "your team",
  onRetry,
}: StateProps & { onRetry?: () => void }) {
  const offline = useIsOffline();
  if (offline) {
    return (
      <StatePanel
        role="alert"
        label="Connection problem"
        icon={<WifiOff />}
        title="You're offline."
        body="I'll hold your decisions here until you're back."
      />
    );
  }
  return (
    <StatePanel
      role="alert"
      label="Connection problem"
      icon={<CloudOff />}
      title={`I can't reach ${agentName} right now.`}
      body="Nothing you've approved is lost. I'll keep trying."
      onRetry={onRetry}
    />
  );
}

/** §5: designed empty / all-clear. Completion as reward, never a dead-account blank. */
export function AllClear({ sub }: { sub?: string }) {
  return (
    <StatePanel
      icon={<Check />}
      title="You're all caught up."
      body={sub ?? "Your team is on top of it."}
    />
  );
}
