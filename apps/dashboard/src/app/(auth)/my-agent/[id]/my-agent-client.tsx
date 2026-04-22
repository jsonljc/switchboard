"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Copy, Check, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustScoreBadge } from "@/components/marketplace/trust-score-badge";
import { TrustHistoryChart } from "@/components/marketplace/trust-history-chart";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { ChannelsSection } from "@/components/marketplace/channels-section";
import { InstallInstructions } from "@/components/marketplace/install-instructions";
import { useTrustProgression } from "@/hooks/use-marketplace";
import type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  TrustScoreBreakdown,
} from "@/lib/api-client";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface OnboardingConfig {
  publicChannels?: boolean;
  privateChannel?: boolean;
  integrations?: string[];
}

interface MyAgentClientProps {
  deploymentId: string;
  deployment: MarketplaceDeployment;
  listing: MarketplaceListing | null;
  connections: Connection[];
  trustBreakdown: TrustScoreBreakdown | null;
  initialTasks: MarketplaceTask[];
  onboarding: OnboardingConfig;
  chatServerUrl: string;
  widgetToken: string | null;
}

function StorefrontLinkCard({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const storefrontUrl = `/agents/${slug}`;
  const fullUrl =
    typeof window !== "undefined" ? `${window.location.origin}${storefrontUrl}` : storefrontUrl;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Storefront Link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Share this link so customers can chat with your agent directly.
        </p>
        <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
          <span className="flex-1 truncate text-sm font-mono">{fullUrl}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            onClick={handleCopy}
            aria-label="Copy storefront URL"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            onClick={() => window.open(storefrontUrl, "_blank")}
            aria-label="Open storefront in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationStatusBadge({
  name,
  connections,
}: {
  name: string;
  connections: Connection[];
}) {
  const connected = connections.some(
    (c) => c.type.toLowerCase() === name.toLowerCase() && c.status === "active",
  );
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-foreground capitalize">{name.replace(/_/g, " ")}</span>
      <Badge variant={connected ? "default" : "secondary"} className="text-[11px]">
        {connected ? "Connected" : "Not connected"}
      </Badge>
    </div>
  );
}

export function MyAgentClient({
  deploymentId,
  deployment,
  listing,
  connections,
  trustBreakdown,
  initialTasks,
  onboarding,
  chatServerUrl,
  widgetToken,
}: MyAgentClientProps) {
  const router = useRouter();
  const { data: progression, isLoading: progressionLoading } = useTrustProgression(
    listing?.id ?? "",
  );

  const workLogTasks = initialTasks.map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt,
    completedAt: t.completedAt ?? null,
    output: t.output,
  }));

  const integrations = Array.isArray(onboarding.integrations) ? onboarding.integrations : [];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-10">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push("/dashboard")}
        aria-label="Back to dashboard"
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </button>

      {/* Header */}
      <section className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Bot className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
              {listing?.name ?? "My Agent"}
            </h1>
            <p className="text-[13px] text-muted-foreground capitalize mt-0.5">
              {listing?.type.replace(/_/g, " ") ?? "Agent"}
              {" · "}
              <Badge variant="secondary" className="text-[11px]">
                {deployment.status === "active" ? "Active" : deployment.status}
              </Badge>
            </p>
          </div>
        </div>
        {listing && (
          <div className="shrink-0">
            <TrustScoreBadge score={listing.trustScore} size="lg" />
          </div>
        )}
      </section>

      {/* Trust Score Card */}
      {trustBreakdown && (
        <section>
          <h2 className="section-label mb-4">Agent Trust Score — Marketplace Reputation</h2>
          <div className="rounded-xl border border-border bg-surface p-6 space-y-6">
            {progressionLoading ? (
              <Skeleton className="h-48" />
            ) : progression && progression.length > 0 ? (
              <TrustHistoryChart
                data={progression}
                totalApprovals={trustBreakdown.breakdown.reduce(
                  (sum, b) => sum + b.totalApprovals,
                  0,
                )}
                totalRejections={trustBreakdown.breakdown.reduce(
                  (sum, b) => sum + b.totalRejections,
                  0,
                )}
                currentStreak={
                  trustBreakdown.breakdown.length > 0
                    ? Math.max(...trustBreakdown.breakdown.map((b) => b.consecutiveApprovals))
                    : 0
                }
                highestScore={Math.max(...progression.map((p) => p.score))}
              />
            ) : null}

            {trustBreakdown.breakdown.length > 0 && (
              <div className="space-y-3">
                <p className="section-label">Per-category breakdown</p>
                {trustBreakdown.breakdown.map((item) => (
                  <div
                    key={item.taskCategory}
                    className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                  >
                    <div>
                      <p className="text-[14px] text-foreground capitalize">{item.taskCategory}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {item.totalApprovals} approved · {item.totalRejections} rejected
                        {item.consecutiveApprovals > 0 && ` · ${item.consecutiveApprovals} streak`}
                      </p>
                    </div>
                    <TrustScoreBadge score={item.score} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Storefront link + install instructions (public channels) */}
      {onboarding.publicChannels && listing?.slug && (
        <section className="space-y-4">
          <h2 className="section-label">Storefront &amp; Embed</h2>
          <StorefrontLinkCard slug={listing.slug} />
          {widgetToken ? (
            <InstallInstructions widgetToken={widgetToken} chatServerUrl={chatServerUrl} />
          ) : (
            <div className="rounded-lg border border-border bg-surface-raised p-4 text-center">
              <p className="text-sm text-muted-foreground">No web widget connected yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connect a web widget from the Channels settings to get your embed code.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Private channels */}
      {onboarding.privateChannel && (
        <section>
          <h2 className="section-label mb-4">Connected Channels</h2>
          <ChannelsSection
            deploymentId={deploymentId}
            connections={connections}
            onRefresh={() => router.refresh()}
          />
        </section>
      )}

      {/* Connected integrations */}
      {integrations.length > 0 && (
        <section>
          <h2 className="section-label mb-4">Connected Systems</h2>
          <div className="rounded-xl border border-border bg-surface p-6">
            {integrations.map((name) => (
              <IntegrationStatusBadge key={name} name={name} connections={connections} />
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity */}
      <section>
        <h2 className="section-label mb-4">Recent Activity</h2>
        <div className="rounded-xl border border-border bg-surface p-6">
          <WorkLogList tasks={workLogTasks} />
        </div>
      </section>
    </div>
  );
}
