"use client";

import { useTransactionSubmit } from "./use-transaction-submit";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateTransactionStatusAction } from "@/app/(dashboard)/transactions/status-action";

export default function TransactionStatusForm({ id, status, canWrite }: { id: string; status: string; canWrite: boolean }) {
  const { state, submit, pending } = useTransactionSubmit(updateTransactionStatusAction, {
    success: false, code: "unavailable", error: "Could not confirm the update. Refresh before trying again.",
  }, `transaction-status:${id}`);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4 max-w-md">
      <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-200">Update status</h2>
      {state && <p role={state.success ? "status" : "alert"} className={`text-sm ${state.success ? "text-emerald-400" : "text-red-400"}`}>{state.success ? state.message : state.error}</p>}
      {status !== "pending" || state?.success ? <p className="text-sm text-zinc-400">This status is final and cannot be changed.</p>
        : !canWrite ? <p className="text-sm text-zinc-400">Your subscription does not allow status changes. <Link href="/settings?tab=profile" className="text-blue-400 hover:underline">Review billing settings</Link></p>
          : <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
            <input type="hidden" name="id" value={id} />
            <label className="block text-xs font-medium uppercase text-zinc-400" htmlFor="transaction-status">New status</label>
            <select id="transaction-status" name="status" disabled={pending} defaultValue="completed" className="w-full rounded-md bg-zinc-950 border border-zinc-700 text-white p-2 text-sm focus-visible:ring-1 focus-visible:ring-zinc-500">
              <option value="completed">Completed</option><option value="failed">Failed</option>
            </select>
            <p className="text-xs text-zinc-400">This change is final. Completed and Failed transactions cannot be reopened.</p>
            <Button type="submit" disabled={pending} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? "Saving status..." : "Save status"}
            </Button>
          </form>}
    </section>
  );
}
