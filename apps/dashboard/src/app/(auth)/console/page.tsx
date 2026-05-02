"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ConsoleView } from "@/components/console/console-view";

export default function ConsolePage() {
  const { status } = useSession();
  if (status === "unauthenticated") redirect("/login");
  return <ConsoleView />;
}
