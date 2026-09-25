"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AccountState } from "@/lib/account-validation";

type Field = { name: string; label: string; type: "email" | "password"; autoComplete?: string };
export function AccountForm({ title, description, action, fields = [], token, button, finishOnSuccess = true }: {
  title: string; description: string; action: (state: AccountState, form: FormData) => Promise<AccountState>;
  fields?: Field[]; token?: string; button: string; finishOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return <section className="mx-auto w-full max-w-md space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-zinc-100">
    <h1 className="text-2xl font-semibold">{title}</h1>
    <p className="text-sm text-zinc-400">{description}</p>
    {state?.message && <p role="status" className="text-sm text-emerald-400">{state.message}</p>}
    {!(state?.success && finishOnSuccess) && <form action={formAction} className="space-y-4">
      {token && <input type="hidden" name="token" value={token} />}
      {fields.map((field) => <div key={field.name} className="space-y-2">
        <label htmlFor={field.name} className="text-sm">{field.label}</label>
        <Input id={field.name} name={field.name} type={field.type} autoComplete={field.autoComplete} required disabled={pending}
          minLength={field.autoComplete === "new-password" ? 12 : undefined} />
        {field.autoComplete === "new-password" && <p className="text-xs text-zinc-400">Use at least 12 characters (at most 72 bytes).</p>}
      </div>)}
      {state?.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Please wait..." : button}</Button>
    </form>}
    <nav className="flex flex-wrap gap-4 text-sm text-blue-400">
      <Link href="/login">Sign in</Link><Link href="/verify-email">Resend verification</Link><Link href="/forgot-password">Forgot password</Link>
    </nav>
  </section>;
}
