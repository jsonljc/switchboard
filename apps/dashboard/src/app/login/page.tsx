"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, LogIn } from "lucide-react";

const smtpConfigured = process.env.NEXT_PUBLIC_SMTP_CONFIGURED === "true";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);
  const searchParams = useSearchParams();
  const isVerify = searchParams.get("verify") === "true";

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
      window.location.href = "/";
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await signIn("email", { email, callbackUrl: "/" });
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
                <Button
                  type="submit"
                  className="w-full min-h-[44px]"
                  disabled={isLoading || !email}
                >
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
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
