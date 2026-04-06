// apps/dashboard/src/components/marketplace/review-persona-step.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WizardStepProps, PersonaInput } from "./deploy-wizard-shell";

const ESCALATION_LABELS: Record<string, string> = {
  frustrated: "They're frustrated or upset",
  askForPerson: "They ask to speak to a person",
  mentionCompetitor: "They mention a competitor",
  outsideKnowledge: "Question outside my knowledge",
};

export function ReviewPersonaStep({ data, onUpdate, onNext }: WizardStepProps) {
  const persona = data.persona;
  if (!persona) return <p className="text-muted-foreground">No persona data. Go back and scan.</p>;

  const [qualificationCriteria, setQualificationCriteria] = useState(
    typeof persona.qualificationCriteria?.description === "string"
      ? persona.qualificationCriteria.description
      : "",
  );
  const [neverSay, setNeverSay] = useState(persona.customInstructions ?? "");
  const [bookingLink, setBookingLink] = useState(persona.bookingLink ?? "");
  const [escalationRules, setEscalationRules] = useState<Record<string, boolean>>(
    Object.fromEntries(
      Object.keys(ESCALATION_LABELS).map((key) => [key, persona.escalationRules[key] === true]),
    ),
  );

  function handleContinue() {
    if (!persona) return; // Type guard for safety
    const updated: PersonaInput = {
      businessName: persona.businessName,
      businessType: persona.businessType,
      productService: persona.productService,
      valueProposition: persona.valueProposition,
      tone: persona.tone,
      qualificationCriteria: qualificationCriteria ? { description: qualificationCriteria } : {},
      disqualificationCriteria: persona.disqualificationCriteria,
      escalationRules,
      bookingLink: bookingLink || null,
      customInstructions: neverSay ? `Never say: ${neverSay}` : null,
    };
    onUpdate({ persona: updated });
    onNext();
  }

  return (
    <div className="space-y-6">
      {/* AI summary */}
      <div className="bg-surface-raised rounded-lg p-4">
        <p className="text-sm text-foreground">
          You're <strong>{persona.businessName}</strong>. You sell{" "}
          {persona.productService.toLowerCase()}. Your vibe is {persona.tone.toLowerCase()}.
        </p>
      </div>

      <div className="border-t border-border pt-6 space-y-5">
        <p className="text-sm font-medium text-foreground">
          A few things that'll help me do great work:
        </p>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            What makes someone a good lead for you?
          </label>
          <Input
            value={qualificationCriteria}
            onChange={(e) => setQualificationCriteria(e.target.value)}
            placeholder="Planning a wedding or event, budget over $300..."
          />
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-2">
            When should I hand off to you?
          </label>
          <div className="space-y-2">
            {Object.entries(ESCALATION_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={escalationRules[key] ?? false}
                  onChange={(e) =>
                    setEscalationRules((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="rounded border-border"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            Anything I should never say?
          </label>
          <Input
            value={neverSay}
            onChange={(e) => setNeverSay(e.target.value)}
            placeholder="Never promise same-week delivery..."
          />
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">Got a booking link?</label>
          <Input
            type="url"
            value={bookingLink}
            onChange={(e) => setBookingLink(e.target.value)}
            placeholder="https://cal.com/yourbusiness"
          />
        </div>
      </div>

      <Button onClick={handleContinue} size="lg" className="w-full">
        Continue
      </Button>
    </div>
  );
}
