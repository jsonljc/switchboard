"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const steps = ["Business Info", "Spend Limits", "Risk Level", "Confirm"];

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    businessName: "",
    dailyLimit: "",
    weeklyLimit: "",
    monthlyLimit: "",
    riskLevel: "moderate",
  });

  if (status === "unauthenticated") redirect("/login");

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principalId: (session as any)?.principalId ?? "",
          organizationId: (session as any)?.organizationId ?? "",
          name: formData.businessName,
          description: `AI agent for ${formData.businessName}`,
          globalSpendLimits: {
            daily: formData.dailyLimit ? Number(formData.dailyLimit) : null,
            weekly: formData.weeklyLimit ? Number(formData.weeklyLimit) : null,
            monthly: formData.monthlyLimit ? Number(formData.monthlyLimit) : null,
            perAction: null,
          },
          riskTolerance: formData.riskLevel === "conservative"
            ? { none: "none", low: "none", medium: "standard", high: "elevated", critical: "mandatory" }
            : formData.riskLevel === "aggressive"
            ? { none: "none", low: "none", medium: "none", high: "none", critical: "standard" }
            : { none: "none", low: "none", medium: "none", high: "standard", critical: "elevated" },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create identity");
      }
      router.push("/");
    } catch (err: any) {
      toast({
        title: "Setup failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Get Started</CardTitle>
          <CardDescription>
            Step {step + 1} of {steps.length}: {steps[step]}
          </CardDescription>
          <div className="flex gap-1 mt-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name</Label>
                <Input
                  id="businessName"
                  placeholder="Your business name"
                  value={formData.businessName}
                  onChange={(e) => updateField("businessName", e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dailyLimit">Daily Spend Limit ($)</Label>
                <Input
                  id="dailyLimit"
                  type="number"
                  placeholder="e.g. 100"
                  value={formData.dailyLimit}
                  onChange={(e) => updateField("dailyLimit", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weeklyLimit">Weekly Spend Limit ($)</Label>
                <Input
                  id="weeklyLimit"
                  type="number"
                  placeholder="e.g. 500"
                  value={formData.weeklyLimit}
                  onChange={(e) => updateField("weeklyLimit", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthlyLimit">Monthly Spend Limit ($)</Label>
                <Input
                  id="monthlyLimit"
                  type="number"
                  placeholder="e.g. 2000"
                  value={formData.monthlyLimit}
                  onChange={(e) => updateField("monthlyLimit", e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <RadioGroup
              value={formData.riskLevel}
              onValueChange={(v) => updateField("riskLevel", v)}
              className="space-y-3"
            >
              {[
                { value: "conservative", label: "Conservative", desc: "Approve most actions manually" },
                { value: "moderate", label: "Moderate", desc: "Auto-approve low/medium risk" },
                { value: "aggressive", label: "Aggressive", desc: "Only approve critical actions" },
              ].map((opt) => (
                <div key={opt.value} className="flex items-start gap-3 p-3 rounded-lg border">
                  <RadioGroupItem value={opt.value} id={opt.value} className="mt-0.5" />
                  <Label htmlFor={opt.value} className="cursor-pointer">
                    <span className="font-medium">{opt.label}</span>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">Business: {formData.businessName || "Not set"}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">
                  Limits: ${formData.dailyLimit || "\u221E"}/day, ${formData.weeklyLimit || "\u221E"}/week, ${formData.monthlyLimit || "\u221E"}/month
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">Risk level: {formData.riskLevel}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-6">
            {step > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep(step - 1)}
                className="flex-1 min-h-[44px]"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}
            {step < steps.length - 1 ? (
              <Button
                onClick={() => setStep(step + 1)}
                className="flex-1 min-h-[44px]"
                disabled={step === 0 && !formData.businessName}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                className="flex-1 min-h-[44px]"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Setting up..." : "Complete Setup"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
