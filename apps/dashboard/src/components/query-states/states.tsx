"use client";
import { useEffect, useState } from "react";

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

function StatePanel({
  title,
  body,
  role = "status",
  label,
  children,
}: {
  title: string;
  body: string;
  /** "alert" for genuine failures (assertive), "status" for calm empty/all-clear. */
  role?: "status" | "alert";
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={role}
      aria-label={label}
      className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center"
    >
      <p className="text-foreground text-[0.95rem] font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{body}</p>
      {children}
    </div>
  );
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
        title="You're offline."
        body="I'll hold your decisions here until you're back."
      />
    );
  }
  return (
    <StatePanel
      role="alert"
      label="Connection problem"
      title={`I can't reach ${agentName} right now.`}
      body="Nothing you've approved is lost — I'll keep trying."
    >
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[hsl(var(--action))] text-sm font-medium underline underline-offset-2"
        >
          Try again
        </button>
      ) : null}
    </StatePanel>
  );
}

/** §5: designed empty / all-clear — completion as reward, never a dead-account blank. */
export function AllClear({ sub }: { sub?: string }) {
  return <StatePanel title="You're all caught up." body={sub ?? "Your team is on top of it."} />;
}

/** §5: agent halted / paused — not an empty feed that looks broken. */
export function AgentPaused({ agentName = "Your team" }: StateProps) {
  return (
    <StatePanel
      title={`${agentName} is paused.`}
      body="Resume when you're ready — nothing new will go out until you do."
    />
  );
}
