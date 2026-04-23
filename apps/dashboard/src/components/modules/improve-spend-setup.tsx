"use client";

import { useState } from "react";

type Step = "connect-meta" | "select-account" | "set-targets" | "connect-capi" | "activate";

const STEPS: Step[] = ["connect-meta", "select-account", "set-targets", "connect-capi", "activate"];

interface ImproveSpendSetupProps {
  initialStep?: string;
  onComplete: () => void;
}

export function ImproveSpendSetup({ initialStep, onComplete }: ImproveSpendSetupProps) {
  const [currentStep, setCurrentStep] = useState<Step>(
    STEPS.includes(initialStep as Step) ? (initialStep as Step) : "connect-meta",
  );

  const currentIndex = STEPS.indexOf(currentStep);

  function goNext() {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      setCurrentStep(STEPS[idx + 1]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="flex gap-1.5">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= currentIndex ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step: connect-meta */}
      {currentStep === "connect-meta" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Connect Meta Ads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with Facebook to grant access to your ad accounts.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            Facebook OAuth flow will be initiated here
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: select-account */}
      {currentStep === "select-account" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Select ad account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose which ad account Switchboard should optimize.
            </p>
          </div>
          <div className="space-y-2">
            {["Ad Account 1 (act_123456)", "Ad Account 2 (act_789012)"].map((account) => (
              <button
                key={account}
                type="button"
                className="w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted transition-colors"
              >
                {account}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: set-targets */}
      {currentStep === "set-targets" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Set optimization targets</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Define your target CPA, ROAS, and monthly budget so Switchboard can optimize toward
              your goals.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Target CPA, ROAS, and monthly budget form will be rendered here
          </div>
          <button
            type="button"
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: connect-capi */}
      {currentStep === "connect-capi" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Connect Conversions API</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optionally provide your Pixel ID to enable server-side event tracking via CAPI.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Pixel ID input will be rendered here
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Connect
            </button>
          </div>
        </div>
      )}

      {/* Step: activate */}
      {currentStep === "activate" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Activate Improve Spend</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Switchboard will run a weekly optimization cycle and daily budget pacing checks to
              keep your campaigns on track.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Scheduled automations</p>
            <ul className="mt-2 space-y-1">
              <li>Weekly: full optimization review and bid adjustments</li>
              <li>Daily: budget pacing checks and overspend alerts</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={onComplete}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Enable module
          </button>
        </div>
      )}
    </div>
  );
}
