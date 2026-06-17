import type { PrismaClient } from "@switchboard/db";
import type { CreativeJob } from "@switchboard/schemas";

export type PublishFailureCode =
  | "CREATIVE_JOB_NOT_FOUND"
  | "CREATIVE_NOT_PUBLISHABLE"
  | "CREATIVE_ASSET_NOT_DURABLE"
  | "META_CONNECTION_NOT_FOUND"
  | "META_CONNECTION_NOT_CONNECTED"
  | "META_PAGE_NOT_CONFIGURED";

export interface PublishContext {
  ok: true;
  job: CreativeJob;
  durableAssetUrl: string;
  accessToken: string;
  accountId: string;
  pageId: string;
}

export interface PublishPrecheckFailure {
  ok: false;
  code: PublishFailureCode;
  message: string;
}

export type PublishPrecheck = PublishContext | PublishPrecheckFailure;

export interface AssertPublishableDeps {
  prisma: PrismaClient;
  decrypt: (encrypted: unknown) => Record<string, unknown>;
}

const META_ADS_SERVICE_ID = "meta-ads";
const CONNECTED_STATUS = "connected";

function fail(code: PublishFailureCode, message: string): PublishPrecheckFailure {
  return { ok: false, code, message };
}

/**
 * Single source of truth for "can this job be published as a paused Meta draft?".
 * Used by the route (pre-flight → immediate 4xx) AND the workflow handler
 * (defensive re-check post-approval). Fails loud with an actionable code; never
 * silently no-ops. Page-id read side only — the operator setter is PR C.
 *
 * This publish path builds a LEARN_MORE link-destination paused draft
 * (objective OUTCOME_LEADS, placeholder link). It is NOT a click-to-WhatsApp ad.
 * A WABA-binding precondition belongs only on a CTWA-destination flag that does
 * not exist yet; adding it unconditionally here blocks every creative publish for
 * orgs onboarded to Meta Ads but not WhatsApp.
 */
export async function assertPublishable(
  deps: AssertPublishableDeps,
  organizationId: string,
  jobId: string,
): Promise<PublishPrecheck> {
  const job = (await deps.prisma.creativeJob.findUnique({
    where: { id: jobId },
  })) as unknown as CreativeJob | null;

  if (!job || job.organizationId !== organizationId) {
    return fail("CREATIVE_JOB_NOT_FOUND", "Creative job not found for this organization.");
  }

  // Mode-aware completeness (slice-3 spec 3.3f): UGC jobs never advance
  // currentStage (it stays the polished column default), they complete via
  // ugcPhase; a failed UGC job is terminal regardless of phase value.
  const isComplete =
    job.mode === "ugc"
      ? job.ugcPhase === "complete" && job.ugcFailure == null && !job.stoppedAt
      : job.currentStage === "complete" && !job.stoppedAt;
  const isKept = job.reviewDecision === "kept";
  if (!isComplete || !isKept) {
    return fail(
      "CREATIVE_NOT_PUBLISHABLE",
      "Only a completed creative you have kept can be published as a paused draft.",
    );
  }

  if (!job.durableAssetUrl) {
    return fail(
      "CREATIVE_ASSET_NOT_DURABLE",
      "The rendered creative has no durable asset yet (pending durable storage).",
    );
  }

  const connection = (await deps.prisma.connection.findFirst({
    where: { serviceId: META_ADS_SERVICE_ID, organizationId },
    select: { credentials: true, externalAccountId: true, status: true },
  })) as {
    credentials: unknown;
    externalAccountId: string | null;
    status: string | null;
  } | null;

  if (!connection) {
    return fail("META_CONNECTION_NOT_FOUND", "No Meta Ads connection for this organization.");
  }

  // An expired/revoked connection still has rows + ciphertext, so without this
  // gate publishing creates a Meta draft that can never serve and dead-letters
  // with only a raw Meta error. Fail loud with the actual status instead.
  const connectionStatus = connection.status ?? "unknown";
  if (connectionStatus !== CONNECTED_STATUS) {
    return fail(
      "META_CONNECTION_NOT_CONNECTED",
      `The Meta Ads connection is "${connectionStatus}", not connected. Reconnect Meta Ads before publishing.`,
    );
  }

  const creds = deps.decrypt(connection.credentials);
  const accessToken = typeof creds["accessToken"] === "string" ? creds["accessToken"] : null;
  const accountId =
    typeof creds["accountId"] === "string"
      ? creds["accountId"]
      : (connection.externalAccountId ?? null);
  if (!accessToken || !accountId) {
    return fail(
      "META_CONNECTION_NOT_FOUND",
      "Meta Ads connection is missing an access token or ad account id.",
    );
  }

  // Page-id resolution (read-only; setter is PR C): connection credentials first.
  const pageId = typeof creds["pageId"] === "string" ? creds["pageId"] : null;
  if (!pageId) {
    return fail(
      "META_PAGE_NOT_CONFIGURED",
      "No Facebook Page is configured for ads on this connection.",
    );
  }

  return { ok: true, job, durableAssetUrl: job.durableAssetUrl, accessToken, accountId, pageId };
}
