"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RuleBuilder } from "./rule-builder";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Policy } from "@switchboard/schemas";

const policyRuleSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    composition: z.enum(["AND", "OR", "NOT"]).optional(),
    conditions: z.array(z.object({
      field: z.string(),
      operator: z.string(),
      value: z.unknown(),
    })).optional(),
    children: z.array(policyRuleSchema).optional(),
  })
);

const policyFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  effect: z.enum(["allow", "deny", "modify", "require_approval"]),
  priority: z.coerce.number().int().min(0, "Priority must be 0 or greater"),
  active: z.boolean(),
  cartridgeId: z.string().nullable(),
  organizationId: z.string().nullable(),
  approvalRequirement: z.enum(["none", "standard", "elevated", "mandatory"]).optional(),
  riskCategoryOverride: z.enum(["none", "low", "medium", "high", "critical"]).optional(),
  rule: policyRuleSchema,
  effectParams: z.string().optional(),
});

type PolicyFormValues = z.infer<typeof policyFormSchema>;

interface PolicyFormProps {
  policy?: Policy;
  onSubmit: (values: any) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const DEFAULT_RULE = {
  composition: "AND" as const,
  conditions: [{ field: "", operator: "eq", value: "" }],
};

export function PolicyForm({ policy, onSubmit, onCancel, isLoading }: PolicyFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
      name: policy?.name ?? "",
      description: policy?.description ?? "",
      effect: policy?.effect ?? "deny",
      priority: policy?.priority ?? 100,
      active: policy?.active ?? true,
      cartridgeId: policy?.cartridgeId ?? null,
      organizationId: policy?.organizationId ?? null,
      approvalRequirement: policy?.approvalRequirement ?? undefined,
      riskCategoryOverride: policy?.riskCategoryOverride ?? undefined,
      rule: policy?.rule ?? DEFAULT_RULE,
      effectParams: policy?.effectParams ? JSON.stringify(policy.effectParams, null, 2) : "",
    },
  });

  const effect = watch("effect");

  const handleFormSubmit = (values: PolicyFormValues) => {
    const { effectParams, riskCategoryOverride, approvalRequirement, cartridgeId, ...rest } = values;

    const payload: Record<string, unknown> = {
      ...rest,
      cartridgeId: cartridgeId || null,
      organizationId: values.organizationId || null,
    };

    if (approvalRequirement && approvalRequirement !== "none") {
      payload.approvalRequirement = approvalRequirement;
    }

    if (riskCategoryOverride && riskCategoryOverride !== "none") {
      payload.riskCategoryOverride = riskCategoryOverride;
    }

    if (effectParams) {
      try {
        payload.effectParams = JSON.parse(effectParams);
      } catch {
        // leave as undefined if invalid JSON
      }
    }

    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} placeholder="e.g. Block high-value transfers" />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <Input id="description" {...register("description")} placeholder="What this policy does" />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Effect</Label>
        <Controller
          name="effect"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="deny">Deny</SelectItem>
                <SelectItem value="modify">Modify</SelectItem>
                <SelectItem value="require_approval">Require Approval</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="priority">Priority</Label>
        <Input id="priority" type="number" min="0" {...register("priority")} />
        {errors.priority && <p className="text-xs text-destructive">{errors.priority.message}</p>}
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="active">Active</Label>
        <Controller
          name="active"
          control={control}
          render={({ field }) => (
            <Switch
              id="active"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cartridgeId">Cartridge scope</Label>
        <Input
          id="cartridgeId"
          placeholder="All cartridges"
          {...register("cartridgeId", { setValueAs: (v) => v || null })}
        />
      </div>

      {effect === "require_approval" && (
        <div className="space-y-1">
          <Label>Approval requirement</Label>
          <Controller
            name="approvalRequirement"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? "none"} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="elevated">Elevated</SelectItem>
                  <SelectItem value="mandatory">Mandatory</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label>Risk category override</Label>
        <Controller
          name="riskCategoryOverride"
          control={control}
          render={({ field }) => (
            <Select value={field.value ?? "none"} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label>Conditions</Label>
        <Controller
          name="rule"
          control={control}
          render={({ field }) => (
            <RuleBuilder value={field.value} onChange={field.onChange} />
          )}
        />
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Effect parameters (advanced)
        </button>
        {showAdvanced && (
          <div className="space-y-1">
            <textarea
              className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder='{ "key": "value" }'
              {...register("effectParams")}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 min-h-[44px]" disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 min-h-[44px]" disabled={isLoading}>
          {isLoading ? "Saving..." : policy ? "Update Policy" : "Create Policy"}
        </Button>
      </div>
    </form>
  );
}
