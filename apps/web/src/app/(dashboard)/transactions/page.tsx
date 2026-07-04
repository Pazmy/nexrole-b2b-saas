import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import TransactionFilters from "@/components/transaction-filters";
import { ArrowLeft, ArrowRight, AlertCircle } from "lucide-react";
import Link from "next/link";

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string; search?: string }>;
}

export default async function TransactionsPage({ searchParams }: PageProps) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!tenantId || !uuidRegex.test(tenantId)) {
    return (
      <div className="p-8 text-center text-red-400">
        Error: Invalid or missing organization credentials. Please sign in again.
      </div>
    );
  }

  const resolvedParams = await searchParams;
  const currentPage = Number(resolvedParams.page) || 1;
  const currentStatus = resolvedParams.status || "all";
  const currentSearch = resolvedParams.search || "";

  const pageSize = 5;

  // Assemble dynamic multi-tenant queries
  const whereClause: {
    tenantId?: string;
    status?: string;
    description?: {
      contains: string;
      mode: "insensitive";
    };
  } = {
    tenantId: tenantId, // Strict tenancy isolation barrier!
  };

  if (currentStatus !== "all") {
    whereClause.status = currentStatus;
  }

  if (currentSearch) {
    whereClause.description = {
      contains: currentSearch,
      mode: "insensitive", // Ignore casing mismatches
    };
  }

  const [transactions, totalRecords] = await Promise.all([
    prisma.transaction.findMany({
      where: whereClause,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.count({
      where: whereClause,
    }),
  ]);

  const totalPages = Math.ceil(totalRecords / pageSize) || 1;

  // Helper template string function to pass pagination variables forward
  const getPaginationUrl = (pageNumber: number) => {
    const params = new URLSearchParams();
    if (currentStatus !== "all") params.set("status", currentStatus);
    if (currentSearch) params.set("search", currentSearch);
    params.set("page", pageNumber.toString());
    return `?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ledger Operations</h1>
        <p className="text-zinc-400 mt-1">
          Audit logs and transactional history scoped to your enterprise
          container.
        </p>
      </div>

      <TransactionFilters />

      {/* DATA VIEW COMPONENT AREA */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500 gap-3">
            <AlertCircle className="h-8 w-8 text-zinc-600" />
            <p className="text-sm font-medium">
              No matching ledger activities recorded.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/40 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <th className="p-4">Description</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-right">Settled Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-sm">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-zinc-850/30 transition-colors group"
                  >
                    <td className="p-4 text-zinc-200 font-medium max-w-xs md:max-w-md truncate">
                      {tx.description}
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide border ${
                          tx.status === "completed"
                            ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-400"
                            : tx.status === "pending"
                              ? "bg-amber-950/40 border-amber-800/50 text-amber-400"
                              : "bg-red-950/40 border-red-800/50 text-red-400"
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono text-zinc-100 font-semibold">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                      }).format(Number(tx.amount))}
                    </td>
                    <td className="p-4 text-right font-mono text-zinc-500 text-xs">
                      {new Date(tx.createdAt).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PAGINATION CONTROL COMPONENT WRAPPER */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border border-zinc-850 bg-zinc-900/20 px-6 py-4 rounded-xl">
          <p className="text-xs text-zinc-500">
            Showing Page{" "}
            <span className="font-semibold text-zinc-300">{currentPage}</span>{" "}
            of <span className="font-semibold text-zinc-300">{totalPages}</span>{" "}
            ({totalRecords} total entries)
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={getPaginationUrl(currentPage - 1)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium border border-zinc-800 bg-zinc-900 transition-colors ${
                currentPage <= 1
                  ? "pointer-events-none opacity-40"
                  : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
              }`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Previous
            </Link>
            <Link
              href={getPaginationUrl(currentPage + 1)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium border border-zinc-800 bg-zinc-900 transition-colors ${
                currentPage >= totalPages
                  ? "pointer-events-none opacity-40"
                  : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
              }`}
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
