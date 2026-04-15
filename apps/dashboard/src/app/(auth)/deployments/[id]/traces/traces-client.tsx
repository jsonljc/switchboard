"use client";

import { useTraces } from "@/hooks/use-traces";
import { Fragment, useState } from "react";

const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  budget_exceeded: "bg-yellow-100 text-yellow-800",
  denied: "bg-gray-100 text-gray-800",
};

export function TracesClient({ deploymentId }: { deploymentId: string }) {
  const { data, isLoading, error } = useTraces(deploymentId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <div className="p-6">Loading traces...</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load traces</div>;
  if (!data?.traces.length) return <div className="p-6 text-gray-500">No traces yet</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Execution Traces</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 px-3">Time</th>
            <th className="py-2 px-3">Skill</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3">Duration</th>
            <th className="py-2 px-3">Tools</th>
            <th className="py-2 px-3">Writes</th>
            <th className="py-2 px-3">Outcome</th>
            <th className="py-2 px-3">Summary</th>
          </tr>
        </thead>
        <tbody>
          {data.traces.map((trace) => (
            <Fragment key={trace.id}>
              <tr
                className="border-b hover:bg-gray-50 cursor-pointer"
                onClick={() => setExpandedId(expandedId === trace.id ? null : trace.id)}
              >
                <td className="py-2 px-3 whitespace-nowrap">
                  {new Date(trace.createdAt).toLocaleString()}
                </td>
                <td className="py-2 px-3 font-mono text-xs">{trace.skillSlug}</td>
                <td className="py-2 px-3">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[trace.status] ?? "bg-gray-100"}`}
                  >
                    {trace.status}
                  </span>
                </td>
                <td className="py-2 px-3">{trace.durationMs}ms</td>
                <td className="py-2 px-3">{trace.turnCount}</td>
                <td className="py-2 px-3">{trace.writeCount}</td>
                <td className="py-2 px-3 text-xs">{trace.linkedOutcomeResult ?? "\u2014"}</td>
                <td className="py-2 px-3 max-w-xs truncate text-gray-600">
                  {trace.responseSummary}
                </td>
              </tr>
              {expandedId === trace.id && (
                <tr>
                  <td colSpan={8} className="bg-gray-50 p-4">
                    <pre className="text-xs overflow-auto max-h-96">
                      {JSON.stringify(trace, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
