import { NextResponse } from "next/server";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { getApiClient } from "@/lib/get-api-client";
import { resolveModuleStatuses } from "@/lib/module-state-resolver";
import type { ResolverInput } from "@/lib/module-state-resolver";
import { SLUG_TO_MODULE } from "@/lib/module-types";

export async function GET() {
  try {
    const session = await requireDashboardSession();
    const client = await getApiClient();

    // Fetch deployments, listings, org-level connections, and org config in parallel
    const [deploymentsResult, listingsResult, orgConfigResult] = await Promise.all([
      client.listDeployments(),
      client.listMarketplaceListings(),
      client.getOrgConfig(session.organizationId).catch(() => ({ config: null })),
    ]);

    // Build a listingId → slug lookup from listings
    const slugById = new Map<string, string>();
    for (const listing of listingsResult.listings) {
      slugById.set(listing.id, listing.slug);
    }

    const rawDeployments = deploymentsResult.deployments;

    // Fetch per-deployment connections in parallel
    const connectionResults = await Promise.all(
      rawDeployments.map((d) =>
        client.getDeploymentConnections(d.id).catch(() => ({ connections: [] })),
      ),
    );

    const deployments = rawDeployments.map((d) => {
      const slug = slugById.get(d.listingId) ?? d.listingId;
      return {
        id: d.id,
        moduleType: SLUG_TO_MODULE[slug] ?? slug,
        status: d.status,
        inputConfig: (d.inputConfig as Record<string, unknown>) ?? {},
      };
    });

    const connections = connectionResults.flatMap((result, idx) =>
      (result.connections ?? []).map((c) => ({
        deploymentId: rawDeployments[idx].id,
        type: c.type,
        status: c.status,
      })),
    );

    const orgConfig = orgConfigResult.config as Record<string, unknown> | null;

    const input: ResolverInput = {
      deployments,
      connections,
      orgConfig: {
        businessHours:
          (orgConfig?.businessHours as ResolverInput["orgConfig"]["businessHours"]) ?? null,
      },
      creativeJobCount: 0,
      auditCount: 0,
      platformConfig: {
        hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      },
    };

    const statuses = resolveModuleStatuses(input);
    return NextResponse.json({ modules: statuses });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
