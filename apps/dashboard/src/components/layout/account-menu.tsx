"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgConfig } from "@/hooks/use-org-config";
import { signOut } from "@/lib/sign-out";

// Stripe is "configured" when at least one plan price ID is present — mirrors
// the gate the billing page itself uses, so Billing only appears when payable.
const STRIPE_CONFIGURED = !!(
  process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER ||
  process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ||
  process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE
);

export function accountMenuLinks(
  stripeConfigured: boolean,
): ReadonlyArray<{ label: string; href: string }> {
  return [
    { label: "Account", href: "/settings/account" },
    ...(stripeConfigured ? [{ label: "Billing", href: "/settings/billing" }] : []),
  ];
}

function initialFor(email: string | null | undefined): string {
  return email?.trim().charAt(0).toUpperCase() || "M";
}

export function AccountMenu() {
  const { data: session } = useSession();
  const { data: orgData } = useOrgConfig();
  const queryClient = useQueryClient();

  const email = (session?.user?.email as string | undefined) ?? undefined;
  const orgName = orgData?.config?.name;
  const links = accountMenuLinks(STRIPE_CONFIGURED);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="me-chip" aria-label="Account menu">
        {initialFor(email)}
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent sideOffset={6} align="end">
          <DropdownMenuLabel>
            <span style={{ display: "block", fontWeight: 600 }}>{orgName ?? "Your workspace"}</span>
            {email && (
              <span style={{ display: "block", fontWeight: 400, opacity: 0.7 }}>{email}</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {links.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href}>{link.label}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut(queryClient)}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
