"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between h-14 px-4">
        <h1 className="text-lg font-semibold md:hidden">Switchboard</h1>
        <div className="hidden md:block" />
        {session?.user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">{session.user.email}</span>
            </div>
            <ThemeToggle />
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-2"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
