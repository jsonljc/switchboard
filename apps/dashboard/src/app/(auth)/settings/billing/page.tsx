"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { CreditCard, Check, ExternalLink, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBillingStatus, useCheckout, usePortal } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";

interface Plan {
  name: string;
  price: string;
  priceId: string;
  envKey: string;
  popular?: boolean;
  features: readonly string[];
}

const PLANS: readonly Plan[] = [
  {
    name: "Starter",
    price: "$49",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER || "",
    envKey: "NEXT_PUBLIC_STRIPE_PRICE_STARTER",
    features: ["1 AI operator", "500 conversations/mo", "Email + chat support", "Basic analytics"],
  },
  {
    name: "Pro",
    price: "$149",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO || "",
    envKey: "NEXT_PUBLIC_STRIPE_PRICE_PRO",
    popular: true,
    features: [
      "3 AI operators",
      "5,000 conversations/mo",
      "Priority support",
      "Advanced analytics",
      "Custom playbooks",
    ],
  },
  {
    name: "Scale",
    price: "$399",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE || "",
    envKey: "NEXT_PUBLIC_STRIPE_PRICE_SCALE",
    features: [
      "Unlimited operators",
      "Unlimited conversations",
      "Dedicated support",
      "Full analytics suite",
      "Custom integrations",
      "Team management",
    ],
  },
];

const stripeConfigured = PLANS.some((p) => p.priceId !== "");

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "active"
      ? "default"
      : status === "trialing"
        ? "secondary"
        : status === "past_due"
          ? "destructive"
          : "outline";

  const label =
    status === "active"
      ? "Active"
      : status === "trialing"
        ? "Trial"
        : status === "past_due"
          ? "Past Due"
          : status === "canceled"
            ? "Canceled"
            : "No Subscription";

  return <Badge variant={variant}>{label}</Badge>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function BillingPage() {
  const { status: sessionStatus } = useSession();
  const { data: billing, isLoading, isError, refetch } = useBillingStatus();
  const checkout = useCheckout();
  const portal = usePortal();

  if (sessionStatus === "unauthenticated") redirect("/login");

  const handleUpgrade = (priceId: string) => {
    checkout.mutate(priceId, {
      onSuccess: (result) => {
        window.location.href = result.url;
      },
    });
  };

  const handleManage = () => {
    portal.mutate(undefined, {
      onSuccess: (result) => {
        window.location.href = result.url;
      },
    });
  };

  // If Stripe is not configured or the API returns an error, show a friendly placeholder
  if (!stripeConfigured || isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Billing</h1>
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-medium text-foreground mb-1">
            Billing will be available soon
          </h2>
          <p className="text-[15px] text-muted-foreground max-w-md mx-auto">
            {"You're on the free beta right now. We'll notify you when paid plans are ready."}
          </p>
          {isError && (
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const hasSubscription = billing && billing.status !== "none";

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Billing</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Manage your subscription and payment details.
        </p>
      </section>

      {/* Current subscription summary */}
      {hasSubscription && billing && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <span className="text-lg font-medium text-foreground">
                    {billing.planName ?? "Current Plan"}
                  </span>
                  <StatusBadge status={billing.status} />
                </div>

                <div className="grid gap-1 text-[14px] text-muted-foreground">
                  {billing.status === "trialing" && billing.trialEnd && (
                    <p>Trial ends: {formatDate(billing.trialEnd)}</p>
                  )}
                  {billing.currentPeriodEnd && (
                    <p>
                      {billing.cancelAtPeriodEnd ? "Access until" : "Next billing date"}:{" "}
                      {formatDate(billing.currentPeriodEnd)}
                    </p>
                  )}
                  {billing.cancelAtPeriodEnd && (
                    <p className="text-amber-500">
                      Subscription will cancel at end of billing period
                    </p>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleManage}
                disabled={portal.isPending}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                {portal.isPending ? "Opening..." : "Manage Subscription"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan cards */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-foreground">
          {hasSubscription ? "Change Plan" : "Choose a Plan"}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = billing?.priceId === plan.priceId;
            const missingPrice = !plan.priceId;
            return (
              <Card
                key={plan.envKey}
                className={cn(
                  "relative",
                  plan.popular && "ring-1 ring-primary",
                  isCurrent && "ring-1 ring-foreground/30",
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-2.5 left-4">
                    <Badge variant="default" className="text-[11px]">
                      Recommended
                    </Badge>
                  </div>
                )}
                <CardContent className="p-6 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      {plan.price}
                      <span className="text-[14px] font-normal text-muted-foreground">/mo</span>
                    </p>
                  </div>

                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-[13.5px] text-muted-foreground"
                      >
                        <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Button
                    className="w-full"
                    variant={isCurrent ? "outline" : "default"}
                    size="sm"
                    disabled={isCurrent || missingPrice || checkout.isPending}
                    onClick={() => handleUpgrade(plan.priceId)}
                  >
                    {isCurrent
                      ? "Current Plan"
                      : missingPrice
                        ? "Coming Soon"
                        : checkout.isPending
                          ? "Redirecting..."
                          : "Upgrade"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
