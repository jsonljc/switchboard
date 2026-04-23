import { handlers } from "@/lib/auth";
import { assertSafeDashboardAuthEnv } from "@/lib/dev-auth";

export function GET(...args: Parameters<typeof handlers.GET>) {
  assertSafeDashboardAuthEnv();
  return handlers.GET(...args);
}

export function POST(...args: Parameters<typeof handlers.POST>) {
  assertSafeDashboardAuthEnv();
  return handlers.POST(...args);
}
