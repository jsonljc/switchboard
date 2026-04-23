"use client";

import { useState } from "react";

type Step = "scheduling-mode" | "connect-calendar" | "business-hours" | "activate";

const ALL_STEPS: Step[] = ["scheduling-mode", "connect-calendar", "business-hours", "activate"];
const LOCAL_STEPS: Step[] = ["scheduling-mode", "business-hours", "activate"];

interface ConvertLeadsSetupProps {
  initialStep?: string;
  onComplete: () => void;
}

export function ConvertLeadsSetup({ initialStep, onComplete }: ConvertLeadsSetupProps) {
  const [mode, setMode] = useState<"google" | "local" | null>(null);
  const [currentStep, setCurrentStep] = useState<Step>(
    ALL_STEPS.includes(initialStep as Step) ? (initialStep as Step) : "scheduling-mode",
  );

  const steps = mode === "local" ? LOCAL_STEPS : ALL_STEPS;
  const currentIndex = steps.indexOf(currentStep);

  function goNext() {
    if (currentStep === "scheduling-mode" && mode === "local") {
      setCurrentStep("business-hours");
      return;
    }
    const idx = steps.indexOf(currentStep);
    if (idx < steps.length - 1) {
      setCurrentStep(steps[idx + 1]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="flex gap-1.5">
        {steps.map((step, i) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= currentIndex ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step: scheduling-mode */}
      {currentStep === "scheduling-mode" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Choose scheduling mode</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              How should Switchboard manage your calendar?
            </p>
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setMode("google")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                mode === "google" ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
              }`}
            >
              <p className="font-medium">Google Calendar</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sync availability and create bookings automatically
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("local")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                mode === "local" ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
              }`}
            >
              <p className="font-medium">Local scheduling</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use business hours only, no external calendar
              </p>
            </button>
          </div>
          <button
            type="button"
            disabled={!mode}
            onClick={goNext}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: connect-calendar */}
      {currentStep === "connect-calendar" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Connect Google Calendar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Grant access so Switchboard can read availability and create events.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            OAuth flow will be wired when Google Calendar credentials are provisioned
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

      {/* Step: business-hours */}
      {currentStep === "business-hours" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Set business hours</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure your timezone and when you accept bookings.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Business hours configuration form will be rendered here
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

      {/* Step: activate */}
      {currentStep === "activate" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Activate Convert Leads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything is configured. Enable the module to start converting leads into bookings.
            </p>
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
