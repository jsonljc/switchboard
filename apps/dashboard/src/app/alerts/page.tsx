"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertRuleCard } from "@/components/alerts/alert-rule-card";
import { AlertRuleForm } from "@/components/alerts/alert-rule-form";
import { AlertHistoryList } from "@/components/alerts/alert-history-list";
import { useAlerts, useCreateAlert, useUpdateAlert, useDeleteAlert, useAlertHistory } from "@/hooks/use-alerts";
import { Plus } from "lucide-react";

export default function AlertsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const { data: alerts, isLoading } = useAlerts();
  const { data: history, isLoading: historyLoading } = useAlertHistory(selectedAlertId);
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const deleteAlert = useDeleteAlert();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="text-muted-foreground">Configure proactive alert rules for your ad performance metrics.</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Alert
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : alerts && alerts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {alerts.map((rule) => (
            <AlertRuleCard
              key={rule.id}
              rule={rule}
              onToggle={(id, enabled) => updateAlert.mutate({ id, enabled })}
              onDelete={(id) => deleteAlert.mutate(id)}
              onSelect={(id) => setSelectedAlertId(id === selectedAlertId ? null : id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p>No alert rules configured.</p>
          <p className="text-sm">Create one to get proactive notifications when metrics cross thresholds.</p>
        </div>
      )}

      {selectedAlertId && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Alert History</h2>
          <AlertHistoryList
            history={history ?? []}
            isLoading={historyLoading}
          />
        </div>
      )}

      <AlertRuleForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={(data) => {
          createAlert.mutate(data, { onSuccess: () => setFormOpen(false) });
        }}
        isLoading={createAlert.isPending}
      />
    </div>
  );
}
