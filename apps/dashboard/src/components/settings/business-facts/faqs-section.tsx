"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useFormContext, type Control, type UseFormRegister } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { type BusinessFactsForm } from "./scaffold";

interface FaqsSectionProps {
  control: Control<BusinessFactsForm>;
  register: UseFormRegister<BusinessFactsForm>;
}

export function FaqsSection({ control, register }: FaqsSectionProps) {
  const {
    formState: { errors },
  } = useFormContext<BusinessFactsForm>();
  const { fields, append, remove } = useFieldArray({ control, name: "additionalFaqs" });
  const [open, setOpen] = useState(false);

  const hasFaqError = !!errors.additionalFaqs;
  useEffect(() => {
    if (hasFaqError) setOpen(true);
  }, [hasFaqError]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Additional FAQs</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "Collapse" : `${fields.length} FAQ${fields.length === 1 ? "" : "s"}`}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {fields.map((field, i) => (
            <div key={field.id} className="space-y-2 border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">FAQ {i + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i)}
                  aria-label="Remove FAQ"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`additionalFaqs.${i}.question`}>Question</Label>
                <Input
                  id={`additionalFaqs.${i}.question`}
                  placeholder="e.g. Is there a minimum age requirement?"
                  {...register(`additionalFaqs.${i}.question`)}
                />
                {errors.additionalFaqs?.[i]?.question && (
                  <p className="text-xs text-destructive">
                    {errors.additionalFaqs[i]?.question?.message}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor={`additionalFaqs.${i}.answer`}>Answer</Label>
                <Textarea
                  id={`additionalFaqs.${i}.answer`}
                  placeholder="Provide a clear, helpful answer"
                  rows={2}
                  {...register(`additionalFaqs.${i}.answer`)}
                />
                {errors.additionalFaqs?.[i]?.answer && (
                  <p className="text-xs text-destructive">
                    {errors.additionalFaqs[i]?.answer?.message}
                  </p>
                )}
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ question: "", answer: "" })}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add FAQ
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
