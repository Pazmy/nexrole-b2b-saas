"use client";
import { useActionState } from "react";
import { updateTenantProfile } from "../update-tenant-profile-action";
import BillingPanel from "./BillingPanel";
import type { BillingView } from "@/lib/billing-presentation";
import { KeyRound, Loader2 } from "lucide-react";
import { ROLE } from "@/lib/constants";
interface Tenant {
  name: string;
  subscriptionStatus: string;
}
export default function ProfileForm({
  tenant,
  userRole, billing, returned, feedbackKey,
}: {
  tenant: Tenant | null;
  userRole?: string;
  billing: BillingView; returned: boolean; feedbackKey: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateTenantProfile,
    null,
  );

  return (
    <form action={formAction} className="space-y-4 max-w-md">
      {/* Success/Error Alerts */}
      {state?.error && (
        <div className="p-3 rounded-lg border border-red-800/40 bg-red-950/20 text-xs text-red-400 font-mono">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="p-3 rounded-lg border border-emerald-800/40 bg-emerald-950/20 text-xs text-emerald-400 font-mono">
          {state.success}
        </div>
      )}
      <BillingPanel view={billing} canManage={userRole === ROLE.SUPER_ADMIN} returned={returned} feedbackKey={feedbackKey} />
      {/* Company Legal Name */}
      <div className="space-y-2">
        <label
          htmlFor="companyName"
          className="text-xs font-medium text-zinc-400 uppercase tracking-wider"
        >
          Company Legal Name
        </label>
        <input
          id="companyName"
          name="name"
          type="text"
          defaultValue={tenant?.name || ""}
          disabled={userRole !== ROLE.SUPER_ADMIN || isPending}
          className="w-full h-9 rounded-md bg-zinc-950 border border-zinc-800 px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          placeholder="Enter workspace name"
        />
      </div>
      {/* Contextual RBAC Button / Notice */}
      {userRole === ROLE.SUPER_ADMIN ? (
        <button
          type="submit"
          disabled={isPending}
          className="h-9 px-4 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-60 text-sm font-medium text-white transition-colors flex items-center gap-2"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Saving changes..." : "Save Structural Profile"}
        </button>
      ) : (
        <div className="p-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 text-xs text-zinc-500 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-zinc-600" />
          You are operating under Read-Only restrictions. SuperAdmin keys are
          required to execute database updates.
        </div>
      )}
    </form>
  );
}
