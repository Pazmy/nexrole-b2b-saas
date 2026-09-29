"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Shield } from "lucide-react";
import { billingPresentation, type BillingView } from "@/lib/billing-presentation";
import { reconcileBillingAction, requestBillingSession } from "../billing-action";

const subscribe = () => () => {};
export default function BillingPanel({ view, canManage, returned, feedbackKey }: {
  view: BillingView; canManage: boolean; returned: boolean; feedbackKey: string;
}) {
  const display = billingPresentation(view);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const saved = useSyncExternalStore(subscribe, () => {
    try { return sessionStorage.getItem(feedbackKey); } catch { return null; }
  }, () => null);
  let synchronized = false;
  try { synchronized = Number(saved) > Date.now(); } catch { /* Optional feedback. */ }

  async function run(intent: "checkout" | "portal" | "sync") {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    let navigating = false;
    try {
      if (intent === "sync") {
        const result = await reconcileBillingAction();
        if (!result.success) { setError(result.error); return; }
        try { sessionStorage.setItem(feedbackKey, String(Date.now() + 300_000)); } catch { /* Optional feedback. */ }
        navigating = true;
        window.location.assign("/settings?tab=profile");
      } else {
        const result = await requestBillingSession(intent);
        if (!result.success) { setError(result.error); return; }
        navigating = true;
        window.location.assign(result.url);
      }
    } catch { setError("Billing could not be confirmed. Refresh this page or sign in again, then retry."); }
    finally { if (!navigating) { submitting.current = false; setPending(false); } }
  }
  const buttonClass = "h-9 px-4 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  return <section className="space-y-2" aria-label="Workspace billing" aria-busy={pending}>
    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Subscription Status</p>
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 w-max font-mono text-xs ${display.restricted ? "text-amber-400" : "text-emerald-400"}`}>
      <Shield className="h-3.5 w-3.5" />{display.label}
    </div>
    <p className="text-xs text-zinc-400">{display.description}</p>
    <p className="text-xs text-zinc-400">{display.usage} {display.policy}</p>
    {(view.cancelAtPeriodEnd || view.cancelAt) && <p className="text-xs text-amber-400">Cancellation scheduled{view.cancelAt ? ` for ${view.cancelAt.slice(0, 10)} (UTC)` : " at the end of the billing period"}. Your current subscription status applies until cancellation takes effect.</p>}
    {view.pendingCheckout && <p role="status" className="text-xs text-amber-400">A checkout request is pending. Check billing status or continue the existing checkout; payment is not yet confirmed.</p>}
    {(view.syncStatus === "pending" || (view.syncStatus === "unverified" && view.hasCustomer)) && <p role="status" className="text-xs text-amber-400">Billing synchronization is pending. Check billing status to retrieve the latest provider state.</p>}
    {display.needsReview && <p role="status" className="text-xs text-amber-400">Billing requires review. Check billing status; contact support if the issue persists.</p>}
    {returned && <p role="status" className="text-xs text-amber-400">Returned from checkout. Payment is not confirmed by this URL. Check billing status to confirm your workspace subscription.</p>}
    {synchronized && !error && <p role="status" className="text-xs text-emerald-400">Billing check completed. The current workspace status is shown above.</p>}
    {canManage ? <div className="border-t border-zinc-800 pt-4 mt-4 space-y-3">
      {display.canCheckout && <>
        <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wide">Unlock Enterprise Pro</h4>
        <p className="text-xs text-zinc-500">Remove the Free transaction limit with a Pro subscription.</p>
      </>}
      <div className="flex flex-wrap gap-2">
        {display.canCheckout && <button type="button" disabled={pending} onClick={() => void run("checkout")} className={`${buttonClass} bg-emerald-600 hover:bg-emerald-700`}>{view.pendingCheckout ? "Continue checkout" : "Upgrade Workspace Account"}</button>}
        {view.hasCustomer && <button type="button" disabled={pending} onClick={() => void run("portal")} className={`${buttonClass} bg-blue-600 hover:bg-blue-700`}>Manage billing</button>}
        <button type="button" disabled={pending} onClick={() => void run("sync")} className={`${buttonClass} border border-zinc-700 hover:bg-zinc-800`}>Check billing status</button>
      </div>
    </div> : <p className="text-xs text-zinc-500">Contact your workspace administrator to manage billing.</p>}
    {pending && <p role="status" className="text-xs text-zinc-400">Checking billing…</p>}
    {error && <div role="alert" className="p-3 rounded-lg border border-red-800/40 bg-red-950/20 text-xs text-red-400 font-mono">{error} <a className="underline" href="/settings?tab=profile">Refresh billing settings</a></div>}
  </section>;
}
