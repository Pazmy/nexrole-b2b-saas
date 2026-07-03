"use client";

import { useActionState } from "react";
import { registerWorkSpace } from "./action";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Building2, Mail, Lock, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function RegisterWorkspacePage() {
  const [state, formAction, isPending] = useActionState(
    registerWorkSpace,
    null,
  );

  if (state?.success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400">
            ✓
          </div>
          <h1 className="text-2xl font-bold">Enterprise Primed!</h1>
          <p className="text-sm text-zinc-400">
            Your multi-tenant company container and administrator profile have
            been successfully deployed.
          </p>
          <Link
            href="/login"
            className="inline-flex w-full h-9 items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors"
          >
            Sign In to Console
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">NexRole</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Deploy a fresh multi-tenant company instance
          </p>
        </div>

        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Company Name
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input
                name="name"
                placeholder="Sensei Industries Ltd"
                className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-600"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Admin Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input
                name="email"
                type="email"
                placeholder="ceo@company.com"
                className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-600"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Secure Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input
                name="password"
                type="password"
                placeholder="••••••••"
                className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-600"
                required
              />
            </div>
          </div>

          {state?.error && (
            <p className="text-xs font-medium text-red-400 bg-red-950/30 border border-red-900/40 p-2.5 rounded-lg">
              {state.error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2"
          >
            {isPending ? "Provisioning..." : "Launch Core Instance"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <p className="text-center text-xs text-zinc-500">
          Already have an operational workspace?{" "}
          <Link href="/login" className="text-blue-400 hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
