"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { OwnerToday } from "@/components/dashboard/owner-today";

export default function HomePage() {
  const { status } = useSession();

  if (status === "unauthenticated") redirect("/login");

  return <OwnerToday />;
}
