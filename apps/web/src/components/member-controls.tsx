"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { changeMemberRoleAction, deactivateMemberAction, type MemberActionState } from "@/app/(dashboard)/settings/member-actions";
import { ROLE } from "@/lib/constants";

const subscribe = () => () => {};
const serverSnapshot = () => null;

export default function MemberControls({ id, tenantId, email, role, isActive, isSelf, isLastAdmin }: {
  id: string; tenantId: string; email: string; role: string; isActive: boolean; isSelf: boolean; isLastAdmin: boolean;
}) {
  const [selectedRole, setSelectedRole] = useState(role);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MemberActionState>(null);
  const submitting = useRef(false);
  const feedbackKey = `member-feedback:${tenantId}:${id}`;
  const saved = useSyncExternalStore(subscribe, () => {
    try { return sessionStorage.getItem(feedbackKey); } catch { return null; }
  }, serverSnapshot);
  let message: string | null = null;
  try {
    const feedback = saved ? JSON.parse(saved) : null;
    if (feedback?.expires > Date.now() && typeof feedback.message === "string") message = feedback.message;
  } catch { /* Storage is optional. */ }

  async function submit(operation: "role" | "deactivate") {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setResult(null);
    let navigating = false;
    try {
      const form = new FormData();
      form.set("id", id);
      if (operation === "role") form.set("role", selectedRole);
      const response = await (operation === "role" ? changeMemberRoleAction : deactivateMemberAction)(null, form);
      if (response?.success) {
        if (response.selfChanged) {
          navigating = true;
          window.location.assign("/login");
          return;
        }
        try { sessionStorage.setItem(feedbackKey, JSON.stringify({ message: response.message, expires: Date.now() + 300_000 })); } catch { /* Reload still reflects the committed change. */ }
        navigating = true;
        window.location.reload();
        return;
      }
      setResult(response);
    } catch {
      setResult({ success: false, code: "unavailable", error: "Could not confirm the change. Refresh the member list before trying again." });
    } finally {
      if (!navigating) { submitting.current = false; setPending(false); }
    }
  }

  const blocked = !isActive || isLastAdmin;
  return (
    <div className="min-w-56 space-y-2 text-xs" aria-busy={pending}>
      {message && !result && <p role="status" className="text-emerald-500">{message}</p>}
      {!isActive ? <p className="text-zinc-500">Inactive members cannot be changed.</p> : <>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void submit("role"); }}>
          <select aria-label={`Role for ${email}`} value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)} disabled={pending || blocked || confirming}
            className="min-w-0 rounded border border-zinc-700 bg-zinc-950 p-2 text-white focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:opacity-50">
            {Object.values(ROLE).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button disabled={pending || blocked || confirming || selectedRole === role} className="rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50">Save role</button>
        </form>
        {isLastAdmin ? <p className="text-amber-500">Keep at least one active, verified SuperAdmin. Promote another member first.</p> : <>
          {isSelf && <p className="text-amber-500">This is your account. Changing your role signs you out. Deactivation also prevents signing in again.</p>}
          {confirming ? <div className="space-y-2 rounded border border-red-900 p-3" role="group" aria-label={`Confirm deactivation of ${email}`}>
            <p className="text-zinc-300">Deactivate {email}? Their access ends on the next protected request. Transaction history is retained.</p>
            <div className="flex gap-3">
              <button type="button" disabled={pending} onClick={() => void submit("deactivate")} className="rounded bg-red-700 px-3 py-2 text-white disabled:opacity-50">Confirm deactivation</button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="text-zinc-300">Cancel</button>
            </div>
          </div> : <button type="button" disabled={pending} onClick={() => setConfirming(true)} className="text-red-400 hover:underline disabled:opacity-50">Deactivate</button>}
        </>}
      </>}
      {pending && <p role="status" className="text-zinc-400">Saving changes…</p>}
      {result && !result.success && <div role="alert" className="space-y-1 text-red-400"><p>{result.error}</p><a href="/settings?tab=team" className="underline">Refresh member list</a></div>}
    </div>
  );
}
