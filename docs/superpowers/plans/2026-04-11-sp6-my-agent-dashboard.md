# SP6: My Agent Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a buyer-facing "My Agent" page that adapts its layout based on the agent type — showing storefront links and install instructions for customer-facing agents, connected channels for personal agents, and integration status for system-connected agents.

**Architecture:** New page at `(auth)/my-agent/[id]/page.tsx` that fetches deployment + listing data, resolves `onboarding` config from listing metadata, and renders adaptive sections. New `InstallInstructions` component for platform-specific widget installation guides. Reuses existing `TrustHistoryChart`, `WorkLogList`, `ChannelsSection`, and `ConversationTranscript` components.

**Tech Stack:** Next.js 14, React, Tailwind, shadcn/ui, existing marketplace hooks

---

## File Structure

| Action | Path                                                                 | Responsibility                                                |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Create | `apps/dashboard/src/app/(auth)/my-agent/[id]/page.tsx`               | Server page — fetches deployment, listing, connections, trust |
| Create | `apps/dashboard/src/app/(auth)/my-agent/[id]/my-agent-client.tsx`    | Client component — adaptive agent dashboard                   |
| Create | `apps/dashboard/src/components/marketplace/install-instructions.tsx` | Platform-specific widget install guide                        |
| Modify | `apps/dashboard/src/hooks/use-marketplace.ts`                        | Add `useDeployment(id)` hook                                  |

---

### Task 1: Add useDeployment Hook

**Files:**

- Modify: `apps/dashboard/src/hooks/use-marketplace.ts`

- [ ] **Step 1: Read the existing hooks file**

Read `apps/dashboard/src/hooks/use-marketplace.ts` to understand the pattern (useQuery, query keys, fetch functions).

- [ ] **Step 2: Add useDeployment hook**

Add a `useDeployment(id)` hook following the same pattern as `useListing(id)`. It should:

- Fetch from `/api/dashboard/marketplace/deployments` (the existing list endpoint)
- Find the deployment by ID from the list
- Return `{ data: deployment, isLoading, error }`

```typescript
export function useDeployment(id: string | null) {
  return useQuery({
    queryKey: ["marketplace", "deployment", id],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/marketplace/deployments");
      if (!res.ok) throw new Error("Failed to fetch deployments");
      const { deployments } = await res.json();
      const deployment = deployments.find((d: { id: string }) => d.id === id);
      if (!deployment) throw new Error("Deployment not found");
      return deployment;
    },
    enabled: !!id,
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/hooks/ && git commit -m "feat(dashboard): add useDeployment hook"
```

---

### Task 2: Install Instructions Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/install-instructions.tsx`

- [ ] **Step 1: Create the component**

Create `apps/dashboard/src/components/marketplace/install-instructions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Copy } from "lucide-react";

type Platform = "shopify" | "wordpress" | "wix" | "squarespace" | "custom" | null;

interface InstallInstructionsProps {
  widgetToken: string;
  chatServerUrl: string;
  platform?: Platform;
}

const PLATFORM_INSTRUCTIONS: Record<string, { label: string; steps: string[] }> = {
  shopify: {
    label: "Shopify",
    steps: [
      "Go to your Shopify admin → Online Store → Themes",
      "Click Actions → Edit code",
      "Open theme.liquid",
      "Paste the code snippet just before </body>",
      "Save",
    ],
  },
  wordpress: {
    label: "WordPress",
    steps: [
      "Go to Appearance → Theme Editor (or use a plugin like Insert Headers and Footers)",
      "Open your theme's footer.php or use the plugin's footer section",
      "Paste the code snippet",
      "Save changes",
    ],
  },
  wix: {
    label: "Wix",
    steps: [
      "Go to Settings → Custom Code",
      "Click + Add Custom Code",
      "Paste the code snippet",
      'Set "Place Code in" to Body - end',
      "Apply to All Pages → Save",
    ],
  },
  squarespace: {
    label: "Squarespace",
    steps: [
      "Go to Settings → Advanced → Code Injection",
      "Paste the code snippet in the Footer section",
      "Save",
    ],
  },
};

export function InstallInstructions({
  widgetToken,
  chatServerUrl,
  platform,
}: InstallInstructionsProps) {
  const [copied, setCopied] = useState(false);

  const embedCode = `<script src="${chatServerUrl}/widget.js" data-token="${widgetToken}"></script>`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const instructions = platform && PLATFORM_INSTRUCTIONS[platform];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Install Widget on Your Website
          {platform && PLATFORM_INSTRUCTIONS[platform] && (
            <Badge variant="secondary">{PLATFORM_INSTRUCTIONS[platform].label}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Embed code */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Copy this code and paste it into your website:
          </p>
          <div className="relative">
            <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
              {embedCode}
            </pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1 h-7 w-7 p-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Platform-specific steps */}
        {instructions && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Steps for {instructions.label}:</p>
            <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
              {instructions.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {!instructions && (
          <p className="text-sm text-muted-foreground">
            Paste the code snippet just before the closing <code>&lt;/body&gt;</code> tag on every
            page where you want the chat widget to appear.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/install-instructions.tsx && git commit -m "feat(dashboard): add platform-specific install instructions component"
```

