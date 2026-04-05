"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { scanWebsite } from "@/app/(auth)/deploy/[slug]/actions";

interface BusinessProfile {
  businessName: string;
  whatTheySell: string;
  valueProposition: string;
  tone: string;
  pricingRange: string;
}

interface DeployWizardProps {
  agentName: string;
  bundleSlug: string;
  roleFocus: RoleFocus;
}

export function DeployWizard({ agentName, bundleSlug: _bundleSlug, roleFocus }: DeployWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<"scan" | "review">("scan");
  const [url, setUrl] = useState("");
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [isScanning, startScan] = useTransition();
  const [isDeploying, startDeploy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Brief fields
  const [qualificationCriteria, setQualificationCriteria] = useState("");
  const [neverSay, setNeverSay] = useState("");
  const [bookingLink, setBookingLink] = useState("");
  const [escalationRules, setEscalationRules] = useState({
    frustrated: true,
    askForPerson: true,
    mentionCompetitor: false,
    outsideKnowledge: false,
  });

  function handleScan() {
    setError(null);
    startScan(async () => {
      try {
        const result = await scanWebsite(url);
        setProfile(result);
        setStep("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to scan website");
      }
    });
  }

  function handleDeploy() {
    if (!profile) return;
    startDeploy(async () => {
      try {
        const persona = {
          businessName: profile.businessName,
          businessType: "small_business",
          productService: profile.whatTheySell,
          valueProposition: profile.valueProposition,
          tone: profile.tone === "warm" ? "casual" : "professional",
          qualificationCriteria: { description: qualificationCriteria },
          disqualificationCriteria: {},
          escalationRules,
          bookingLink: bookingLink || null,
          customInstructions: neverSay ? `Never say: ${neverSay}` : null,
        };

        const res = await fetch("/api/dashboard/marketplace/persona/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(persona),
        });

        if (!res.ok) throw new Error("Deploy failed");
        router.push("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deploy failed");
      }
    });
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 shrink-0">
          <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">
            {step === "scan" ? `Let's get ${agentName} up to speed.` : "Here's what I learned:"}
          </h2>
        </div>
      </div>

      {step === "scan" && (
        <div className="space-y-4">
          <p className="text-muted-foreground">First, your website — I'll study up.</p>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://yourbusiness.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isScanning}
            />
            <Button onClick={handleScan} disabled={!url || isScanning}>
              {isScanning ? "Learning..." : "Learn my business"}
            </Button>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
      )}

      {step === "review" && profile && (
        <div className="space-y-6">
          {/* AI summary */}
          <div className="bg-surface-raised rounded-lg p-4">
            <p className="text-sm text-foreground">
              You're <strong>{profile.businessName}</strong>. You sell{" "}
              {profile.whatTheySell.toLowerCase()}. Your vibe is {profile.tone.toLowerCase()}.{" "}
              {profile.pricingRange && `Orders range ${profile.pricingRange}.`}
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
                {Object.entries({
                  frustrated: "They're frustrated or upset",
                  askForPerson: "They ask to speak to a person",
                  mentionCompetitor: "They mention a competitor",
                  outsideKnowledge: "Question outside my knowledge",
                }).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={escalationRules[key as keyof typeof escalationRules]}
                      onChange={(e) =>
                        setEscalationRules((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
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
              <label className="text-sm text-muted-foreground block mb-1">
                Got a booking link?
              </label>
              <Input
                type="url"
                value={bookingLink}
                onChange={(e) => setBookingLink(e.target.value)}
                placeholder="https://cal.com/yourbusiness"
              />
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <Button onClick={handleDeploy} disabled={isDeploying} size="lg" className="w-full">
              {isDeploying ? "Deploying..." : "Deploy — I'm ready to start"}
            </Button>
            {error && <p className="text-sm text-negative mt-2">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
