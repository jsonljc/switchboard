import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorChatWidget } from "@/components/operator-chat/operator-chat-widget";
import { Toaster } from "@/components/ui/toaster";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <AppShell>{children}</AppShell>
      </ErrorBoundary>
      <OperatorChatWidget />
      <Toaster />
    </AuthProvider>
  );
}
