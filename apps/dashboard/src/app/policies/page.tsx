"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { PolicyCard } from "@/components/policies/policy-card";
import { PolicyForm } from "@/components/policies/policy-form";
import { DeletePolicyDialog } from "@/components/policies/delete-policy-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  usePolicies,
  useCreatePolicy,
  useUpdatePolicy,
  useDeletePolicy,
} from "@/hooks/use-policies";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, Plus } from "lucide-react";
import type { Policy } from "@switchboard/schemas";

export default function PoliciesPage() {
  const { status } = useSession();
  const { data, isLoading, isError, error, refetch } = usePolicies();
  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();
  const deletePolicy = useDeletePolicy();
  const { toast } = useToast();

  const [sheetState, setSheetState] = useState<{
    open: boolean;
    policy?: Policy;
  }>({ open: false });

  const [deleteState, setDeleteState] = useState<{
    open: boolean;
    policy?: Policy;
  }>({ open: false });

  const isMutating = createPolicy.isPending || updatePolicy.isPending || deletePolicy.isPending;

  if (status === "unauthenticated") redirect("/login");

  const handleCreate = () => {
    setSheetState({ open: true });
  };

  const handleEdit = (policy: Policy) => {
    setSheetState({ open: true, policy });
  };

  const handleFormSubmit = (values: any) => {
    if (sheetState.policy) {
      updatePolicy.mutate(
        { id: sheetState.policy.id, ...values },
        {
          onSuccess: () => {
            toast({ title: "Policy updated", description: `"${values.name}" has been updated.` });
            setSheetState({ open: false });
          },
          onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        }
      );
    } else {
      createPolicy.mutate(values, {
        onSuccess: () => {
          toast({ title: "Policy created", description: `"${values.name}" has been created.` });
          setSheetState({ open: false });
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      });
    }
  };

  const handleToggleActive = (policy: Policy) => {
    updatePolicy.mutate(
      { id: policy.id, active: !policy.active },
      {
        onSuccess: () => {
          toast({
            title: policy.active ? "Policy deactivated" : "Policy activated",
            description: `"${policy.name}" is now ${policy.active ? "inactive" : "active"}.`,
          });
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDeleteConfirm = () => {
    if (!deleteState.policy) return;
    const name = deleteState.policy.name;
    deletePolicy.mutate(deleteState.policy.id, {
      onSuccess: () => {
        toast({ title: "Policy deleted", description: `"${name}" has been deleted.` });
        setDeleteState({ open: false });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });
  };

  const sortedPolicies = data?.policies
    ? [...data.policies].sort((a, b) => a.priority - b.priority)
    : [];

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Policies</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load policies</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Policies</h1>
        <Button size="sm" onClick={handleCreate} className="gap-1">
          <Plus className="h-4 w-4" />
          New Policy
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : sortedPolicies.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No policies configured</p>
          <p className="text-xs mt-1">Create a policy to define guardrail rules.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedPolicies.map((policy) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onEdit={handleEdit}
              onDelete={(p) => setDeleteState({ open: true, policy: p })}
              onToggleActive={handleToggleActive}
              disabled={isMutating}
            />
          ))}
        </div>
      )}

      <Sheet open={sheetState.open} onOpenChange={(open) => !open && setSheetState({ open: false })}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{sheetState.policy ? "Edit Policy" : "New Policy"}</SheetTitle>
            <SheetDescription>
              {sheetState.policy
                ? "Update the policy configuration below."
                : "Define a new guardrail policy with conditions and effects."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <PolicyForm
              key={sheetState.policy?.id ?? "new"}
              policy={sheetState.policy}
              onSubmit={handleFormSubmit}
              onCancel={() => setSheetState({ open: false })}
              isLoading={createPolicy.isPending || updatePolicy.isPending}
            />
          </div>
        </SheetContent>
      </Sheet>

      {deleteState.open && deleteState.policy && (
        <DeletePolicyDialog
          open={deleteState.open}
          onClose={() => setDeleteState({ open: false })}
          policy={deleteState.policy}
          onConfirm={handleDeleteConfirm}
          isLoading={deletePolicy.isPending}
        />
      )}
    </div>
  );
}
