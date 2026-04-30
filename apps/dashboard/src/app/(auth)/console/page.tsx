"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ConsoleView } from "@/components/console/console-view";
import { useConsoleData } from "@/components/console/use-console-data";

export default function ConsolePage() {
  const { status } = useSession();
  const { data } = useConsoleData();

  if (status === "unauthenticated") redirect("/login");

  return <ConsoleView data={data} />;
}
