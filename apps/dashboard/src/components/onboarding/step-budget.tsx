"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface StepBudgetProps {
  monthlyBudget: number;
  onBudgetChange: (budget: number) => void;
}

const MIN_BUDGET = 200;
const MAX_BUDGET = 5000;
const STEP = 50;

export function StepBudget({ monthlyBudget, onBudgetChange }: StepBudgetProps) {
  const dailyBudget = Math.round((monthlyBudget / 30) * 100) / 100;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="budget-slider">What&apos;s your monthly ad budget?</Label>
        <p className="text-xs text-muted-foreground">
          This helps us set spend limits and pace your campaigns. You can change this anytime.
        </p>
      </div>

      <div className="space-y-4">
        <div className="text-center">
          <span className="text-3xl font-bold">${monthlyBudget.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground ml-1">/ month</span>
        </div>

        <input
          id="budget-slider"
          type="range"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={STEP}
          value={monthlyBudget}
          onChange={(e) => onBudgetChange(Number(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary"
        />

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>${MIN_BUDGET}</span>
          <span>${MAX_BUDGET.toLocaleString()}</span>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Daily budget</span>
          <span className="font-medium">${dailyBudget.toFixed(2)}/day</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Weekly budget</span>
          <span className="font-medium">${(dailyBudget * 7).toFixed(0)}/week</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="budget-custom" className="text-xs">
          Or enter a specific amount
        </Label>
        <Input
          id="budget-custom"
          type="number"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={STEP}
          value={monthlyBudget}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (val >= MIN_BUDGET && val <= MAX_BUDGET) {
              onBudgetChange(val);
            }
          }}
          className="text-sm"
        />
      </div>
    </div>
  );
}
