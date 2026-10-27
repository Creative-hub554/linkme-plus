"use client";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
export default function AccountRestrictedPage() {
  return (
    <div className="mx-auto my-12 max-w-lg space-y-5 rounded-xl border bg-card p-6">
      <h1 className="text-2xl font-bold">Account restricted</h1>
      <p>
        Your account is currently suspended or banned. Contact the platform team
        if you believe this is a mistake.
      </p>
      <Button
        onClick={async () => {
          await signOut();
          window.location.assign("/login");
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
