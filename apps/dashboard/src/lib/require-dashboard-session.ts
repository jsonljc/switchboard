import { requireSession } from "@/lib/session";

export async function requireDashboardSession() {
  return requireSession();
}
