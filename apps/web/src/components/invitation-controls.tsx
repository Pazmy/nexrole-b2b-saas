"use client";

import { useRef, useState } from "react";
import { resendInvitationAction, revokeInvitationAction } from "@/app/(dashboard)/settings/invite-action";
import { saveInvitationFeedback, useInvitationFeedback } from "./invitation-feedback";

export function InvitationFeedback({ feedbackKey }: { feedbackKey: string }) {
  const { feedback, clear } = useInvitationFeedback(feedbackKey);
  if (!feedback || feedback.kind === "create") return null;
  return <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
    <p role={feedback.success ? "status" : "alert"} className={feedback.success ? "text-emerald-500" : "text-red-400"}>{feedback.email}: {feedback.message}</p>
    <button type="button" onClick={clear} className="text-xs text-zinc-400 hover:underline">Dismiss</button>
  </div>;
}

export default function InvitationControls({ id, email, feedbackKey }: { id: string; email: string; feedbackKey: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit(kind: "resend" | "revoke") {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    let navigating = false;
    try {
      const form = new FormData(); form.set("id", id);
      const result = await (kind === "resend" ? resendInvitationAction : revokeInvitationAction)(null, form);
      if (result && (result.success || ["delivery_failed", "changed", "not_found"].includes(result.code))) {
        saveInvitationFeedback(feedbackKey, { kind, email, success: result.success, message: result.success ? result.message : result.error });
        navigating = true; window.location.reload(); return;
      }
      setError(result && !result.success ? result.error : "Could not confirm the change. Refresh before trying again.");
    } catch { setError("Could not confirm the change. Refresh before trying again."); }
    finally { if (!navigating) { submitting.current = false; setPending(false); } }
  }
  return <div className="min-w-48 space-y-2 text-xs" aria-busy={pending}>
    {confirming ? <div role="group" aria-label={`Revoke invitation for ${email}`} className="space-y-2">
      <p className="text-zinc-300">Revoke this invitation? Its email link will stop working.</p>
      <div className="flex gap-3">
        <button type="button" disabled={pending} onClick={() => void submit("revoke")} className="text-red-400 disabled:opacity-50">Confirm revoke</button>
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="text-zinc-400">Cancel</button>
      </div>
    </div> : <div className="flex gap-4">
      <button type="button" disabled={pending} onClick={() => void submit("resend")} className="text-blue-400 hover:underline disabled:opacity-50">Resend</button>
      <button type="button" disabled={pending} onClick={() => setConfirming(true)} className="text-red-400 hover:underline disabled:opacity-50">Revoke</button>
    </div>}
    {pending && <p role="status" className="text-zinc-400">Updating invitation…</p>}
    {error && <div role="alert" className="text-red-400"><p>{error}</p><a href="/settings?tab=team" className="underline">Refresh invitation list</a></div>}
  </div>;
}
