"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";

type Result = { success: boolean; code?: string };
type Feedback<State> = { state: State; description: string; amount: string; expires: number };
const changed = "transaction-feedback";
function subscribe(callback: () => void) {
  window.addEventListener(changed, callback);
  return () => window.removeEventListener(changed, callback);
}
export function clearTransactionFeedback(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  window.dispatchEvent(new Event(changed));
}
export function useTransactionFeedback<State>(key: string): Feedback<State> | null {
  const raw = useSyncExternalStore(subscribe, () => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }, () => null);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.expires > Date.now() && typeof value.state?.success === "boolean" &&
      typeof value.description === "string" && typeof value.amount === "string" &&
      (value.state.success ? typeof value.state.message === "string" : typeof value.state.error === "string")) return value;
  } catch { /* Invalid/expired feedback is ignored; it never authorizes a write. */ }
  return null;
}

// Keep submission feedback independent of the router's RSC transition. In the
// installed Next runtime, useActionState can remain pending after a complete
// production action response. Authorization and validation stay in the action.
export function useTransactionSubmit<State extends Result | null>(
  action: (previous: State | null, form: FormData) => Promise<State | null>,
  unavailable: State,
  feedbackKey: string,
) {
  const feedback = useTransactionFeedback<State>(feedbackKey);
  const [state, setState] = useState<State | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    let reloading = false;
    try {
      const result = await action(state, form);
      if (result && (result.success || ["creation_limit_reached", "subscription_restricted", "status_conflict", "not_found", "access_denied"].includes(result.code || ""))) {
        // A document reload bypasses the installed runtime's stalled RSC commits.
        // Keep only this tab's short-lived feedback, scoped to the workspace/record.
        try {
          sessionStorage.setItem(feedbackKey, JSON.stringify({ state: result,
            description: String(form.get("description") || ""), amount: String(form.get("amount") || ""), expires: Date.now() + 300_000 }));
        } catch { /* Reload still refreshes committed data if storage is disabled. */ }
        reloading = true;
        window.location.reload();
        return;
      }
      setState(result);
    }
    catch { setState(unavailable); }
    finally { if (!reloading) { submitting.current = false; setPending(false); } }
  }
  return { state: state || feedback?.state || null, pending, submit };
}
