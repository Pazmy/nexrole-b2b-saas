"use client";

import { useActionState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { acceptInvitationAction } from "@/app/account-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function InviteAcceptanceForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, null);

  if (state?.success) {
    return (
      <div className="space-y-4 text-center">
        <p role="status" className="text-sm text-emerald-400">{state.message}</p>
        <Button asChild className="w-full bg-blue-600 hover:bg-blue-700 font-medium text-white">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="token" value={token} />

      <div className="space-y-1.5">
        <label htmlFor="invite-account-email" className="text-xs text-zinc-400 font-medium uppercase">
          Your Account Email
        </label>
        <Input
          id="invite-account-email"
          value={email}
          disabled
          className="bg-zinc-950 border-zinc-800 text-zinc-500 disabled:opacity-100 font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="invite-account-password" className="text-xs text-zinc-400 font-medium uppercase">
          Account Password
        </label>
        <Input
          id="invite-account-password"
          name="password"
          type="password"
          placeholder="Choose a password"
          autoComplete="new-password"
          minLength={12}
          required
          disabled={pending}
          aria-describedby="invite-password-help"
          className="bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700"
        />
        <p id="invite-password-help" className="text-xs text-zinc-400">
          Use at least 12 characters (at most 72 bytes).
        </p>
      </div>

      {state?.error && <p role="alert" className="text-xs text-red-400">{state.error}</p>}

      <Button
        type="submit"
        disabled={pending}
        className="w-full bg-blue-600 hover:bg-blue-700 font-medium gap-2 text-white"
      >
        <UserPlus className="h-4 w-4" />
        {pending ? "Joining workspace..." : "Complete Workspace Enrollment"}
      </Button>
    </form>
  );
}
