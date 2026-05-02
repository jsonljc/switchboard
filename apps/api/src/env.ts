export const REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET"] as const;

export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(
    `[api] Missing required env vars: ${missing.join(", ")}.\n` +
      "      In a worktree? Run `pnpm worktree:init` from the worktree root.\n" +
      "      Otherwise, copy .env.example to .env and set the missing vars.",
  );
  process.exit(1);
}
