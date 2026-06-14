import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorChatWidget } from "@/components/operator-chat/operator-chat-widget";
import { Toaster } from "@/components/ui/toaster";
import { MetaSdkScript } from "@/components/settings/meta-sdk-script";
import { getServerSession } from "@/lib/session";
import { getDataMode } from "@/lib/data-mode/server";
import { isFixtureModeAllowed } from "@/lib/data-mode/shared";
import { DataModeProvider } from "@/lib/data-mode/client";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const mode = await getDataMode();
  const dataModeControlsAllowed = isFixtureModeAllowed(process.env);

  return (
    <AuthProvider session={session}>
      <DataModeProvider mode={mode}>
        <ErrorBoundary>
          <AppShell dataModeControlsAllowed={dataModeControlsAllowed}>{children}</AppShell>
        </ErrorBoundary>
        <OperatorChatWidget />
        <Toaster />
        <MetaSdkScript />
      </DataModeProvider>
    </AuthProvider>
  );
}
