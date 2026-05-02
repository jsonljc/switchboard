"use client";

import { useWelcomeBanner } from "./use-welcome-banner";

export function WelcomeBanner() {
  const { dismissed, dismiss, tour } = useWelcomeBanner();
  if (dismissed) return null;

  return (
    <div className="welcome">
      <div className="welcome-icon">SB</div>
      <div className="welcome-body">
        <h2>Welcome to your Switchboard.</h2>
        <p>
          Three agents are running on your behalf. They handle routine work autonomously and surface
          here only when they need a decision. Anything in <b>Queue</b> below is waiting on you.
          Everything else is in motion.
        </p>
        <div className="welcome-tour">
          <button type="button" className="step" onClick={() => tour("queue")}>
            <b>1.</b> Decide what's in queue
          </button>
          <button type="button" className="step" onClick={() => tour("agents")}>
            <b>2.</b> Check what each agent is doing
          </button>
          <button type="button" className="step" onClick={() => tour("activity")}>
            <b>3.</b> Scan the activity trail
          </button>
        </div>
      </div>
      <button
        type="button"
        className="welcome-close"
        onClick={dismiss}
        aria-label="Dismiss welcome"
      >
        Got it ✕
      </button>
    </div>
  );
}
