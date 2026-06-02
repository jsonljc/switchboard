"use client";

import { Controller, type Control, type UseFormRegister } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WEEKDAYS, type BusinessFactsForm } from "./scaffold";

interface HoursSectionProps {
  control: Control<BusinessFactsForm>;
  register: UseFormRegister<BusinessFactsForm>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HoursSection({ control, register }: HoursSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Opening hours</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {WEEKDAYS.map((day) => (
          <Controller
            key={day}
            control={control}
            name={`openingHours.${day}.closed` as const}
            render={({ field: closedField }) => (
              <div className="flex items-center gap-3">
                <span className="w-24 text-sm">{cap(day)}</span>
                <Switch
                  checked={!closedField.value}
                  onCheckedChange={(open) => closedField.onChange(!open)}
                  aria-label={`Toggle ${cap(day)}`}
                />
                <Input
                  type="time"
                  aria-label={`${cap(day)} open`}
                  disabled={!!closedField.value}
                  className="w-32"
                  {...register(`openingHours.${day}.open` as const)}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="time"
                  aria-label={`${cap(day)} close`}
                  disabled={!!closedField.value}
                  className="w-32"
                  {...register(`openingHours.${day}.close` as const)}
                />
                {closedField.value && <span className="text-xs text-muted-foreground">Closed</span>}
              </div>
            )}
          />
        ))}
      </CardContent>
    </Card>
  );
}
