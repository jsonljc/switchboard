// Unconditional single-value requirements. Each must be present on its own.
export const REQUIRED_ENV = ["DATABASE_URL"] as const;

// Session-signing secret. `SESSION_TOKEN_SECRET` is canonical (render.yaml declares it and
// session-bootstrap reads it); `NEXTAUTH_SECRET` is accepted as a fallback so deployments that
// only set the shared NextAuth secret still boot. The gate is satisfied by EITHER being set —
// mirroring resolveOAuthStateSecret, which reads SESSION_TOKEN_SECRET ?? NEXTAUTH_SECRET. Listing
// SESSION_TOKEN_SECRET first makes it the name surfaced in the actionable boot error.
export const SESSION_SECRET_KEYS = ["SESSION_TOKEN_SECRET", "NEXTAUTH_SECRET"] as const;

export function assertRequiredEnv(): void {
  const missing: string[] = REQUIRED_ENV.filter((k) => !process.env[k]);
  // The session secret is an either-or group: missing only when NEITHER is set.
  if (!SESSION_SECRET_KEYS.some((k) => process.env[k])) {
    missing.push(SESSION_SECRET_KEYS.join(" or "));
  }
  if (missing.length === 0) return;
  console.error(
    `[api] Missing required env vars: ${missing.join(", ")}.\n` +
      "      In a worktree? Run `pnpm worktree:init` from the worktree root.\n" +
      "      Otherwise, copy .env.example to .env and set the missing vars.",
  );
  process.exit(1);
}
