import type { ReactNode } from "react";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";

export default function MercuryLayout({ children }: { children: ReactNode }) {
  return <EditorialAuthShell>{children}</EditorialAuthShell>;
}
