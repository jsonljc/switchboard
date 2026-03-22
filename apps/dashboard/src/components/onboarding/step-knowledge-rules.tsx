"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Percent, AlertTriangle, Ban, PenLine } from "lucide-react";
import type { BehavioralRule } from "@/app/onboarding/page";

interface StepKnowledgeRulesProps {
  knowledgeText: string;
  onKnowledgeChange: (text: string) => void;
  rules: BehavioralRule[];
  onRulesChange: (rules: BehavioralRule[]) => void;
}

const RULE_TEMPLATES: Array<{
  type: BehavioralRule["type"];
  label: string;
  placeholder: string;
  icon: typeof Percent;
}> = [
  {
    type: "max-discount",
    label: "Max discount",
    placeholder: "e.g. 15",
    icon: Percent,
  },
  {
    type: "always-escalate",
    label: "Always escalate",
    placeholder: "e.g. billing disputes, refund requests",
    icon: AlertTriangle,
  },
  {
    type: "never-discuss",
    label: "Never discuss",
    placeholder: "e.g. competitor pricing, internal operations",
    icon: Ban,
  },
  {
    type: "custom",
    label: "Custom rule",
    placeholder: "e.g. Always recommend our premium package first",
    icon: PenLine,
  },
];

export function StepKnowledgeRules({
  knowledgeText,
  onKnowledgeChange,
  rules,
  onRulesChange,
}: StepKnowledgeRulesProps) {
  const addRule = (type: BehavioralRule["type"]) => {
    onRulesChange([...rules, { id: crypto.randomUUID(), type, value: "" }]);
  };

  const updateRule = (index: number, value: string) => {
    const updated = [...rules];
    updated[index] = { ...updated[index]!, value };
    onRulesChange(updated);
  };

  const removeRule = (index: number) => {
    onRulesChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Knowledge section */}
      <div className="space-y-2">
        <Label className="text-base">What should your agents know?</Label>
        <p className="text-[13px] text-muted-foreground">
          Paste your FAQ, services list, pricing, or anything your agents should reference when
          talking to customers. You can always add more later.
        </p>
        <Textarea
          placeholder="Paste your FAQ, service descriptions, pricing info, business hours, or any other information your agents should know..."
          value={knowledgeText}
          onChange={(e) => onKnowledgeChange(e.target.value)}
          rows={6}
          className="resize-y text-sm"
        />
        {knowledgeText && (
          <p className="text-[11px] text-muted-foreground">
            {knowledgeText.split(/\s+/).filter(Boolean).length} words
          </p>
        )}
      </div>

      {/* Rules section */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-base">Ground rules</Label>
          <p className="text-[13px] text-muted-foreground">
            Set boundaries for how your agents behave. These are enforced across all conversations.
          </p>
        </div>

        {/* Added rules */}
        {rules.map((rule, index) => {
          const template = RULE_TEMPLATES.find((t) => t.type === rule.type);
          return (
            <div key={rule.id} className="flex items-center gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {template?.label ?? rule.type}
                  </span>
                </div>
                <Input
                  placeholder={template?.placeholder}
                  value={rule.value}
                  onChange={(e) => updateRule(index, e.target.value)}
                  className="text-sm"
                />
              </div>
              <button
                onClick={() => removeRule(index)}
                aria-label="Remove rule"
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}

        {/* Add rule buttons */}
        <div className="flex flex-wrap gap-2">
          {RULE_TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <Button
                key={template.type}
                variant="outline"
                size="sm"
                onClick={() => addRule(template.type)}
                className="text-xs"
              >
                <Icon className="h-3 w-3 mr-1.5" />
                {template.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
