"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  OperationalStateValidationError,
  useOperationalState,
  useRecordOperationalState,
} from "@/hooks/use-operational-state";
import type { OperationalState } from "@switchboard/schemas";
import { emptyOperationalStateForm, prefillFromState } from "./form-model";
import { ensureTimeZone } from "./local-date";
import { OperationalStateForm } from "./operational-state-form";

interface OperationalStateSectionProps {
  deploymentId: string;
  timezone: string;
}

/**
 * Sibling of the business-facts editor (Riley v3 slice 4b), NOT part of its
 * form or PUT payload: operational state is an append-only stream of dated
 * confirmations (4a), so every save here POSTs a NEW confirmation row.
 * "Everything still accurate" re-records the latest state verbatim; the
 * fresh confirmedAt the route assigns IS the freshness re-anchor.
 */
export function OperationalStateSection({ deploymentId, timezone }: OperationalStateSectionProps) {
  const latest = useOperationalState(deploymentId);
  const record = useRecordOperationalState(deploymentId);
  const { toast } = useToast();
  const tz = ensureTimeZone(timezone);

  const save = (state: OperationalState) => {
    record.mutate(state, {
      onSuccess: () => toast({ title: "Operational state confirmed" }),
      onError: (e) =>
        toast({
          variant: "destructive",
          title: "Couldn't confirm",
          description:
            e instanceof OperationalStateValidationError
              ? "Some fields are invalid. Please review and try again."
              : "Something went wrong recording your confirmation.",
        }),
    });
  };

  // RQ gotcha: gate on !data && !error, never isLoading alone (a disabled
  // query is pending+idle with isLoading=false).
  if (!latest.data && !latest.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational state</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  if (latest.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational state</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Failed to load operational state. Please refresh and try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const confirmation = latest.data?.confirmation ?? null;
  const freshness = confirmation
    ? new Intl.DateTimeFormat("en-SG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: tz,
      }).format(new Date(confirmation.confirmedAt))
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Operational state</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {confirmation ? (
            <p className="text-[14px] text-muted-foreground">
              Last confirmed {freshness}
              {confirmation.confirmedBy ? ` by ${confirmation.confirmedBy}` : ""}
            </p>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              Never confirmed. Riley treats operational context as unknown until you confirm it.
            </p>
          )}
          {confirmation && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={record.isPending}
              onClick={() => save(confirmation.state)}
            >
              Everything still accurate
            </Button>
          )}
        </div>

        <OperationalStateForm
          key={confirmation?.id ?? "never-confirmed"}
          initial={
            confirmation ? prefillFromState(confirmation.state, tz) : emptyOperationalStateForm()
          }
          timezone={tz}
          isSaving={record.isPending}
          onSubmit={save}
        />
      </CardContent>
    </Card>
  );
}
