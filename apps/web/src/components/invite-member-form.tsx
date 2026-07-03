"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, Copy, Check, UserPlus } from "lucide-react";
import { createMemberInvitation } from "@/app/(dashboard)/settings/invite-action";

// NOTE: Because we are not using a live SMTP server like SendGrid or AWS SES in local development yet,
// this component will display the generated invite link directly on the screen so we can copy and paste
// it into an incognito window to test the onboarding flow.

export default function InviteMemberForm() {
  const [email, setEmail] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    setGeneratedLink(null);

    try {
      // Execute the Server Action we built in Step 3
      const link = await createMemberInvitation(email, "Member");
      setGeneratedLink(link);
      setEmail("");
    } catch (err) {
      setError(
        (err as { message?: string })?.message ||
          "Failed to generate security invitation token.",
      );
    } finally {
      setIsPending(false);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) {
    return (
      <Button
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
          Generate Provisioning Key
        </h4>
        <button
          onClick={() => {
            setIsOpen(false);
            setGeneratedLink(null);
            setError(null);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>

      {!generatedLink ? (
        <form onSubmit={handleInviteSubmit} className="space-y-3">
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <Input
              type="email"
              placeholder="collaborator@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9 bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700 focus-visible:ring-zinc-700"
              required
              disabled={isPending}
            />
          </div>

          {error && <p className="text-xs font-medium text-red-400">{error}</p>}

          <Button
            type="submit"
            disabled={isPending || !email}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing Cryptographic Token...
              </>
            ) : (
              <>
                <UserPlus className="h-3.5 w-3.5" />
                Generate Secure Link
              </>
            )}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">
            Token signed successfully. Share this registration gateway URL
            securely with the target user:
          </p>
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-2 rounded-lg">
            <input
              type="text"
              readOnly
              value={generatedLink}
              className="bg-transparent text-xs font-mono text-zinc-300 flex-1 outline-none select-all truncate"
            />
            <button
              onClick={copyToClipboard}
              className="p-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors"
              title="Copy link"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <Button
            onClick={() => setGeneratedLink(null)}
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
