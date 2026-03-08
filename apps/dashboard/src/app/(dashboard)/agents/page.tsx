"use client";

import { useState, useEffect, useCallback } from "react";

interface OperatorConfig {
  id: string;
  active: boolean;
  automationLevel: "copilot" | "supervised" | "autonomous";
  targets: { cpa?: number; roas?: number; dailyBudgetCap?: number };
  schedule: { optimizerCronHour: number; reportCronHour: number; timezone: string };
  lastTickAt?: string;
}

interface RosterAgent {
  id: string;
  agentRole: string;
  displayName: string;
  description: string;
  status: string;
}

const AGENTS = [
  {
    id: "optimizer",
    name: "Optimizer",
    description: "Daily budget reallocation and campaign optimization",
  },
  {
    id: "reporter",
    name: "Reporter",
    description: "Scheduled performance summaries and alerts",
  },
  {
    id: "monitor",
    name: "Monitor",
    description: "Proactive monitoring with daily and weekly digests",
  },
  {
    id: "guardrail",
    name: "Guardrail",
    description: "Compliance monitoring and spend cap enforcement",
  },
  {
    id: "strategist",
    name: "Strategist",
    description: "Weekly campaign plan generation from business context",
  },
];

const AUTOMATION_LEVELS = [
  { value: "copilot" as const, label: "Copilot", description: "All actions require your approval" },
  {
    value: "supervised" as const,
    label: "Supervised",
    description: "Low-risk auto-executes, others need approval",
  },
  {
    value: "autonomous" as const,
    label: "Autonomous",
    description: "All actions within risk tolerance auto-execute",
  },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AgentsPage() {
  const [config, setConfig] = useState<OperatorConfig | null>(null);
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, rosterRes] = await Promise.all([
        fetch("/api/dashboard/operator-config"),
        fetch("/api/dashboard/agents/roster"),
      ]);

      if (configRes.ok) {
        const configData: { config?: OperatorConfig } = await configRes.json();
        setConfig(configData.config ?? null);
      }

      if (rosterRes.ok) {
        const rosterData: { roster?: RosterAgent[] } = await rosterRes.json();
        setRoster(rosterData.roster ?? []);
      }

      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load agent data";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateConfig = async (updates: Partial<OperatorConfig>) => {
    if (!config) return;
    setUpdating(true);
    try {
      const res = await fetch("/api/dashboard/operator-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, ...updates }),
      });
      if (res.ok) {
        const data: { config: OperatorConfig } = await res.json();
        setConfig(data.config);
      } else {
        const data: { error?: string } = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update config");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Update failed";
      setError(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleActive = () => {
    updateConfig({ active: !config?.active });
  };

  const handleAutomationChange = (level: OperatorConfig["automationLevel"]) => {
    updateConfig({ automationLevel: level });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">AI Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your autonomous advertising agents
          </p>
        </div>
        <div className="border border-destructive rounded-lg p-6">
          <p className="text-destructive font-medium">Failed to load agent data</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchData();
            }}
            className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">AI Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your autonomous advertising agents
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <h2 className="text-lg font-semibold">No AI operator configured</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Set up your AI operator to enable autonomous advertising agents.
          </p>
          <a
            href="/setup"
            className="mt-4 inline-block px-6 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-medium"
          >
            Set up your AI operator
          </a>
        </div>
      </div>
    );
  }

  // Match roster entries to the static agent list by role
  const agentsWithStatus = AGENTS.map((agent) => {
    const rosterEntry = roster.find(
      (r) => r.agentRole === agent.id || r.displayName.toLowerCase() === agent.name.toLowerCase(),
    );
    return {
      ...agent,
      active: rosterEntry ? rosterEntry.status === "active" : false,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">AI Agents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your autonomous advertising agents
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border border-destructive rounded-lg p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Agent Status Card */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Operator Status</h2>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              config.active
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${config.active ? "bg-green-500" : "bg-yellow-500"}`}
            />
            {config.active ? "Active" : "Paused"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Automation Level</span>
            <p className="font-medium capitalize">{config.automationLevel}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Schedule</span>
            <p className="font-medium">
              Optimizer: {config.schedule.optimizerCronHour}:00 &middot; Reporter:{" "}
              {config.schedule.reportCronHour}:00 ({config.schedule.timezone})
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Last Tick</span>
            <p className="font-medium">
              {config.lastTickAt ? formatTime(config.lastTickAt) : "Never"}
            </p>
          </div>
        </div>
      </div>

      {/* Agent Roster */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Agent Roster</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {agentsWithStatus.map((agent) => (
            <div key={agent.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    agent.active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                />
                <h3 className="font-medium">{agent.name}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{agent.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Quick Actions</h2>

        {/* Pause / Resume */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {config.active ? "Pause Operator" : "Resume Operator"}
            </p>
            <p className="text-xs text-muted-foreground">
              {config.active
                ? "Stop all automated actions until resumed"
                : "Re-enable automated actions"}
            </p>
          </div>
          <button
            onClick={handleToggleActive}
            disabled={updating}
            className={`px-4 py-2 text-sm rounded font-medium disabled:opacity-50 ${
              config.active
                ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
                : "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800"
            }`}
          >
            {updating ? "Updating..." : config.active ? "Pause" : "Resume"}
          </button>
        </div>

        {/* Automation Level */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Automation Level</p>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
            {AUTOMATION_LEVELS.map((level) => (
              <label
                key={level.value}
                className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                  config.automationLevel === level.value
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/30"
                }`}
              >
                <input
                  type="radio"
                  name="automationLevel"
                  value={level.value}
                  checked={config.automationLevel === level.value}
                  onChange={() => handleAutomationChange(level.value)}
                  disabled={updating}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">{level.label}</p>
                  <p className="text-xs text-muted-foreground">{level.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Targets Summary */}
      <div className="border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Targets Summary</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Target CPA</p>
            <p className="text-xl font-semibold">
              {config.targets.cpa != null ? formatCurrency(config.targets.cpa) : "Not set"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Target ROAS</p>
            <p className="text-xl font-semibold">
              {config.targets.roas != null ? `${config.targets.roas}x` : "Not set"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Daily Budget Cap</p>
            <p className="text-xl font-semibold">
              {config.targets.dailyBudgetCap != null
                ? formatCurrency(config.targets.dailyBudgetCap)
                : "Not set"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
