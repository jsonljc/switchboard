"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings/team", label: "AI Team" },
  { href: "/decide", label: "Decide" },
  { href: "/settings", label: "Settings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/login", label: "Login" },
];

export function DevPanel() {
  if (process.env.NODE_ENV === "production") return null;

  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  if (session?.user?.id !== "dev-user") return null;

  return (
    <div className="fixed bottom-24 right-4 z-[100] md:bottom-4">
      {open && (
        <nav className="mb-2 rounded-lg border-2 border-yellow-400 bg-gray-900 p-3 shadow-lg">
          <ul className="space-y-1">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`block rounded px-3 py-1.5 text-sm transition-colors ${
                    pathname === href
                      ? "bg-yellow-400/20 font-medium text-yellow-300"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="ml-auto flex h-10 items-center gap-1.5 rounded-full border-2 border-yellow-400 bg-gray-900 px-4 text-sm font-bold text-yellow-400 shadow-lg transition-colors hover:bg-yellow-400 hover:text-gray-900"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
        DEV
      </button>
    </div>
  );
}
