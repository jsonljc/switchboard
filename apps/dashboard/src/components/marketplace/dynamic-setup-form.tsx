"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface SetupField {
  key: string;
  type: "text" | "textarea" | "select" | "url" | "toggle";
  label: string;
  required: boolean;
  options?: string[];
  default?: string;
  prefillFrom?: string;
}

interface SetupStep {
  id: string;
  title: string;
  fields: SetupField[];
}

interface DynamicSetupFormProps {
  steps: SetupStep[];
  scannedProfile?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
  onBack?: () => void;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function buildInitialValues(
  steps: SetupStep[],
  scannedProfile?: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const step of steps) {
    for (const field of step.fields) {
      if (field.prefillFrom && scannedProfile) {
        const prefilled = getNestedValue(scannedProfile, field.prefillFrom);
        if (prefilled !== undefined) {
          values[field.key] = prefilled;
          continue;
        }
      }
      if (field.default !== undefined) {
        values[field.key] = field.default;
      } else if (field.type === "toggle") {
        values[field.key] = false;
      } else {
        values[field.key] = "";
      }
    }
  }
  return values;
}

export function DynamicSetupForm({
  steps,
  scannedProfile,
  onSubmit,
  onBack,
}: DynamicSetupFormProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    buildInitialValues(steps, scannedProfile),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const setValue = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validateStep = useCallback(
    (stepIndex: number): boolean => {
      const s = steps[stepIndex];
      if (!s) return true;
      const newErrors: Record<string, string> = {};
      for (const field of s.fields) {
        if (!field.required) continue;
        const val = values[field.key];
        if (field.type === "toggle") continue;
        if (val === undefined || val === null || String(val).trim() === "") {
          newErrors[field.key] = `${field.label} is required`;
        }
      }
      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [steps, values],
  );

  const handleNext = useCallback(() => {
    if (!validateStep(currentStep)) return;
    if (isLastStep) {
      onSubmit(values);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, isLastStep, onSubmit, validateStep, values]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    } else {
      onBack?.();
    }
  }, [currentStep, onBack]);

  if (!step) return null;

  return (
    <div className="space-y-6">
      {/* Step header */}
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">
          Step {currentStep + 1} of {steps.length}
        </p>
        <div className="flex gap-1 mb-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <h3 className="text-base font-semibold">{step.title}</h3>
      </div>

      {/* Fields */}
      <div className="space-y-4">
        {step.fields.map((field) => (
          <FieldRenderer
            key={field.key}
            field={field}
            value={values[field.key]}
            error={errors[field.key]}
            onChange={(val) => setValue(field.key, val)}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        {currentStep > 0 || onBack ? (
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        ) : (
          <div />
        )}
        <Button onClick={handleNext}>
          {isLastStep ? "Save" : "Next"}
          {!isLastStep && <ChevronRight className="h-4 w-4 ml-1" />}
        </Button>
      </div>
    </div>
  );
}

interface FieldRendererProps {
  field: SetupField;
  value: unknown;
  error?: string;
  onChange: (val: unknown) => void;
}

function FieldRenderer({ field, value, error, onChange }: FieldRendererProps) {
  const id = `field-${field.key}`;

  if (field.type === "toggle") {
    return (
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Switch id={id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked)} />
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(val) => onChange(val)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={error ? "border-destructive" : ""}
        />
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>
    );
  }

  // text | url
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        id={id}
        type={field.type === "url" ? "url" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={error ? "border-destructive" : ""}
      />
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
