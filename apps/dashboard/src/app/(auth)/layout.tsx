import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorChatWidget } from "@/components/operator-chat/operator-chat-widget";
import { Toaster } from "@/components/ui/toaster";
import { getServerSession } from "@/lib/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  return (
    <AuthProvider session={session}>
      <ErrorBoundary>
        <AppShell>{children}</AppShell>
      </ErrorBoundary>
      <OperatorChatWidget />
      <Toaster />
    </AuthProvider>
  );
}
