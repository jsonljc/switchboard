"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const spendLimitsSchema = z.object({
  daily: z.coerce.number().nonnegative().nullable(),
  weekly: z.coerce.number().nonnegative().nullable(),
  monthly: z.coerce.number().nonnegative().nullable(),
  perAction: z.coerce.number().nonnegative().nullable(),
});

type SpendLimitsValues = z.infer<typeof spendLimitsSchema>;

interface SpendLimitsFormProps {
  defaultValues: SpendLimitsValues;
  onSubmit: (values: SpendLimitsValues) => void;
  isLoading?: boolean;
}

export function SpendLimitsForm({ defaultValues, onSubmit, isLoading }: SpendLimitsFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<SpendLimitsValues>({
    resolver: zodResolver(spendLimitsSchema),
    defaultValues,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Spend Limits</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {(["daily", "weekly", "monthly", "perAction"] as const).map((field) => (
            <div key={field} className="space-y-1">
              <Label htmlFor={field}>
                {field === "perAction" ? "Per Action" : field.charAt(0).toUpperCase() + field.slice(1)} Limit ($)
              </Label>
              <Input
                id={field}
                type="number"
                step="0.01"
                min="0"
                placeholder="No limit"
                {...register(field, { setValueAs: (v) => (v === "" ? null : Number(v)) })}
              />
              {errors[field] && (
                <p className="text-xs text-destructive">{errors[field]?.message}</p>
              )}
            </div>
          ))}
          <Button type="submit" disabled={isLoading} className="w-full min-h-[44px]">
            {isLoading ? "Saving..." : "Save Spend Limits"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
