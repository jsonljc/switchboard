"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

type Step = "connect-meta" | "select-account" | "set-targets" | "connect-capi" | "activate";

const STEPS: Step[] = ["connect-meta", "select-account", "set-targets", "connect-capi", "activate"];

interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
  status: number;
}

interface ImproveSpendSetupProps {
  initialStep?: string;
  onComplete: () => void;
  deploymentId?: string;
}

function ConnectMetaStep({ error, onConnect }: { error: string | null; onConnect: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Connect Meta Ads</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with Facebook to grant access to your ad accounts.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        <p>You&apos;ll be redirected to Facebook to authorize Switchboard.</p>
        <p className="mt-1">
          Permissions requested: <strong>ads_read</strong>, <strong>ads_management</strong>,{" "}
          <strong>business_management</strong>
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onConnect}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
      >
        Connect with Facebook
      </button>
    </div>
  );
}

function SelectAccountStep({
  accounts,
  loading,
  error,
  selectedAccountId,
  onSelectAccount,
  onConfirm,
}: {
  accounts: AdAccount[];
  loading: boolean;
  error: string | null;
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Select ad account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which ad account Switchboard should optimize.
        </p>
      </div>
      {loading && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center">
          Loading ad accounts…
        </div>
      )}
      {!loading && accounts.length === 0 && !error && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center">
          No ad accounts found. Make sure your Facebook account has active ad accounts.
        </div>
      )}
      {!loading && accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((account) => (
            <button
              key={account.accountId}
              type="button"
              onClick={() => onSelectAccount(account.accountId)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selectedAccountId === account.accountId
                  ? "border-foreground bg-muted"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="font-medium">{account.name}</span>
              <span className="ml-2 text-muted-foreground">
                (act_{account.accountId}) · {account.currency}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onConfirm}
        disabled={!selectedAccountId || loading}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving…" : "Confirm selection"}
      </button>
    </div>
  );
}

function ComingSoonStep({ step }: { step: Step }) {
  const titles: Record<Step, string> = {
    "connect-meta": "",
    "select-account": "",
    "set-targets": "Set optimization targets",
    "connect-capi": "Connect Conversions API",
    activate: "Activate Improve Spend",
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{titles[step]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">This step is coming soon.</p>
      </div>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Coming soon — this step is not yet available in the beta.
      </div>
    </div>
  );
}

export function ImproveSpendSetup({
  initialStep,
  onComplete,
  deploymentId,
}: ImproveSpendSetupProps) {
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const deploymentIdParam = searchParams.get("deploymentId") ?? deploymentId;

  const resolvedInitialStep =
    connectedParam === "true" && initialStep === "select-account"
      ? "select-account"
      : STEPS.includes(initialStep as Step)
        ? (initialStep as Step)
        : "connect-meta";

  const [currentStep] = useState<Step>(resolvedInitialStep);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentIndex = STEPS.indexOf(currentStep);

  const fetchAccounts = useCallback(async () => {
    if (!deploymentIdParam) {
      setError("No deployment ID available. Please restart the setup.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentIdParam}/ad-account`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch ad accounts");
      }
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch ad accounts");
    } finally {
      setLoading(false);
    }
  }, [deploymentIdParam]);

  useEffect(() => {
    if (currentStep === "select-account") {
      fetchAccounts();
    }
  }, [currentStep, fetchAccounts]);

  const handleSelectAccount = useCallback(async () => {
    if (!selectedAccountId || !deploymentIdParam) return;
    const account = accounts.find((a) => a.accountId === selectedAccountId);
    if (!account) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentIdParam}/ad-account`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adAccountId: `act_${account.accountId}`,
            adAccountName: account.name,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save account selection");
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account selection");
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, deploymentIdParam, accounts, onComplete]);

  const handleConnectMeta = useCallback(() => {
    if (!deploymentIdParam) {
      setError("No deployment ID available. Please restart the setup.");
      return;
    }
    window.location.href = `/api/dashboard/connections/facebook/authorize?deploymentId=${deploymentIdParam}`;
  }, [deploymentIdParam]);

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="flex gap-1.5">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= currentIndex ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {currentStep === "connect-meta" && (
        <ConnectMetaStep error={error} onConnect={handleConnectMeta} />
      )}

      {currentStep === "select-account" && (
        <SelectAccountStep
          accounts={accounts}
          loading={loading}
          error={error}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          onConfirm={handleSelectAccount}
        />
      )}

      {(currentStep === "set-targets" ||
        currentStep === "connect-capi" ||
        currentStep === "activate") && <ComingSoonStep step={currentStep} />}
    </div>
  );
}
