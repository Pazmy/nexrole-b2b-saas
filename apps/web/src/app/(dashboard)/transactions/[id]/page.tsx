import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTransactionDetail } from "@/lib/transaction-detail";
import { hasPermission } from "@/lib/permissions";
import { getTransactionEntitlement } from "@/lib/transaction-entitlements";
import TransactionStatusForm from "@/components/transaction-status-form";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const result = await getTransactionDetail((await params).id);
  if (!result) notFound();
  const { transaction: tx, role } = result;
  return <div className="space-y-6">
    <Link href="/transactions" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to transactions</Link>
    <div><h1 className="text-3xl font-bold tracking-tight text-zinc-100">Transaction details</h1><p className="text-sm text-zinc-400 mt-1">Review this workspace transaction and its current status.</p></div>
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <dl className="grid gap-6 sm:grid-cols-2 text-sm">
        <div className="sm:col-span-2"><dt className="text-zinc-400">Description</dt><dd className="mt-1 text-zinc-100 break-words">{tx.description}</dd></div>
        <div><dt className="text-zinc-400">Amount (USD)</dt><dd className="mt-1 font-mono text-zinc-100">${tx.amount.toFixed(2)}</dd></div>
        <div><dt className="text-zinc-400">Status</dt><dd className={`mt-1 uppercase font-medium ${tx.status === "completed" ? "text-emerald-400" : tx.status === "pending" ? "text-amber-400" : "text-red-400"}`}>{tx.status}</dd></div>
        <div><dt className="text-zinc-400">Created</dt><dd className="mt-1 text-zinc-300">{tx.createdAt.toISOString()}</dd></div>
        <div><dt className="text-zinc-400">Last updated</dt><dd className="mt-1 text-zinc-300">{tx.updatedAt.toISOString()}</dd></div>
        <div className="sm:col-span-2"><dt className="text-zinc-400">Transaction ID</dt><dd className="mt-1 font-mono text-xs text-zinc-300 break-all">{tx.id}</dd></div>
      </dl>
    </div>
    {hasPermission(role, "transactions:update-status") ? <TransactionStatusForm id={tx.id} status={tx.status} canWrite={getTransactionEntitlement(tx.tenant.subscriptionStatus).canWrite} />
      : <p className="text-sm text-zinc-400">Your role has read-only access to transactions.</p>}
  </div>;
}
