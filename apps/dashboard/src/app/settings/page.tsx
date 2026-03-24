"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) {
      router.replace("/settings/team");
    }
  }, [router]);

  return null;
}
