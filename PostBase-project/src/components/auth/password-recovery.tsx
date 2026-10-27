"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!reset);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!reset) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data, error }) => {
        if (cancelled) return;
        setReady(Boolean(data.user) && !error);
        if (!data.user || error)
          setError("Your reset link has expired. Request a new link.");
      })
      .catch(() => {
        if (!cancelled)
          setError("Unable to verify your reset link. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [reset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (reset && password !== form.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const auth = createClient().auth;
      const result = reset
        ? await auth.updateUser({ password })
        : await auth.resetPasswordForEmail(String(form.get("email")).trim(), {
            redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
          });
      if (result.error) throw result.error;
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to complete your request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto my-12 max-w-md space-y-6 rounded-2xl border bg-card p-6">
      <h1 className="text-2xl font-bold">
        {reset ? "Choose a new password" : "Reset your password"}
      </h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {done ? (
        <p role="status">
          {reset
            ? "Your password has been updated."
            : "If an account exists for that email, you will receive a password reset link."}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {reset ? (
            <>
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </>
          ) : (
            <>
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </>
          )}
          <Button type="submit" disabled={busy || !ready}>
            {busy
              ? "Please wait…"
              : reset
                ? "Update password"
                : "Send reset link"}
          </Button>
        </form>
      )}
      <div className="flex gap-4 text-sm text-brand-blue">
        <Link href="/login">Back to sign in</Link>
        {reset && <Link href="/forgot-password">Request a new link</Link>}
      </div>
    </div>
  );
}
