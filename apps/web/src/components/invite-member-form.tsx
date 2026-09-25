"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, Check, UserPlus } from "lucide-react";
import { createMemberInvitation } from "@/app/(dashboard)/settings/invite-action";

export default function InviteMemberForm() {
  const [email, setEmail] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    setSentTo(null);

    try {
      await createMemberInvitation(email, "Member");
      setSentTo(email.trim().toLowerCase());
      setEmail("");
    } catch {
      setError("We could not send this invitation. Check the address, ensure it does not already have an account, and try again later.");
    } finally {
      setIsPending(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        className="h-9 px-4 rounded-md bg-zinc-100 hover:bg-zinc-200 text-sm font-semibold text-zinc-950 transition-colors"
      >
        + Invite Workspace Member
      </Button>
    );
  }

  return (
    <div className="border border-zinc-800 bg-zinc-900 p-5 rounded-xl max-w-md w-full animate-in fade-in-50 duration-200">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-bold text-zinc-200 uppercase tracking-wide">
          Invite Workspace Member
        </h4>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setSentTo(null);
            setError(null);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {!sentTo ? (
        <form onSubmit={handleInviteSubmit} className="space-y-3" aria-busy={isPending}>
          <label htmlFor="invite-email" className="sr-only">Invite a teammate</label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <Input
              id="invite-email"
              name="email"
              autoComplete="email"
              type="email"
              placeholder="collaborator@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700 focus-visible:ring-zinc-700"
              required
              disabled={isPending}
            />
          </div>

          {error && <p role="alert" className="text-xs font-medium text-red-400">{error}</p>}

          <Button
            type="submit"
            disabled={isPending || !email}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sending invitation...
              </>
            ) : (
              <>
                <UserPlus className="h-3.5 w-3.5" />
                Send invitation
              </>
            )}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <p role="status" className="text-xs text-zinc-400">
            Invitation sent. Your teammate can use the email link to join.
          </p>
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-2 rounded-lg">
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
            <span className="min-w-0 break-all text-xs font-mono text-zinc-300">{sentTo}</span>
          </div>
          <Button
            type="button"
            onClick={() => setSentTo(null)}
            variant="ghost"
            className="w-full text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:bg-zinc-800 h-8"
          >
            Invite Another User
          </Button>
        </div>
      )}
    </div>
  );
}
