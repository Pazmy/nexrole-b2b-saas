import Link from "next/link";

export default function TransactionNotFound() {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
    <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Transaction not found</h1>
    <p className="text-sm text-zinc-400">This transaction is not available in your workspace.</p>
    <Link href="/transactions" className="inline-block text-sm text-blue-400 hover:underline">Back to transactions</Link>
  </div>;
}
