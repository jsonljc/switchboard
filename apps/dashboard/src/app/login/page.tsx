"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="min-h-screen flex items-center justify-center p-4 md:pl-0">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent you a magic link. Click the link in your email to sign in.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:pl-0">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Switchboard</CardTitle>
          <CardDescription>Sign in to manage your AI agents</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
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
