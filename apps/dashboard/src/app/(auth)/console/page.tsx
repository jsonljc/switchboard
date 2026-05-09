// apps/dashboard/src/app/(auth)/console/page.tsx
// Temporary C2a compatibility shim.
// Delete in C2b when Live Signal Overlay lands.
import { redirect } from "next/navigation";

export default function ConsolePage() {
  redirect("/");
}