---

### Task 3: My Agent Page (Server + Client)

**Files:**

- Create: `apps/dashboard/src/app/(auth)/my-agent/[id]/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/my-agent/[id]/my-agent-client.tsx`

- [ ] **Step 1: Read existing deployment detail page for patterns**

Read:

- `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`
- `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx` (first 80 lines)

- [ ] **Step 2: Create the server page**

Create `apps/dashboard/src/app/(auth)/my-agent/[id]/page.tsx`:

```tsx
import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { MyAgentClient } from "./my-agent-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MyAgentPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d: { id: string }) => d.id === id);
    if (!deployment) notFound();

    const [{ connections }, listingResult, trustResult, tasksResult] = await Promise.all([
      client.getDeploymentConnections(id),
      client.getMarketplaceListing(deployment.listingId).catch(() => null),
      client.getListingTrustScore(deployment.listingId).catch(() => null),
      client.listTasks({ deploymentId: id }).catch(() => ({ tasks: [] })),
    ]);

    const listing = listingResult?.listing ?? null;
    const metadata = (listing?.metadata as Record<string, unknown>) ?? {};
    const onboarding = (metadata.setupSchema as Record<string, unknown>)?.onboarding ?? {
      websiteScan: true,
      publicChannels: true,
      privateChannel: false,
      integrations: [],
    };

    return (
      <MyAgentClient
        deploymentId={id}
        deployment={deployment}
        listing={listing}
        connections={connections}
        trustBreakdown={trustResult}
        tasks={tasksResult.tasks ?? []}
        onboarding={onboarding as Record<string, unknown>}
      />
    );
  } catch {
    notFound();
  }
}
```

- [ ] **Step 3: Create the client component**

Create `apps/dashboard/src/app/(auth)/my-agent/[id]/my-agent-client.tsx`:

This is the core adaptive component. It should:

1. Show a header with agent name, status badge, trust score
2. Show sections conditionally based on `onboarding`:
   - **All agents:** Trust score card, recent tasks list
   - **If `publicChannels`:** Storefront link (copyable), install instructions, widget embed code
   - **If `privateChannel`:** Connected channels list, "Add channel" button
   - **If `integrations.length > 0`:** Integration connections with status

