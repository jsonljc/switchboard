"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useViewPreference } from "@/hooks/use-view-preference";
import { OwnerToday } from "@/components/dashboard/owner-today";
import { StaffDashboard } from "@/components/dashboard/staff-dashboard";

export default function HomePage() {
  const { status } = useSession();
  const { isOwner } = useViewPreference();

  if (status === "unauthenticated") redirect("/login");

  return isOwner ? <OwnerToday /> : <StaffDashboard />;
}
