"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, SlidersHorizontal } from "lucide-react";

export default function TransactionFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 1. Initialize local state from current URL params
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "all");

  // 2. Form submission updates the URL query string parameters
  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());

    if (search) {
      params.set("search", search);
    } else {
      params.delete("search");
    }

    if (status && status !== "all") {
      params.set("status", status);
    } else {
      params.delete("status");
    }

    params.set("page", "1"); // Reset context window to page 1 on search
    router.push(`${pathname}?${params.toString()}`);
  };

  // 3. Reset all variables back to default clean states
  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    router.push(pathname);
  };

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-col md:flex-row items-center gap-4 border border-zinc-850 bg-zinc-900/50 p-4 rounded-xl mb-6"
    >
      <div className="relative flex-1 w-full">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
        <Input
          placeholder="Search by description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-500 focus-visible:ring-1 focus-visible:ring-zinc-700"
        />
      </div>

      <div className="flex w-full md:w-auto items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 w-full md:w-40 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700 cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>

        <Button
          type="submit"
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Apply
        </Button>

        {(searchParams.get("search") || searchParams.get("status")) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 gap-1"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
