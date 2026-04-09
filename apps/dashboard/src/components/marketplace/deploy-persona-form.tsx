"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PersonaFormData {
  businessName: string;
  businessType: string;
  productService: string;
  valueProposition: string;
  tone: "casual" | "professional" | "consultative";
  qualificationCriteria: Record<string, unknown>;
  disqualificationCriteria: Record<string, unknown>;
  escalationRules: Record<string, unknown>;
  bookingLink?: string;
  customInstructions?: string;
}

interface DeployPersonaFormProps {
  onSubmit: (data: PersonaFormData) => void;
  isSubmitting: boolean;
  defaultValues?: Partial<PersonaFormData>;
}

const TONE_OPTIONS = [
  { value: "casual" as const, label: "Casual", desc: "Friendly, relaxed, emoji-okay" },
  { value: "professional" as const, label: "Professional", desc: "Polished, clear, business-like" },
  { value: "consultative" as const, label: "Consultative", desc: "Advisory, thoughtful, expert" },
];

const ESCALATION_PRESETS = [
  { key: "onFrustration", label: "Lead expresses frustration or anger" },
  { key: "onCompetitorMention", label: "Lead mentions a competitor" },
  { key: "onHumanRequest", label: "Lead asks to speak to a human" },
  { key: "onOutOfScope", label: "Question is outside agent's knowledge" },
];

export function DeployPersonaForm({
  onSubmit,
  isSubmitting,
  defaultValues,
}: DeployPersonaFormProps) {
  const [businessName, setBusinessName] = useState(defaultValues?.businessName ?? "");
  const [businessType, setBusinessType] = useState(defaultValues?.businessType ?? "");
  const [productService, setProductService] = useState(defaultValues?.productService ?? "");
  const [valueProposition, setValueProposition] = useState(defaultValues?.valueProposition ?? "");
  const [tone, setTone] = useState<PersonaFormData["tone"]>(defaultValues?.tone ?? "professional");
  const [bookingLink, setBookingLink] = useState(defaultValues?.bookingLink ?? "");
  const [customInstructions, setCustomInstructions] = useState(
    defaultValues?.customInstructions ?? "",
  );
  const [escalationKeys, setEscalationKeys] = useState<string[]>(
    Object.keys(defaultValues?.escalationRules ?? { onFrustration: true, onHumanRequest: true }),
  );

  const canSubmit =
    businessName.trim() && businessType.trim() && productService.trim() && valueProposition.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    const escalationRules: Record<string, boolean> = {};
    for (const key of escalationKeys) {
      escalationRules[key] = true;
    }
    onSubmit({
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      productService: productService.trim(),
      valueProposition: valueProposition.trim(),
      tone,
      qualificationCriteria: {},
      disqualificationCriteria: {},
      escalationRules,
      bookingLink: bookingLink.trim() || undefined,
      customInstructions: customInstructions.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input
            id="businessName"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Acme Corp"
          />
        </div>
        <div>
          <Label htmlFor="businessType">Business type</Label>
          <Input
            id="businessType"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            placeholder="SaaS, Agency, E-commerce..."
          />
        </div>
        <div>
          <Label htmlFor="productService">What you sell</Label>
          <Input
            id="productService"
            value={productService}
            onChange={(e) => setProductService(e.target.value)}
            placeholder="Project management software"
          />
        </div>
        <div>
          <Label htmlFor="valueProposition">Value proposition</Label>
          <Textarea
            id="valueProposition"
            value={valueProposition}
            onChange={(e) => setValueProposition(e.target.value)}
            placeholder="Ship projects 2x faster with half the meetings"
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tone</Label>
        <div className="grid grid-cols-3 gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={tone === opt.value}
              onClick={() => setTone(opt.value)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                tone === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <p className="font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Escalation rules</Label>
        <p className="text-xs text-muted-foreground">When should the agent hand off to you?</p>
        <div className="space-y-2">
          {ESCALATION_PRESETS.map((preset) => (
            <label key={preset.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={escalationKeys.includes(preset.key)}
                onChange={(e) => {
                  setEscalationKeys((prev) =>
                    e.target.checked ? [...prev, preset.key] : prev.filter((k) => k !== preset.key),
                  );
                }}
                className="rounded border-border"
              />
              {preset.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="bookingLink">Booking link (optional)</Label>
        <Input
          id="bookingLink"
          value={bookingLink}
          onChange={(e) => setBookingLink(e.target.value)}
          placeholder="https://cal.com/you"
        />
      </div>

      <div>
        <Label htmlFor="customInstructions">Custom instructions (optional)</Label>
        <Textarea
          id="customInstructions"
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Always mention our 14-day free trial..."
          rows={3}
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit || isSubmitting}
        className="w-full min-h-[44px]"
      >
        {isSubmitting ? "Deploying..." : "Deploy Sales Pipeline"}
      </Button>
    </div>
  );
}
