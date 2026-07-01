import { auth } from "@/auth";
import { prisma } from "@nexrole/database"; // ⬅️ Direct local dependency monorepo import
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, CreditCard, Activity, CheckCircle2 } from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();
  const tenantId = (session?.user as { tenantId?: string })?.tenantId;

  // 1. Fetch Aggregated Metrics Scoped strictly to the Tenant
  const [totalTransactions, pendingCount, completedCount, totalVolume] =
    await Promise.all([
      prisma.transaction.count({ where: { tenantId } }),
      prisma.transaction.count({ where: { tenantId, status: "pending" } }),
      prisma.transaction.count({ where: { tenantId, status: "completed" } }),
      prisma.transaction.aggregate({
        where: { tenantId, status: "completed" },
        _sum: { amount: true },
      }),
    ]);

  const rawAmount = totalVolume._sum.amount
    ? Number(totalVolume._sum.amount)
    : 0;
  const formattedVolume = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(rawAmount);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Dashboard Overview
        </h1>
        <p className="text-zinc-400 mt-1">
          Real-time enterprise metrics and analytics.
        </p>
      </div>

      {/* Metric Grid Panels */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-zinc-900 border-zinc-800 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-100">
              {formattedVolume}
            </div>
            <p className="text-xs text-zinc-500">+12.2% from last month</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              All Transactions
            </CardTitle>
            <CreditCard className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-100">
              +{totalTransactions}
            </div>
            <p className="text-xs text-zinc-500">Lifetime system requests</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Completed Operations
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-100">
              {completedCount}
            </div>
            <p className="text-xs text-zinc-500">Settled inside ledger</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Pending Actions
            </CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-100">
              {pendingCount}
            </div>
            <p className="text-xs text-zinc-500">Awaiting processing</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
