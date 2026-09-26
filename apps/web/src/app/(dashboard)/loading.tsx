import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return <div role="status" className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 flex items-center gap-3 text-sm text-zinc-400">
    <Loader2 className="h-4 w-4 animate-spin" />Loading workspace data...
  </div>;
}
