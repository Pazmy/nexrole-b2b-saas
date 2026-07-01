import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Receipt,
  Settings,
  LogOut,
  Building2,
} from "lucide-react";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const tenantName = session?.user?.name || "My Company";
  const userEmail = session?.user?.email;
  const userRole = (session?.user as any)?.role || "Member";

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-white overflow-hidden">
      {/* 1. SIDEBAR */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900 flex flex-col justify-between">
        <div className="p-6">
          {/* Tenant branding selector workspace */}
          <div className="flex items-center gap-3 px-2 py-1 border border-zinc-800 bg-zinc-950 rounded-lg mb-8">
            <Building2 className="h-5 w-5 text-blue-500" />
            <div className="truncate">
              <p className="text-sm font-semibold truncate text-zinc-200">
                {tenantName}
              </p>
              <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                {userRole}
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-2">
            <Link
              href="/"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              Overview
            </Link>
            <Link
              href="/transactions"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <Receipt className="h-4 w-4" />
              Transactions
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </nav>
        </div>

        {/* 2. USER PROFILE & SIGN OUT */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex flex-col gap-3">
          <div className="px-2 truncate">
            <p className="text-xs text-zinc-500 truncate">Logged in as</p>
            <p className="text-sm font-medium text-zinc-300 truncate">
              {userEmail}
            </p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button
              variant="ghost"
              className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-950/20 gap-3"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </form>
        </div>
      </aside>

      {/* 3. MAIN WORKSPACE CONTENT */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-zinc-900/30 backdrop-blur">
          <h2 className="text-lg font-semibold text-zinc-200">
            B2B Management Console
          </h2>
        </header>
        <div className="p-8 flex-1">{children}</div>
      </main>
    </div>
  );
}
