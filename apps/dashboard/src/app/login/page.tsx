"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn, useSession, SessionProvider } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, LogIn } from "lucide-react";

const smtpConfigured = process.env.NEXT_PUBLIC_SMTP_CONFIGURED === "true";
const googleConfigured = process.env.NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED === "true";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const isVerify = searchParams.get("verify") === "true";
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.push(callbackUrl);
    }
  }, [status, callbackUrl, router]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setIsLoading(false);
    } else {
      window.location.href = callbackUrl;
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await signIn("email", { email, callbackUrl });
    setIsLoading(false);
  };

  if (isVerify) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Check your email</h1>
          <p className="text-[15px] text-muted-foreground mt-2">
            We sent you a magic link. Click the link in your email to sign in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Switchboard</h1>
          <p className="text-[15px] text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        {googleConfigured && (
          <>
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl })}
              className="w-full flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>
          </>
        )}

        {showMagicLink ? (
          <>
            <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="magic-email">Email</Label>
                <Input
                  id="magic-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full min-h-[44px]" disabled={isLoading || !email}>
                <Mail className="mr-2 h-4 w-4" />
                {isLoading ? "Sending..." : "Send magic link"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline"
                onClick={() => {
                  setShowMagicLink(false);
                  setError("");
                }}
              >
                Sign in with password instead
              </button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button
                type="submit"
                className="w-full min-h-[44px]"
                disabled={isLoading || !email || !password}
              >
                <LogIn className="mr-2 h-4 w-4" />
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
            {smtpConfigured && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground underline"
                  onClick={() => {
                    setShowMagicLink(true);
                    setError("");
                  }}
                >
                  Or sign in with magic link
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <SessionProvider>
      <Suspense>
        <LoginForm />
      </Suspense>
    </SessionProvider>
  );
}