```tsx
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrustScoreBadge } from "@/components/marketplace/trust-score-badge";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { InstallInstructions } from "@/components/marketplace/install-instructions";
import { ChannelsSection } from "@/components/marketplace/channels-section";
import { Copy, Check, ExternalLink } from "lucide-react";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown> | null;
}

interface MyAgentClientProps {
  deploymentId: string;
  deployment: Record<string, unknown>;
  listing: Record<string, unknown> | null;
  connections: Connection[];
  trustBreakdown: Record<string, unknown> | null;
  tasks: Array<Record<string, unknown>>;
  onboarding: Record<string, unknown>;
}

export function MyAgentClient({
  deploymentId,
  deployment,
  listing,
  connections,
  trustBreakdown,
  tasks,
  onboarding,
}: MyAgentClientProps) {
  const [copiedStorefront, setCopiedStorefront] = useState(false);

  const agentName = (listing?.name as string) ?? "Your Agent";
  const status = (deployment.status as string) ?? "provisioning";
  const slug = deployment.slug as string | undefined;
  const trustScore = (listing?.trustScore as number) ?? 0;
  const inputConfig = (deployment.inputConfig as Record<string, unknown>) ?? {};
  const scannedProfile = (inputConfig.scannedProfile as Record<string, unknown>) ?? null;
  const platformDetected = (scannedProfile?.platformDetected as string) ?? null;

  const hasPublicChannels = onboarding.publicChannels === true;
  const hasPrivateChannel = onboarding.privateChannel === true;
  const integrations = Array.isArray(onboarding.integrations) ? onboarding.integrations : [];

  const widgetConnection = connections.find(
    (c) => c.type === "web_widget" && c.status === "active",
  );
  const chatServerUrl = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "http://localhost:3001";

  const storefrontUrl = slug ? `${window.location.origin}/agent/${slug}` : null;

  const handleCopyStorefront = async () => {
    if (!storefrontUrl) return;
    await navigator.clipboard.writeText(storefrontUrl);
    setCopiedStorefront(true);
    setTimeout(() => setCopiedStorefront(false), 2000);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{agentName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>
            <TrustScoreBadge score={trustScore} />
          </div>
        </div>
      </div>

      {/* Customer-facing: Storefront + Install */}
      {hasPublicChannels && (
        <div className="space-y-4">
          {storefrontUrl && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your Agent Storefront</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate">
                    {storefrontUrl}
                  </code>
                  <Button size="sm" variant="outline" onClick={handleCopyStorefront}>
                    {copiedStorefront ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={storefrontUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Share this link in your email signature, social media, or Google Business profile.
                </p>
              </CardContent>
            </Card>
          )}

          {widgetConnection && (
            <InstallInstructions
              widgetToken={
                ((widgetConnection.metadata as Record<string, unknown>)?.token as string) ??
                deploymentId
              }
              chatServerUrl={chatServerUrl}
              platform={platformDetected as "shopify" | "wordpress" | "wix" | "squarespace" | null}
            />
          )}
        </div>
      )}

      {/* Personal: Connected channels */}
      {hasPrivateChannel && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Connected Channels</CardTitle>
          </CardHeader>
          <CardContent>
            <ChannelsSection deploymentId={deploymentId} connections={connections} />
          </CardContent>
        </Card>
      )}

      {/* Integration-connected */}
      {integrations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected Systems</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {integrations.map((integration: string) => {
                const conn = connections.find((c) => c.type === integration);
                return (
                  <div key={integration} className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium capitalize">{integration}</span>
                    <Badge variant={conn?.status === "active" ? "default" : "outline"}>
                      {conn?.status ?? "not connected"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trust Score — all agents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent Trust Score</CardTitle>
          <p className="text-xs text-muted-foreground">
            Marketplace reputation — based on all buyer reviews of this agent type
          </p>
        </CardHeader>
        <CardContent>
          <TrustScoreBadge score={trustScore} size="lg" />
        </CardContent>
      </Card>

      {/* Recent Activity — all agents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length > 0 ? (
            <WorkLogList tasks={tasks} />
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No activity yet. Your agent will appear here once it handles its first conversation.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Important notes for the implementer:**

- Read the existing `DeploymentDetailClient` and `ChannelsSection` components to understand their prop interfaces
- `TrustScoreBadge` may not have a `size` prop — check and adapt
- `WorkLogList` prop interface may differ from what's shown — read it and match
- `ChannelsSection` may need specific props (like a refresh callback) — check existing usage
- The widget token for install instructions is NOT in `connection.metadata` — it's in the encrypted `credentials`. The token is only available from the onboard endpoint response. For the install instructions, use the existing storefront API route pattern or show the embed code with the deployment-level info.

- [ ] **Step 4: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/my-agent/ && git commit -m "feat(dashboard): add adaptive My Agent dashboard page"
```

---

### Task 4: Navigation Link to My Agent

**Files:**

- Modify: Dashboard sidebar/nav to add "My Agent" link

- [ ] **Step 1: Find the navigation component**

Search for sidebar or navigation in `apps/dashboard/src/components/` — look for `AppShell`, `Sidebar`, `Nav`, or similar. Read it to understand how nav items are defined.

- [ ] **Step 2: Add My Agent nav link**

Add a "My Agent" link that routes to `/my-agent/[deploymentId]`. Since a user may have multiple deployments, this link should go to the most recent deployment. The simplest approach: link to `/my-agent` (no ID) and have it redirect to the first deployment.

Create a redirect page at `apps/dashboard/src/app/(auth)/my-agent/page.tsx`:

```tsx
import { getApiClient } from "@/lib/get-api-client";
import { redirect, notFound } from "next/navigation";

export default async function MyAgentRedirect() {
  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    if (deployments.length === 0) {
      redirect("/marketplace");
    }
    // Redirect to most recent deployment
    const latest = deployments[0];
    redirect(`/my-agent/${latest.id}`);
  } catch {
    notFound();
  }
}
```

Then add "My Agent" to the nav, linking to `/my-agent`.

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/ && git commit -m "feat(dashboard): add My Agent nav link with redirect to latest deployment"
```

---

## Verification Checklist

1. `npx pnpm@9.15.4 --filter dashboard typecheck` — no new errors
2. `/my-agent` redirects to `/my-agent/[latest-deployment-id]`
3. Customer-facing agents: storefront link + install instructions visible
4. Internal agents (PCD): no storefront section, just trust + tasks
5. All agents: trust score + recent activity shown
6. Install instructions show correct platform steps based on `platformDetected`
