"use client";

import { useSyncExternalStore } from "react";

type Feedback = { kind: "create" | "resend" | "revoke"; success: boolean; message: string; email: string };
const changed = "invitation-feedback";
const subscribe = (callback: () => void) => {
  window.addEventListener(changed, callback);
  return () => window.removeEventListener(changed, callback);
};
export function saveInvitationFeedback(key: string, feedback: Feedback) {
  try { sessionStorage.setItem(key, JSON.stringify({ ...feedback, expires: Date.now() + 300_000 })); } catch { /* Feedback storage is optional. */ }
}
export function useInvitationFeedback(key: string) {
  const raw = useSyncExternalStore(subscribe, () => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }, () => null);
  let feedback: Feedback | null = null;
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value?.expires > Date.now() && ["create", "resend", "revoke"].includes(value.kind) &&
      typeof value.success === "boolean" && typeof value.message === "string" && typeof value.email === "string") feedback = value;
  } catch { /* Ignore malformed/expired browser feedback. */ }
  function clear() {
    try { sessionStorage.removeItem(key); } catch { /* Optional storage. */ }
    window.dispatchEvent(new Event(changed));
  }
  return { feedback, clear };
}
