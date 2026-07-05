"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertOctagon, RotateCw, Home } from "lucide-react";
import Link from "next/link";

export default function DashboardErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error client-side for analytics/exception reporting
    console.error("Dashboard view segment failure:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-full max-w-md rounded-xl border border-red-900/30 bg-zinc-900 p-8 shadow-2xl space-y-6">
        {/* Error Icon */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-950 border border-red-900 text-red-400">
          <AlertOctagon className="h-6 w-6" />
        </div>

        {/* Error Message */}
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-zinc-100">
            Something went wrong
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            An unexpected error occurred while loading this dashboard view.
            {error.message && (
              <span className="block font-mono text-xs text-red-400 mt-2 bg-zinc-950 p-2 rounded border border-zinc-800 text-left overflow-x-auto max-h-24">
                {error.message}
              </span>
            )}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            onClick={() => reset()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2 transition-all"
          >
            <RotateCw className="h-4 w-4" />
            Try again
          </Button>

          <Button
            asChild
            variant="outline"
            className="flex-1 border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-medium gap-2"
          >
            <Link href="/">
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
