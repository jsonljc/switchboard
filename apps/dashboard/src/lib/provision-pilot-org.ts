import { randomBytes } from "node:crypto";
import type { DashboardUser, PrismaClient } from "@prisma/client";
import { hashResetToken } from "./password-reset";

/**
 * Provisions a vetted pilot clinic org from the operator side, mirroring the
 * canonical self-serve onboarding (`provisionDashboardUser`) so the org is
 * byte-identical to a signed-up one (entitled per F-02, bookable per F-01,
 * day-one agent enablement), then EAGERLY seeds Riley's deployment + governance
 * (`provisionOrgAgentDeployments`) which self-serve otherwise defers to the
 * first dashboard `GET /config`. Used to onboard pilots while self-serve signup
 * is gated to "waitlist" (F-05). See docs/runbooks/provisioning.md.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Onboarding set-password links live far longer than the 45-minute self-serve
 * password-reset window: an operator mints one and conveys it out-of-band, so
 * it must survive a realistic hand-off delay. The exposure is bounded — these
 * are operator-minted links for comped pilot orgs, conveyed over a trusted
 * channel, and the token is single-use (the reset-consume path wipes all of a
 * user's tokens on success). Re-mint with `reissueSetupLink` if it lapses.
 */
export const SETUP_LINK_EXPIRY_HOURS = 72;

export class PilotOrgExistsError extends Error {
  constructor(public readonly email: string) {
    super(
      `A dashboard user already exists for ${email}. Refusing to re-provision (it would orphan the existing org). ` +
        `Pass --reissue-link to mint a fresh set-password link instead.`,
    );
    this.name = "PilotOrgExistsError";
  }
}

export class PilotOwnerNotFoundError extends Error {
  constructor(public readonly email: string) {
    super(
      `No dashboard user found for ${email}. Provision the pilot first (run without --reissue-link).`,
    );
    this.name = "PilotOwnerNotFoundError";
  }
}

export interface ProvisionPilotInput {
  email: string;
  name?: string | null;
  /** Base URL for the set-password link. Defaults to NEXTAUTH_URL / NEXT_PUBLIC_APP_URL / localhost. */
  baseUrl?: string;
  /** Injectable clock (ms since epoch) for deterministic expiry in tests. */
  nowMs?: number;
}

export interface ReissueInput {
  email: string;
  baseUrl?: string;
  nowMs?: number;
}

export interface ProvisionPilotResult {
  organizationId: string;
  ownerEmail: string;
  /** Riley's deployment id, or null if eager seeding was skipped (it will then
   *  seed lazily on the owner's first dashboard load). */
  rileyDeploymentId: string | null;
  setupUrl: string;
  setupLinkExpiresAt: Date;
}

export interface ReissueResult {
  organizationId: string;
  ownerEmail: string;
  setupUrl: string;
  setupLinkExpiresAt: Date;
}

/**
 * The heavy, multi-step collaborators are injected (not imported) so the
 * orchestration here (ordering, the no-clobber guard, link minting) is
 * unit-testable without a database, and so this module stays free of the
 * ESM-only `@switchboard/db` runtime import that the dashboard's vitest cannot
 * resolve. The composition root (the scripts/provision-pilot.mts CLI) wires the
 * real implementations; TypeScript checks them against these contracts there.
 */
export interface ProvisionPilotDeps {
  provisionDashboardUser: (
    prisma: PrismaClient,
    input: { email: string; name?: string | null },
  ) => Promise<DashboardUser>;
  provisionOrgAgentDeployments: (
    prisma: PrismaClient,
    organizationId: string,
    opts: { mira: boolean },
  ) => Promise<{ riley: { deploymentId: string } }>;
}

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`Invalid email: ${JSON.stringify(raw)}`);
  }
  return email;
}

function resolveBaseUrl(explicit?: string): string {
  const base =
    explicit?.trim() ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3002";
  return base.replace(/\/+$/, "");
}

/**
 * Mint a single-use set-password token for `userId` and return the reset URL.
 * Reuses the production token format (`hashResetToken` + the
 * `dashboardPasswordResetToken` row the reset-consume path reads) so the link
 * is consumable by the existing `/reset-password` flow — just with the longer
 * onboarding expiry. Bypasses `requestPasswordReset`, which (correctly, for the
 * public flow) refuses passwordless accounts and rate-limits.
 */
async function mintSetupLink(
  prisma: PrismaClient,
  userId: string,
  baseUrl: string,
  nowMs: number,
): Promise<{ url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(nowMs + SETUP_LINK_EXPIRY_HOURS * 60 * 60 * 1000);
  await prisma.dashboardPasswordResetToken.create({
    data: { userId, tokenHash: hashResetToken(token), expiresAt },
  });
  return { url: `${baseUrl}/reset-password?token=${token}`, expiresAt };
}

export async function provisionPilotOrg(
  prisma: PrismaClient,
  input: ProvisionPilotInput,
  deps: ProvisionPilotDeps,
): Promise<ProvisionPilotResult> {
  const email = normalizeEmail(input.email);
  const nowMs = input.nowMs ?? Date.now();

  // No-clobber guard: provisionDashboardUser creates on a @unique email and
  // would throw P2002, so check first and fail with an actionable message.
  const existing = await prisma.dashboardUser.findUnique({ where: { email } });
  if (existing) throw new PilotOrgExistsError(email);

  // Canonical onboarding: org + config (entitled F-02 + business hours F-01) +
  // owner principal/identity + day-one agent enablement.
  const user = await deps.provisionDashboardUser(prisma, { email, name: input.name ?? null });

  // Eagerly seed Riley's deployment + require-approval governance so the org is
  // operational for inbound before the owner first loads the dashboard. Mira
  // stays day-thirty (the deliberate-operator tier). This is an OPTIMIZATION
  // over the lazy GET /config seeding (idempotent, guarded by
  // findExistingDeployment): if it fails the org is still fully provisioned and
  // Riley seeds on the owner's first dashboard load, so degrade — never abort an
  // otherwise-complete provision on this optional step.
  let rileyDeploymentId: string | null = null;
  try {
    const agents = await deps.provisionOrgAgentDeployments(prisma, user.organizationId, {
      mira: false,
    });
    rileyDeploymentId = agents.riley.deploymentId;
  } catch {
    // best-effort: Riley self-heals via the lazy GET /config seeding path.
  }

  const { url, expiresAt } = await mintSetupLink(
    prisma,
    user.id,
    resolveBaseUrl(input.baseUrl),
    nowMs,
  );

  return {
    organizationId: user.organizationId,
    ownerEmail: email,
    rileyDeploymentId,
    setupUrl: url,
    setupLinkExpiresAt: expiresAt,
  };
}

/**
 * Mint a fresh set-password link for an already-provisioned pilot owner,
 * without re-provisioning the org. Covers the common "the link lapsed before
 * the owner used it" case.
 */
export async function reissueSetupLink(
  prisma: PrismaClient,
  input: ReissueInput,
): Promise<ReissueResult> {
  const email = normalizeEmail(input.email);
  const nowMs = input.nowMs ?? Date.now();

  const user = await prisma.dashboardUser.findUnique({ where: { email } });
  if (!user) throw new PilotOwnerNotFoundError(email);

  const { url, expiresAt } = await mintSetupLink(
    prisma,
    user.id,
    resolveBaseUrl(input.baseUrl),
    nowMs,
  );

  return {
    organizationId: user.organizationId,
    ownerEmail: email,
    setupUrl: url,
    setupLinkExpiresAt: expiresAt,
  };
}
