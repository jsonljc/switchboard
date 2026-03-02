"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportCard } from "@/components/scheduled-reports/report-card";
import { ReportForm } from "@/components/scheduled-reports/report-form";
import { useScheduledReports, useCreateReport, useUpdateReport, useDeleteReport, useRunReport } from "@/hooks/use-scheduled-reports";
import { Plus } from "lucide-react";

export default function ScheduledReportsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const { data: reports, isLoading } = useScheduledReports();
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();
  const runReport = useRunReport();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Reports</h1>
          <p className="text-muted-foreground">Configure automated diagnostic reports delivered on a schedule.</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Report
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : reports && reports.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onToggle={(id, enabled) => updateReport.mutate({ id, enabled })}
              onDelete={(id) => deleteReport.mutate(id)}
              onRunNow={(id) => runReport.mutate(id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p>No scheduled reports configured.</p>
          <p className="text-sm">Create one to receive periodic diagnostic summaries.</p>
        </div>
      )}

      <ReportForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={(data) => {
          createReport.mutate(data, { onSuccess: () => setFormOpen(false) });
        }}
        isLoading={createReport.isPending}
      />
    </div>
  );
}
