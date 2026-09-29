import { requirePermission } from "@/lib/authorization";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@nexrole/database";
import { checkTenantBillingStatus } from "@/lib/billing-guard";
import ProfileForm from "./_components/ProfileForm";
import InviteMemberForm from "@/components/invite-member-form";
import MemberControls from "@/components/member-controls";
import InvitationControls, { InvitationFeedback } from "@/components/invitation-controls";
import { listInvitations } from "@/lib/manage-invitation";
import DeveloperConsole from "@/components/developer-console";
import { Building2, Users, UserCheck } from "lucide-react";
import Link from "next/link";
import { ROLE } from "@/lib/constants";
import { Code2 } from "lucide-react"; // Custom tab icon

interface PageProps {
  searchParams: Promise<{ tab?: string; billing_success?: string }>;
}

enum Tabs {
  Profile = "profile",
  Team = "team",
  Developer = "developer",
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const { id: actorId, tenantId, role: userRole } = await requirePermission("workspace:read");

  const resolvedParams = await searchParams;
  const activeTab = resolvedParams.tab || Tabs.Profile;

  const invitationFeedbackKey = `invitation-feedback:${tenantId}:${actorId}`;
  const [tenant, teamMembers, apiKeys, invitations] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, subscriptionStatus: true, stripeCustomerId: true, stripeSubscriptionId: true, billingSyncStatus: true, subscriptionCancelAtPeriodEnd: true, subscriptionCancelAt: true, externalOperations: { where: { kind: "checkout_create", state: { in: ["pending", "unknown", "open"] } }, select: { state: true }, take: 1 } } }),
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, createdAt: true, isActive: true, emailVerifiedAt: true, role: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    hasPermission(userRole, "keys:manage") ? prisma.apiKey.findMany({
      where: { tenantId },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    activeTab === Tabs.Team && hasPermission(userRole, "invitations:manage") ? listInvitations() : Promise.resolve([]),
  ]);

  const billing = await checkTenantBillingStatus(tenantId);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Console Configurations
        </h1>
        <p className="text-zinc-400 mt-1">
          Manage corporate boundaries, access levels, and workspace directory
          logs.
        </p>
      </div>

      {/* TAB CONTROLLERS (URL-Driven Link Nodes) */}
      <div className="flex flex-wrap gap-4">
        <Link href="/settings/security" className="inline-block text-sm text-blue-400 hover:underline">Change password</Link>
        <Link href="/settings/roles" className="inline-block text-sm text-blue-400 hover:underline">View role permissions</Link>
      </div>
      <div className="flex border-b border-zinc-800 gap-2">
        <Link
          href={`?tab=${Tabs.Profile}`}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === Tabs.Profile
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Building2 className="h-4 w-4" />
          Company Profile
        </Link>
        <Link
          href={`?tab=${Tabs.Team}`}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === Tabs.Team
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Users className="h-4 w-4" />
          Team Members ({teamMembers.length})
        </Link>
        <Link
          href={`?tab=${Tabs.Developer}`}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === Tabs.Developer
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Code2 className="h-4 w-4" />
          Developer Integrations
        </Link>
      </div>

      {/* PROFILE SUB-PANEL VIEW */}
      {activeTab === Tabs.Profile && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-zinc-200">
              Organization Settings
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Modify the foundational credentials of your enterprise profile.
            </p>
          </div>

          <ProfileForm tenant={tenant ? { name: tenant.name, subscriptionStatus: tenant.subscriptionStatus } : null} userRole={userRole}
            returned={resolvedParams.billing_success === "true"} feedbackKey={`billing-feedback:${tenantId}:${actorId}`}
            billing={{ status: tenant?.subscriptionStatus ?? "unknown", usage: billing.currentUsage,
              hasCustomer: !!tenant?.stripeCustomerId, hasSubscription: !!tenant?.stripeSubscriptionId,
              syncStatus: tenant?.billingSyncStatus ?? "unverified", pendingCheckout: !!tenant?.externalOperations.length,
              cancelAtPeriodEnd: tenant?.subscriptionCancelAtPeriodEnd ?? false, cancelAt: tenant?.subscriptionCancelAt?.toISOString() ?? null }} />
        </div>
      )}

      {/* TEAM SUB-PANEL VIEW */}
      {activeTab === Tabs.Team && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-200">
                Membership Log
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Active and inactive identities inside this company container.
              </p>
            </div>

            {/* RBAC INTERFACE LOCK */}
            {userRole === ROLE.SUPER_ADMIN && <InviteMemberForm feedbackKey={invitationFeedbackKey} />}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/40 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    <th className="p-4">User Email Address</th>
                    <th className="p-4">Assigned Authorization Tier</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">
                      System Enrollment Timestamp
                    </th>
                    {hasPermission(userRole, "members:manage") && <th className="p-4">Manage access</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-sm">
                  {teamMembers.map((member) => (
                    <tr
                      key={member.id}
                      className="hover:bg-zinc-850/20 transition-colors"
                    >
                      <td className="p-4 text-zinc-200 font-medium font-mono">
                        {member.email}
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold font-mono border uppercase ${
                            member.role.name === ROLE.SUPER_ADMIN
                              ? "bg-blue-950/40 border-blue-800/40 text-blue-400"
                              : "bg-zinc-800 border-zinc-700 text-zinc-300"
                          }`}
                        >
                          <UserCheck className="h-3 w-3" />
                          {member.role.name}
                        </span>
                      </td>
                      <td className="p-4 text-xs">
                        <span className={member.isActive ? "text-emerald-500" : "text-zinc-500"}>{member.isActive ? "Active" : "Inactive"}</span>
                        {!member.emailVerifiedAt && <p className="text-amber-500">Email unverified</p>}
                      </td>
                      <td className="p-4 text-right font-mono text-zinc-500 text-xs">
                        {new Date(member.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </td>
                      {hasPermission(userRole, "members:manage") && <td className="p-4">
                        <MemberControls id={member.id} tenantId={tenantId} email={member.email} role={member.role.name}
                          isActive={member.isActive} isSelf={member.id === actorId}
                          isLastAdmin={member.role.name === ROLE.SUPER_ADMIN && !teamMembers.some((other) => other.id !== member.id && other.isActive && other.emailVerifiedAt && other.role.name === ROLE.SUPER_ADMIN)} />
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {activeTab === Tabs.Team && hasPermission(userRole, "invitations:manage") && <section aria-labelledby="invitations-heading" className="space-y-4">
        <div>
          <h3 id="invitations-heading" className="text-lg font-semibold text-zinc-200">Pending invitations</h3>
          <p className="mt-1 text-xs text-zinc-500">Resend replaces the previous link and renews its 24-hour expiry. To change a role, revoke and invite again.</p>
        </div>
        <InvitationFeedback feedbackKey={invitationFeedbackKey} />
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
          {invitations.length === 0 ? <p className="p-4 text-sm text-zinc-400">No pending invitations.</p> : <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead><tr className="border-b border-zinc-800 bg-zinc-950/40 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <th className="p-4">Email address</th><th className="p-4">Assigned role</th><th className="p-4">Expiry (UTC)</th><th className="p-4">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-800/60 text-sm">{invitations.map((invitation) => <tr key={invitation.id}>
                <td className="p-4 font-mono text-zinc-200">{invitation.email}</td>
                <td className="p-4"><span className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 font-mono text-xs text-zinc-300">{invitation.role}</span></td>
                <td className="p-4 text-xs">
                  <p className={invitation.expired ? "text-amber-500" : "text-emerald-500"}>{invitation.expired ? "Expired / not ready" : "Pending"}</p>
                  {invitation.expiresAt.getTime() > 0 ? <time dateTime={invitation.expiresAt.toISOString()} className="font-mono text-zinc-500">{invitation.expiresAt.toISOString().slice(0, 16).replace("T", " ")}</time> : <p className="text-zinc-500">No active link. Refresh or resend.</p>}
                </td>
                <td className="p-4"><InvitationControls id={invitation.id} email={invitation.email} feedbackKey={invitationFeedbackKey} /></td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>
      </section>}
      {/* RENDER DEVELOPER CONSOLE SUB-PANEL VIEW */}
      {activeTab === Tabs.Developer && (
        <DeveloperConsole initialKeys={apiKeys} userRole={userRole} />
      )}
    </div>
  );
}
