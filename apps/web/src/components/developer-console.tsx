"use client";

import { useState } from "react";
import {
  generateApiKey,
  revokeApiKey,
} from "@/app/(dashboard)/settings/developer-action";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Key,
  Copy,
  Check,
  Trash2,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";
import { ROLE } from "@/lib/constants";

interface ApiKeyItem {
  id: string;
  name: string;
  createdAt: Date;
}

interface DeveloperConsoleProps {
  initialKeys: ApiKeyItem[];
  userRole?: string;
}

export default function DeveloperConsole({
  initialKeys,
  userRole,
}: DeveloperConsoleProps) {
  const [keyName, setKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== ROLE.SUPER_ADMIN) return;
    setIsPending(true);
    setRevealedKey(null);

    try {
      const rawKey = await generateApiKey(keyName);
      setRevealedKey(rawKey);
      setKeyName("");
    } catch (err: any) {
      alert(err.message || "Failed to generate keys.");
    } finally {
      setIsPending(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this API key? External automated processes using it will break instantly.",
      )
    )
      return;
    try {
      await revokeApiKey(id);
    } catch (err: any) {
      alert("Failed to delete key.");
    }
  };

  const copyToClipboard = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* SECTION EXPLANATION ELEMENT */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-200">
            Developer Integrations
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Provision secure credentials to automate enterprise transaction
            queries externally.
          </p>
        </div>

        {userRole === ROLE.SUPER_ADMIN ? (
          <form
            onSubmit={handleCreateKey}
            className="flex flex-col sm:flex-row items-end gap-3 max-w-xl"
          >
            <div className="flex-1 w-full space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Key Label Name
              </label>
              <Input
                placeholder="e.g., Accounting Integration Layer"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700 h-9"
                required
                disabled={isPending}
              />
            </div>
            <Button
              type="submit"
              disabled={isPending || !keyName}
              className="h-9 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium gap-2"
            >
              <Key className="h-3.5 w-3.5" />
              Generate Token credentials
            </Button>
          </form>
        ) : (
          <div className="p-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 text-xs text-zinc-500 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-zinc-600" />
            Developer credential management requires full SuperAdmin clearance
            level.
          </div>
        )}

        {/* REVEAL ONCE DISPLAY SCREEN NOTIFIER */}
        {revealedKey && (
          <div className="border border-amber-500/30 bg-amber-950/20 p-4 rounded-xl space-y-3 max-w-xl animate-in fade-in-50">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Copy this token signature key string immediately. It will not be
              shown again.
            </div>
            <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-850 p-2 rounded-lg">
              <input
                readOnly
                value={revealedKey}
                className="bg-transparent text-xs font-mono text-zinc-200 flex-1 outline-none select-all font-semibold"
              />
              <button
                onClick={copyToClipboard}
                className="p-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white rounded"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RENDER ACTIVE KEYS MANAGEMENT SHEET */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider px-1">
          Active Machine Access keys
        </h4>

        {initialKeys.length === 0 ? (
          <div className="text-center p-8 border border-zinc-850 bg-zinc-900/10 rounded-xl text-xs text-zinc-500">
            No active machine keys provisioned for this organization container.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/40 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  <th className="p-3">Key Token Identity Name</th>
                  <th className="p-3">Generated Timestamp</th>
                  <th className="p-3 text-right">Access Management</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-xs">
                {initialKeys.map((k) => (
                  <tr
                    key={k.id}
                    className="hover:bg-zinc-850/20 transition-colors"
                  >
                    <td className="p-3 text-zinc-200 font-medium">{k.name}</td>
                    <td className="p-3 text-zinc-500 font-mono">
                      {new Date(k.createdAt).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                      })}
                    </td>
                    <td className="p-3 text-right">
                      {userRole === ROLE.SUPER_ADMIN && (
                        <button
                          onClick={() => handleRevokeKey(k.id)}
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-colors"
                          title="Revoke access"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
