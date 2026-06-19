"use client";

import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BusinessFactsSchema, type BusinessFacts } from "@switchboard/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  type BusinessFactsForm as BusinessFactsFormValues,
  serializeBusinessFacts,
} from "./scaffold";
import { HoursSection } from "./hours-section";
import { LocationsSection } from "./locations-section";
import { ServicesSection } from "./services-section";
import { ContactPoliciesSection } from "./contact-policies-section";
import { FaqsSection } from "./faqs-section";

interface BusinessFactsFormProps {
  defaultValues: BusinessFactsFormValues;
  malformed?: boolean;
  isSaving?: boolean;
  onSubmit: (facts: BusinessFacts) => void;
}

export function BusinessFactsForm({
  defaultValues,
  malformed,
  isSaving,
  onSubmit,
}: BusinessFactsFormProps) {
  const methods = useForm<BusinessFactsFormValues>({
    resolver: zodResolver(BusinessFactsSchema),
    defaultValues,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = methods;

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={handleSubmit((values) => onSubmit(serializeBusinessFacts(values)))}
        className="space-y-6"
      >
        {malformed && (
          <div className="rounded-lg border border-caution/30 bg-caution-subtle px-4 py-3 text-sm text-caution">
            Your saved business facts were invalid and weren&apos;t loaded — please re-enter and
            save.
          </div>
        )}

        {/* Business block */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="businessName">Business name</Label>
              <Input
                id="businessName"
                placeholder="e.g. Glow Aesthetics"
                {...register("businessName")}
              />
              {errors.businessName && (
                <p className="text-xs text-destructive">{errors.businessName.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="timezone">Timezone</Label>
              <Input id="timezone" placeholder="e.g. Asia/Singapore" {...register("timezone")} />
              {errors.timezone && (
                <p className="text-xs text-destructive">{errors.timezone.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <HoursSection />
        <LocationsSection />
        <ServicesSection />
        <ContactPoliciesSection />
        <FaqsSection />

        <div className="sticky bottom-0 flex justify-end bg-background/80 backdrop-blur py-3">
          <Button variant="action" type="submit" disabled={isSaving}>
            Save business facts
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
