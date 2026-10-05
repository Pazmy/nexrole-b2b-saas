import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AccessDeniedError, requirePermission } from "@/lib/authorization";
import { hasPermission, type Permission } from "@/lib/permissions";
import { ROLE } from "@/lib/constants";

const labels: Record<Permission, string> = {
  "workspace:read": "View workspace, member directory and roles",
  "transactions:read": "View transactions",
  "transactions:create": "Create transactions",
  "transactions:update-status": "Update transaction status",
  "workspace:update": "Edit company profile",
  "members:invite": "Invite workspace members",
  "members:manage": "Change member roles and deactivate members",
  "invitations:manage": "View, resend and revoke invitations",
  "keys:manage": "Manage API keys",
  "billing:manage": "Manage billing",
};

export default async function RolesPage() {
  let user;
  try { user = await requirePermission("workspace:read"); }
  catch (error) {
    if (error instanceof AccessDeniedError) redirect("/login");
    throw error;
  }
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-zinc-100"><ShieldCheck className="h-7 w-7 text-blue-400" aria-hidden="true" />Workspace roles</h1>
        <p className="mt-2 text-sm text-zinc-400">Your role: <span className="font-medium text-zinc-200">{user.role}</span>. These three roles have fixed permissions.</p>
      </div>
      <Link href="/settings?tab=team" className="inline-block text-sm text-blue-400 hover:underline">Back to Team Members</Link>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Workspace role permissions</caption>
            <thead><tr className="border-b border-zinc-800 bg-zinc-950/40 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <th scope="col" className="p-4">Permission</th>
              {Object.values(ROLE).map((role) => <th scope="col" key={role} className="p-4 text-center">{role}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {(Object.entries(labels) as [Permission, string][]).map(([permission, label]) => <tr key={permission}>
                <th scope="row" className="p-4 font-medium text-zinc-200">{label}</th>
                {Object.values(ROLE).map((role) => <td key={role} className={`p-4 text-center ${hasPermission(role, permission) ? "text-emerald-500" : "text-zinc-500"}`}>
                  {hasPermission(role, permission) ? "Allowed" : "Not allowed"}
                </td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-2 text-sm text-zinc-400">
        <p>Member and Developer currently have the same read-only access. API keys are managed by SuperAdmin.</p>
        <p>SuperAdmin can assign roles in Team Members. The last active, verified SuperAdmin must remain. Custom roles are not available.</p>
        <p>Permissions do not override account status or transaction limits. Role changes end existing sessions on the next protected request.</p>
      </div>
    </div>
  );
}
