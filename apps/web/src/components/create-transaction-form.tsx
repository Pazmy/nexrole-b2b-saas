"use client";

import { useState } from "react";
import { clearTransactionFeedback, useTransactionFeedback, useTransactionSubmit } from "./use-transaction-submit";
import Link from "next/link";
import { Check, DollarSign, FileText, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTransactionAction, type CreateTransactionState } from "@/app/(dashboard)/transactions/create-action";
import { TRANSACTION_DESCRIPTION_LIMIT } from "@/lib/transaction-rules";
import { getTransactionEntitlement, getTransactionWriteDecision } from "@/lib/transaction-entitlements";

export default function CreateTransactionForm({ storedCount, subscriptionStatus, tenantId }: { storedCount: number; subscriptionStatus: string; tenantId: string }) {
  const feedbackKey = `transaction-create:${tenantId}`;
  const feedback = useTransactionFeedback<CreateTransactionState>(feedbackKey);
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const entitlement = getTransactionEntitlement(subscriptionStatus);
  const decision = getTransactionWriteDecision(subscriptionStatus, { operation: "create", storedCount });
  const hint = !entitlement.canWrite
    ? "Your subscription does not currently allow new transactions. Review your billing settings."
    : entitlement.tier === "free"
      ? `${storedCount} / ${entitlement.maxStoredTransactions} stored transactions on Free.${decision.allowed ? "" : " Upgrade to create more."}`
      : `${storedCount} stored transactions on Pro. No transaction-count limit.`;

  return (
    <div className="space-y-3">
      <p id="transaction-usage" className="text-xs text-zinc-400">{hint}</p>
      {!open && !feedback ? (
        <Button type="button" disabled={!decision.allowed} aria-describedby="transaction-usage" onClick={() => setOpen(true)}
          className="h-9 px-4 rounded-md bg-zinc-100 hover:bg-zinc-200 text-sm font-semibold text-zinc-950 transition-colors gap-2">
          <Plus className="h-4 w-4" /> New transaction
        </Button>
      ) : (
        <TransactionFields key={formKey} feedbackKey={feedbackKey} initialDescription={feedback?.description || ""} initialAmount={feedback?.amount || ""} canCreate={decision.allowed}
          onClose={() => { clearTransactionFeedback(feedbackKey); setOpen(false); }}
          onAnother={() => { clearTransactionFeedback(feedbackKey); setOpen(true); setFormKey((key) => key + 1); }} />
      )}
      {!decision.allowed && <Link href="/settings?tab=profile" className="inline-block text-xs text-blue-400 hover:underline">Review billing settings</Link>}
    </div>
  );
}

function TransactionFields({ canCreate, onClose, onAnother, feedbackKey, initialDescription, initialAmount }: { canCreate: boolean; onClose: () => void; onAnother: () => void; feedbackKey: string; initialDescription: string; initialAmount: string }) {
  const [description, setDescription] = useState(initialDescription);
  const [amount, setAmount] = useState(initialAmount);
  const { state, submit, pending } = useTransactionSubmit(createTransactionAction, {
    success: false, code: "unavailable", error: "We could not confirm the result. Check the transaction list before trying again.",
  }, feedbackKey);

  return (
    <section className="border border-zinc-800 bg-zinc-900 p-5 rounded-xl max-w-md w-full animate-in fade-in-50 duration-200" aria-labelledby="create-transaction-title">
      <div className="flex items-center justify-between mb-4">
        <h2 id="create-transaction-title" className="text-sm font-bold text-zinc-200 uppercase tracking-wide">New transaction</h2>
        <button type="button" disabled={pending} onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50">
          {state?.success ? "Close" : "Cancel"}
        </button>
      </div>
      {state?.success ? (
        <div className="space-y-3">
          <p role="status" className="flex items-center gap-2 text-sm text-emerald-400"><Check className="h-4 w-4" />{state.message}</p>
          <p className="text-xs text-zinc-400">The list has been refreshed. Current filters or pagination may hide your new transaction.</p>
          <Link href="/transactions" className="inline-block text-xs text-blue-400 hover:underline">View latest transactions</Link>
          <Button type="button" disabled={!canCreate} onClick={onAnother} variant="ghost"
            className="w-full text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:bg-zinc-800 h-8">Create another transaction</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
          <div className="space-y-1.5">
            <label htmlFor="transaction-description" className="text-xs text-zinc-400 font-medium uppercase">Description</label>
            <div className="relative">
              <FileText className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input id="transaction-description" name="description" value={description} onChange={(event) => setDescription(event.target.value)}
                required maxLength={TRANSACTION_DESCRIPTION_LIMIT} disabled={pending} placeholder="Consulting services"
                className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700 focus-visible:ring-zinc-700" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="transaction-amount" className="text-xs text-zinc-400 font-medium uppercase">Amount (USD)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input id="transaction-amount" name="amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
                required disabled={pending} placeholder="125.50" aria-describedby="transaction-amount-help"
                className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700 focus-visible:ring-zinc-700" />
            </div>
            <p id="transaction-amount-help" className="text-xs text-zinc-500">USD 0.01–99,999,999.99. Use a decimal point and up to two decimal places. New transactions start as Pending.</p>
          </div>
          {state && !state.success && <p role="alert" className="text-xs text-red-400">{state.error}</p>}
          <Button type="submit" disabled={pending || !canCreate} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium gap-2">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {pending ? "Creating transaction..." : "Create transaction"}
          </Button>
        </form>
      )}
    </section>
  );
}
