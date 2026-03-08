"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FileText,
  FlaskConical,
  AlertTriangle,
  TrendingUp,
  Box,
  Bell,
  Calendar,
  Activity,
} from "lucide-react";

const advancedPages = [
  {
    href: "/policies",
    label: "Policies",
    description: "Manage guardrail policies and approval rules.",
    icon: FileText,
  },
  {
    href: "/simulate",
    label: "Simulate",
    description: "Dry-run actions against the policy engine.",
    icon: FlaskConical,
  },
  {
    href: "/dlq",
    label: "Dead Letter Queue",
    description: "View and retry failed inbound messages.",
    icon: AlertTriangle,
  },
  {
    href: "/competence",
    label: "Competence Tracking",
    description: "Agent performance scores and policies.",
    icon: TrendingUp,
  },
  {
    href: "/cartridges",
    label: "Cartridges",
    description: "Registered domain cartridges and their manifests.",
    icon: Box,
  },
  {
    href: "/settings/system",
    label: "System Health",
    description: "Backend health checks and diagnostics.",
    icon: Activity,
  },
  {
    href: "/alerts",
    label: "Alert Rules",
    description: "Configure metric-based alerts and notifications.",
    icon: Bell,
  },
  {
    href: "/scheduled-reports",
    label: "Scheduled Reports",
    description: "Automated reporting schedules and delivery.",
    icon: Calendar,
  },
];

export default function AdvancedSettingsPage() {
  const { status } = useSession();
  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Advanced Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Developer tools and detailed configuration.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        {advancedPages.map((page) => {
          const Icon = page.icon;
          return (
            <Link key={page.href} href={page.href}>
              <Card className="hover:border-primary/50 transition-colors h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {page.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{page.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
